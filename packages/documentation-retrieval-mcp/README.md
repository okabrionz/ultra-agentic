# Documentation Retrieval MCP

A private, read-only Model Context Protocol server for searching approved local
documentation roots over stdio. Version 0.1 is local-only: it does not make
HTTP requests, fetch URLs, or expose any network transport.

## Requirements

- Node.js 22.12.0 or newer
- Local documentation in `.md`, `.mdx`, `.txt`, or `.rst` files

## Downloaded archive

Extract the ZIP, enter its versioned package directory, and install production
dependencies:

```sh
npm install --omit=dev
```

Set `DOC_ROOTS` for the process, then use either packaged entrypoint:

```text
node dist/index.js
npx --no-install documentation-retrieval-mcp
```

POSIX:

```sh
DOC_ROOTS="/srv/docs:/opt/team-docs" node dist/index.js
```

Windows PowerShell:

```powershell
$env:DOC_ROOTS = "C:\docs;D:\team-docs"
node .\dist\index.js
```

The stdio entrypoint writes only MCP JSON-RPC to stdout. Startup failures go to
stderr. Application code can import `createServer` and `loadConfig` from
`@deirs/documentation-retrieval-mcp` and connect its own MCP transport.
`createDocumentationRetrievalServer` remains available as the descriptive
factory name.

## Cursor MCP configuration

Windows/PowerShell paths use `;` between roots:

```json
{
  "mcpServers": {
    "documentation-retrieval": {
      "command": "node",
      "args": [
        "C:\\path\\to\\extracted-package\\dist\\index.js"
      ],
      "env": {
        "DOC_ROOTS": "C:\\docs;D:\\team-docs"
      }
    }
  }
}
```

POSIX paths use `:` between roots:

```json
{
  "mcpServers": {
    "documentation-retrieval": {
      "command": "node",
      "args": [
        "/path/to/extracted-package/dist/index.js"
      ],
      "env": {
        "DOC_ROOTS": "/srv/docs:/opt/team-docs"
      }
    }
  }
}
```

Use absolute paths in Cursor configuration so the server behaves independently
of Cursor's launch directory.

## Tools

- `list_doc_roots` returns JSON containing only each root's stable ID and
  canonical absolute path.
- `search_docs` performs case-insensitive literal line search. It accepts
  `query`, optional `rootId`, and optional existing relative `pathPrefix`.
  Results are sorted by canonical root, portable relative path, and line
  number. Citations use `<rootId>:<relative/path>:<line>`.
- `read_excerpt` accepts `rootId`, relative `path`, 1-based `startLine`, and
  positive `lineCount`. Every returned line includes its citation and line
  number. Requests above the configured line count are clamped with a notice.

All tools are annotated read-only, non-destructive, idempotent, and closed
world. Tool failures are bounded `isError: true` results and do not terminate
the server.

## Configuration and limits

`DOC_ROOTS` is a list separated by the platform path delimiter (`;` on Windows,
`:` on POSIX). Entries may be relative to the process working directory, but
absolute paths are recommended. Roots are canonicalized, deduplicated, and
sorted before stable IDs are assigned.

If `DOC_ROOTS` is not set, the server explicitly defaults to
`process.cwd()` as its only approved root. Set `DOC_ROOTS` in production-style
configurations to avoid depending on the launch directory. An explicitly empty
`DOC_ROOTS` value is rejected.

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `DOC_MAX_FILE_BYTES` | `524288` (512 KiB) | Largest individual file read |
| `DOC_MAX_MATCHES` | `50` | Maximum search matches returned |
| `DOC_MAX_EXCERPT_LINES` | `20` | Maximum lines per search excerpt or `read_excerpt` call |
| `DOC_MAX_LINE_LENGTH` | `2000` | Maximum Unicode characters rendered from one line |
| `DOC_MAX_SCAN_FILES` | `2000` | Maximum directory entries inspected; skipped entries count |
| `DOC_MAX_SCANNED_BYTES` | `16777216` (16 MiB) | Maximum cumulative file bytes read by one search |
| `DOC_MAX_OUTPUT_BYTES` | `131072` (128 KiB) | Maximum UTF-8 bytes returned by a tool; minimum `64` |

Overrides must be positive safe integers, and `DOC_MAX_OUTPUT_BYTES` must be at
least `64` so the complete output-truncation notice always fits. Match, file,
scan, scanned-byte, line, and output limits produce explicit truncation or skip
notices when they affect a result. The programmatic server, search, and excerpt
APIs validate the same limits before doing work.

## Local file safety

Roots and requested paths are resolved through the filesystem before use.
Traversal, absolute user paths, and symlinks resolving outside their configured
root are rejected. Recursive scans do not follow directory symlinks and charge
every inspected directory entry—including unsupported and special entries—to
the scan budget.

Only regular supported files are opened. Unsupported extensions, binary
content, directories, FIFOs, devices, and other special files are not returned.
Strict UTF-8 text containing C0/C1 control characters is rejected, except for
tab, newline, and carriage return; this prevents ESC terminal sequences from
reaching tool output.
Reads use non-blocking file descriptors, enforce byte limits, and compare the
validated and opened file identities. The current path and open handle are
checked again before content is returned to reduce replacement races.

Directory scans use incremental `opendir` reads with a one-entry buffer. For
each directory they read at most the remaining global entry budget plus one
lookahead entry. A directory with an extra entry is discarded without
recursing and marks the scan truncated. A directory that closes within budget
is sorted completely before its files and child directories are processed.
This keeps candidate selection deterministic without loading an unbounded
directory. Cancellation is checked between entries.

Candidate directories are canonicalized and `lstat`-checked immediately before
opening, then revalidated after open, between entries, and after close.
Replacements are discarded with a bounded truncation notice instead of being
followed.

Tool-relative paths always use `/`. Backslash, colon, pipe, CR/LF, and other
C0/C1 controls, plus Unicode line and paragraph separators U+2028/U+2029, are
rejected in filename segments because they make citations ambiguous or unsafe.
Sorting uses deterministic code-point ordering after the bounded scan.

### Security boundary

Directory identity checks protect against accidental traversal and ordinary
filesystem mutation. Node's `fs.Dir` does not expose handle-level `fstat`, so
the scanner does not claim to defeat an active same-user attacker performing a
precisely timed swap-and-restore between checks. Such an attacker already has
the filesystem privileges of the server process.

## Monorepo development

From the repository root:

```sh
npm install
npm test --workspace @deirs/documentation-retrieval-mcp
npm run typecheck --workspace @deirs/documentation-retrieval-mcp
npm run build --workspace @deirs/documentation-retrieval-mcp
npm run verify
```
