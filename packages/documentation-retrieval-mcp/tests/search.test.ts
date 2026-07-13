import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { searchDocuments } from "../src/search.js";

test("searchDocuments performs case-insensitive literal search with stable citations", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "guides"));
  await writeFile(
    path.join(root, "guides", "Guide.MD"),
    "Intro\nNeedle[1] here\nThird\nnEeDlE[1] again",
    "utf8",
  );
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_EXCERPT_LINES: "1",
    },
    root,
  );
  const rootId = config.roots[0]?.id;

  const output = await searchDocuments(config, { query: "NEEDLE[1]" });

  assert.equal(
    output,
    [
      `${rootId}:guides/Guide.MD:2`,
      "  2 | Needle[1] here",
      "",
      `${rootId}:guides/Guide.MD:4`,
      "  4 | nEeDlE[1] again",
    ].join("\n"),
  );
});

test("searchDocuments rejects a programmatic config below the output minimum", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await loadConfig({ DOC_ROOTS: root }, root);

  await assert.rejects(
    searchDocuments(
      {
        ...config,
        limits: {
          ...config.limits,
          maxOutputBytes: 63,
        },
      },
      { query: "needle" },
    ),
    /maxOutputBytes must be at least 64/,
  );
});

test("searchDocuments searches multiple roots deterministically and honors rootId", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const alpha = path.join(parent, "alpha");
  const beta = path.join(parent, "beta");
  await Promise.all([mkdir(alpha), mkdir(beta)]);
  await Promise.all([
    writeFile(path.join(alpha, "alpha.md"), "shared needle", "utf8"),
    writeFile(path.join(beta, "beta.md"), "shared needle", "utf8"),
  ]);
  const config = await loadConfig(
    {
      DOC_ROOTS: [beta, alpha].join(path.delimiter),
      DOC_MAX_EXCERPT_LINES: "1",
    },
    parent,
  );
  const [firstRoot, secondRoot] = config.roots;
  assert.ok(firstRoot);
  assert.ok(secondRoot);

  const allRoots = await searchDocuments(config, { query: "needle" });
  const secondOnly = await searchDocuments(config, {
    query: "needle",
    rootId: secondRoot.id,
  });

  assert.ok(
    allRoots.indexOf(`${firstRoot.id}:alpha.md:1`) <
      allRoots.indexOf(`${secondRoot.id}:beta.md:1`),
  );
  assert.doesNotMatch(secondOnly, new RegExp(firstRoot.id));
  assert.match(secondOnly, new RegExp(`${secondRoot.id}:beta\\.md:1`));
});

test("searchDocuments limits scanning to a canonical relative path prefix", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(root, "api")),
    mkdir(path.join(root, "guides")),
  ]);
  await Promise.all([
    writeFile(path.join(root, "api", "reference.md"), "needle", "utf8"),
    writeFile(path.join(root, "guides", "start.md"), "needle", "utf8"),
  ]);
  const config = await loadConfig({ DOC_ROOTS: root }, root);

  const output = await searchDocuments(config, {
    query: "needle",
    pathPrefix: "guides",
  });

  assert.doesNotMatch(output, /api\/reference\.md/);
  assert.match(output, /guides\/start\.md:1/);
});

test("path prefixes can match only a subset of configured roots", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const alpha = path.join(parent, "alpha");
  const beta = path.join(parent, "beta");
  await Promise.all([
    mkdir(alpha),
    mkdir(path.join(beta, "guides"), { recursive: true }),
  ]);
  await writeFile(path.join(beta, "guides", "start.md"), "needle", "utf8");
  const config = await loadConfig(
    { DOC_ROOTS: [alpha, beta].join(path.delimiter) },
    parent,
  );

  const output = await searchDocuments(config, {
    query: "needle",
    pathPrefix: "guides",
  });

  assert.match(output, /:guides\/start\.md:1/);
});

test("searchDocuments ignores unsupported and binary files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(root, "valid.rst"), "needle", "utf8"),
    writeFile(path.join(root, "unsupported.html"), "needle", "utf8"),
    writeFile(path.join(root, "binary.md"), Buffer.from([0xc3, 0x28])),
  ]);
  const config = await loadConfig({ DOC_ROOTS: root }, root);

  const output = await searchDocuments(config, { query: "needle" });

  assert.match(output, /:valid\.rst:1/);
  assert.doesNotMatch(output, /unsupported\.html|binary\.md/);
});

