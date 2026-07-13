# Repository Operations MCP

A read-only Model Context Protocol server for inspecting one local Git
repository over stdio.

## Requirements

- Node.js 22.12.0 or newer
- Git available on `PATH`

## Downloaded archive

Extract the ZIP, enter its versioned package directory, and install production
dependencies:

```sh
npm install --omit=dev
```

Set `REPO_ROOT` to the Git work-tree root, then use either packaged entrypoint:

```sh
node dist/index.js
npx --no-install repository-operations-mcp
```

Windows PowerShell:

```powershell
$env:REPO_ROOT = (Resolve-Path "C:\path\to\repository").Path
node .\dist\index.js
npx --no-install repository-operations-mcp
```

The server writes MCP JSON-RPC only to stdout. Startup failures are written to
stderr.

## Tools

- `repo_status` — current branch plus Git porcelain working-tree state.
- `show_diff` — bounded unstaged diff, or staged diff with `staged: true`.
- `list_tree` — bounded tracked/untracked Git path listing beneath `REPO_ROOT`.
- `read_file` — bounded, strict UTF-8 text read beneath `REPO_ROOT`.

All four tools carry read-only, non-destructive MCP annotations. The server
does not expose mutation tools.

## Configuration

`REPO_ROOT` defaults to the process working directory. It is resolved through
the filesystem to an absolute real directory before tools are registered.

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `REPO_GIT_TIMEOUT_MS` | `10000` (10 seconds) | Maximum lifetime of each Git child process |
| `REPO_MAX_FILE_BYTES` | `262144` (256 KiB) | Largest file `read_file` will read |
| `REPO_MAX_OUTPUT_BYTES` | `131072` (128 KiB) | Maximum UTF-8 bytes returned by a tool |
| `REPO_MAX_TREE_DEPTH` | `6` | Maximum recursive directory depth |
| `REPO_MAX_TREE_ENTRIES` | `1000` | Maximum listed entries |

Overrides must be positive integers. Request-level `show_diff.maxBytes`,
`list_tree.depth`, and `list_tree.maxEntries` can lower but never raise the
configured limits.

## Path safety

User paths are normalized, resolved with `realpath`, and checked against the
real `REPO_ROOT`. Traversal and symlinks whose targets escape the root are
rejected. Direct paths and symlinks resolving through `.git`, `node_modules`,
or `dist` are also rejected. Tree listings validate the requested base and
every Git-reported path, skipping unsafe symlinks.

Git commands require `REPO_ROOT` to be the exact work-tree root rather than a
directory that merely discovers a parent repository. Inherited `GIT_*`
redirects are stripped, global/system configuration is disabled, and local
and worktree-scoped filter drivers are enumerated and neutralized through
structured `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` overrides before status
or diff runs. Configured fsmonitor/external diff/textconv execution is
disabled, dirty gitlink worktrees are ignored while pointer changes remain
visible, and optional Git locks are disabled. Timeout or output overflow
terminates the complete child process tree and closes its stdio; a surviving
child handle is unreferenced after the bounded cleanup deadline.
These controls ensure Git can launch only its controlled internal operations.

`read_file` validates regular-file type before opening, uses non-blocking open
flags, and verifies the opened device/inode identity before reading.

`list_tree` is derived from NUL-delimited `git ls-files --cached --others
--exclude-standard` output and charges every inspected path—including unsafe
symlinks—against its work budget. Empty directories and ignored files are
intentionally omitted.

Expected path, Git, and file failures are returned as MCP tool errors rather
than terminating the server. Invalid startup configuration is reported on
stderr and exits without writing non-protocol output to stdout.

## Monorepo development

From the repository root:

```sh
npm install
npm test
npm run typecheck
npm run build
npm run verify
```
