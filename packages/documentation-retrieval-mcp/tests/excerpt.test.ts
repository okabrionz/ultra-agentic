import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { readExcerpt } from "../src/excerpt.js";

test("readExcerpt returns cited lines using 1-based line numbers", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-excerpt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs"));
  await writeFile(
    path.join(root, "docs", "guide.md"),
    "one\ntwo\nthree\nfour",
    "utf8",
  );
  const config = await loadConfig({ DOC_ROOTS: root }, root);
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);

  const output = await readExcerpt(config, {
    rootId,
    path: "docs/guide.md",
    startLine: 2,
    lineCount: 2,
  });

  assert.equal(
    output,
    [
      `${rootId}:docs/guide.md:2 | two`,
      `${rootId}:docs/guide.md:3 | three`,
    ].join("\n"),
  );
});

test("readExcerpt rejects a programmatic config below the output minimum", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-excerpt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await loadConfig({ DOC_ROOTS: root }, root);
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);

  await assert.rejects(
    readExcerpt(
      {
        ...config,
        limits: {
          ...config.limits,
          maxOutputBytes: 63,
        },
      },
      {
        rootId,
        path: "missing.md",
        startLine: 1,
        lineCount: 1,
      },
    ),
    /maxOutputBytes must be at least 64/,
  );
});

test("readExcerpt clamps line count to the configured limit", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-excerpt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "guide.txt"), "one\ntwo\nthree\nfour\nfive", "utf8");
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_EXCERPT_LINES: "2",
    },
    root,
  );
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);

  const output = await readExcerpt(config, {
    rootId,
    path: "guide.txt",
    startLine: 3,
    lineCount: 99,
  });

  assert.equal(
    output,
    [
      `${rootId}:guide.txt:3 | three`,
      `${rootId}:guide.txt:4 | four`,
      "[truncated: line count clamped to 2]",
    ].join("\n"),
  );
});

test("readExcerpt rejects non-positive 1-based line inputs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-excerpt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "guide.md"), "one", "utf8");
  const config = await loadConfig({ DOC_ROOTS: root }, root);
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);

  await assert.rejects(
    readExcerpt(config, {
      rootId,
      path: "guide.md",
      startLine: 0,
      lineCount: 1,
    }),
    /startLine must be a positive integer/,
  );
  await assert.rejects(
    readExcerpt(config, {
      rootId,
      path: "guide.md",
      startLine: 1,
      lineCount: 0,
    }),
    /lineCount must be a positive integer/,
  );
});

test("readExcerpt bounds each cited line with an explicit marker", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-excerpt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "wide.rst"), "abcdefgh", "utf8");
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_LINE_LENGTH: "5",
    },
    root,
  );
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);

  const output = await readExcerpt(config, {
    rootId,
    path: "wide.rst",
    startLine: 1,
    lineCount: 1,
  });

  assert.equal(
    output,
    `${rootId}:wide.rst:1 | abcde… [line truncated]`,
  );
});

test("readExcerpt bounds total UTF-8 output", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-excerpt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "wide.md"),
    `${"世".repeat(50)}\n${"界".repeat(50)}`,
    "utf8",
  );
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_LINE_LENGTH: "100",
      DOC_MAX_OUTPUT_BYTES: "80",
    },
    root,
  );
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);

  const output = await readExcerpt(config, {
    rootId,
    path: "wide.md",
    startLine: 1,
    lineCount: 2,
  });

  assert.ok(Buffer.byteLength(output, "utf8") <= 80);
  assert.match(output, /\[truncated: output byte limit reached\]$/);
  assert.doesNotMatch(output, /\uFFFD/);
});
