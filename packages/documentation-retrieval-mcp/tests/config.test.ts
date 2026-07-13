import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_LIMITS, loadConfig } from "../src/config.js";

test("loadConfig uses the canonical cwd and conservative defaults when DOC_ROOTS is absent", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "doc-retrieval-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const config = await loadConfig({}, cwd);

  assert.deepEqual(config.limits, DEFAULT_LIMITS);
  assert.equal(config.roots.length, 1);
  assert.equal(config.roots[0]?.path, await realpath(cwd));
  assert.match(config.roots[0]?.id ?? "", /^root-[0-9a-f]{16}$/);
});

test("DOC_ROOTS produces deduplicated, deterministically sorted roots with stable IDs", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "doc-retrieval-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(cwd, "alpha")),
    mkdir(path.join(cwd, "beta")),
  ]);
  const first = await loadConfig(
    {
      DOC_ROOTS: ["beta", "alpha", "beta"].join(path.delimiter),
    },
    cwd,
  );
  const second = await loadConfig(
    {
      DOC_ROOTS: ["alpha", "beta"].join(path.delimiter),
    },
    cwd,
  );

  assert.deepEqual(
    first.roots.map((root) => root.path),
    [
      await realpath(path.join(cwd, "alpha")),
      await realpath(path.join(cwd, "beta")),
    ],
  );
  assert.deepEqual(first.roots, second.roots);
  assert.equal(new Set(first.roots.map((root) => root.id)).size, 2);
});

test("loadConfig accepts all positive integer limit overrides", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "doc-retrieval-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const config = await loadConfig(
    {
      DOC_MAX_FILE_BYTES: "101",
      DOC_MAX_MATCHES: "7",
      DOC_MAX_EXCERPT_LINES: "5",
      DOC_MAX_LINE_LENGTH: "83",
      DOC_MAX_SCAN_FILES: "19",
      DOC_MAX_SCANNED_BYTES: "997",
      DOC_MAX_OUTPUT_BYTES: "211",
    },
    cwd,
  );

  assert.deepEqual(config.limits, {
    maxFileBytes: 101,
    maxMatches: 7,
    maxExcerptLines: 5,
    maxLineLength: 83,
    maxScanFiles: 19,
    maxScannedBytes: 997,
    maxOutputBytes: 211,
  });
});

test("loadConfig rejects empty roots and invalid limits", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "doc-retrieval-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    loadConfig({ DOC_ROOTS: "" }, cwd),
    /DOC_ROOTS must contain at least one directory/,
  );
  await assert.rejects(
    loadConfig({ DOC_MAX_MATCHES: "0" }, cwd),
    /DOC_MAX_MATCHES must be a positive integer/,
  );
  await assert.rejects(
    loadConfig({ DOC_MAX_SCAN_FILES: "1.5" }, cwd),
    /DOC_MAX_SCAN_FILES must be a positive integer/,
  );
});

test("loadConfig enforces the minimum complete output notice size", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "doc-retrieval-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const accepted = await loadConfig(
    { DOC_MAX_OUTPUT_BYTES: "64" },
    cwd,
  );
  assert.equal(accepted.limits.maxOutputBytes, 64);
  await assert.rejects(
    loadConfig({ DOC_MAX_OUTPUT_BYTES: "63" }, cwd),
    /DOC_MAX_OUTPUT_BYTES must be at least 64/,
  );
});
