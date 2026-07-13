import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_LIMITS, loadConfig } from "../src/config.js";

test("loadConfig resolves the default repository root and conservative limits", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const config = await loadConfig({}, cwd);

  assert.equal(config.root, await realpath(cwd));
  assert.deepEqual(config.limits, DEFAULT_LIMITS);
});

test("loadConfig accepts positive integer limit overrides", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const config = await loadConfig(
    {
      REPO_MAX_FILE_BYTES: "1024",
      REPO_MAX_OUTPUT_BYTES: "2048",
      REPO_MAX_TREE_DEPTH: "3",
      REPO_MAX_TREE_ENTRIES: "25",
    },
    cwd,
  );

  assert.deepEqual(config.limits, {
    gitTimeoutMs: DEFAULT_LIMITS.gitTimeoutMs,
    maxFileBytes: 1024,
    maxOutputBytes: 2048,
    maxTreeDepth: 3,
    maxTreeEntries: 25,
  });
});

test("loadConfig rejects non-positive and non-integer limits", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    loadConfig({ REPO_MAX_TREE_DEPTH: "0" }, cwd),
    /REPO_MAX_TREE_DEPTH must be a positive integer/,
  );
  await assert.rejects(
    loadConfig({ REPO_MAX_TREE_ENTRIES: "1.5" }, cwd),
    /REPO_MAX_TREE_ENTRIES must be a positive integer/,
  );
});

test("loadConfig rejects a REPO_ROOT that is not a directory", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "root.txt"), "not a directory", "utf8");

  await assert.rejects(
    loadConfig({ REPO_ROOT: "root.txt" }, cwd),
    /REPO_ROOT must resolve to a directory/,
  );
});

test("loadConfig accepts a Git child timeout override", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const config = await loadConfig({ REPO_GIT_TIMEOUT_MS: "750" }, cwd);

  assert.equal(config.limits.gitTimeoutMs, 750);
});