test("searchDocuments truncates matches with an explicit notice", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "many.txt"),
    "needle one\nneedle two",
    "utf8",
  );
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_MATCHES: "1",
      DOC_MAX_EXCERPT_LINES: "1",
    },
    root,
  );

  const output = await searchDocuments(config, { query: "needle" });

  assert.match(output, /:many\.txt:1/);
  assert.doesNotMatch(output, /:many\.txt:2/);
  assert.match(output, /\[truncated: match limit reached \(1\)\]$/);
});

test("searchDocuments skips oversized files with an explicit notice", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(root, "a-large.md"), "needle ".repeat(5), "utf8"),
    writeFile(path.join(root, "z-small.md"), "needle", "utf8"),
  ]);
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_FILE_BYTES: "10",
    },
    root,
  );

  const output = await searchDocuments(config, { query: "needle" });

  assert.doesNotMatch(output, /a-large\.md/);
  assert.match(output, /z-small\.md:1/);
  assert.match(
    output,
    /\[truncated: file byte limit skipped 1 file\]$/,
  );
});

test("searchDocuments counts skipped entries against the scan file budget", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(root, "a-unsupported.html"), "needle", "utf8"),
    writeFile(path.join(root, "b-supported.md"), "needle", "utf8"),
  ]);
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_SCAN_FILES: "1",
    },
    root,
  );

  const output = await searchDocuments(config, { query: "needle" });

  assert.doesNotMatch(output, /b-supported\.md/);
  assert.equal(output, "[truncated: scan file limit reached (1)]");
});

test("searchDocuments bounds cumulative scanned bytes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(root, "a-first.md"), "12345", "utf8"),
    writeFile(path.join(root, "b-second.md"), "needle", "utf8"),
  ]);
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_SCANNED_BYTES: "5",
    },
    root,
  );

  const output = await searchDocuments(config, { query: "needle" });

  assert.doesNotMatch(output, /b-second\.md/);
  assert.equal(output, "[truncated: scanned byte limit reached (5)]");
});

test("binary files consume the scanned byte budget", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(
      path.join(root, "a-binary.md"),
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
    ),
    writeFile(path.join(root, "b-readable.md"), "hit", "utf8"),
  ]);
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_SCANNED_BYTES: "5",
    },
    root,
  );

  const output = await searchDocuments(config, { query: "hit" });

  assert.doesNotMatch(output, /b-readable\.md/);
  assert.equal(output, "[truncated: scanned byte limit reached (5)]");
});

test("searchDocuments bounds UTF-8 output with an explicit notice", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "wide.md"),
    `needle ${"世".repeat(100)}`,
    "utf8",
  );
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_LINE_LENGTH: "500",
      DOC_MAX_OUTPUT_BYTES: "64",
    },
    root,
  );

  const output = await searchDocuments(config, { query: "needle" });

  assert.ok(Buffer.byteLength(output, "utf8") <= 64);
  assert.match(output, /\[truncated: output byte limit reached\]$/);
  assert.doesNotMatch(output, /\uFFFD/);
});

test("searchDocuments honors cancellation during scans", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "guide.md"), "needle", "utf8");
  const config = await loadConfig({ DOC_ROOTS: root }, root);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    searchDocuments(config, {
      query: "needle",
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "AbortError" &&
      /cancelled/i.test(error.message),
  );
});

test("searchDocuments does not follow directory symlinks during scans", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "doc-retrieval-search-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "root");
  const outside = path.join(parent, "outside");
  await Promise.all([mkdir(root), mkdir(outside)]);
  await writeFile(path.join(outside, "secret.md"), "needle", "utf8");
  try {
    await symlink(
      outside,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      t.skip(`Directory symlinks are unavailable on this platform (${code})`);
      return;
    }
    throw error;
  }
  const config = await loadConfig({ DOC_ROOTS: root }, root);

  const output = await searchDocuments(config, { query: "needle" });

  assert.equal(output, "No matches.");
});
