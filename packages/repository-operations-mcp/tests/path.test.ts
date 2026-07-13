import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveRepositoryPath } from "../src/helpers/paths.js";

test("resolveRepositoryPath normalizes an existing path inside the root", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "repo-operations-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "nested"));
  const file = path.join(root, "nested", "file.txt");
  await writeFile(file, "inside", "utf8");

  const resolved = await resolveRepositoryPath(
    await realpath(root),
    "nested/../nested/file.txt",
  );

  assert.equal(resolved, await realpath(file));
});

test("resolveRepositoryPath rejects traversal outside the root", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "repo-operations-path-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "root");
  await mkdir(root);
  await writeFile(path.join(parent, "outside.txt"), "outside", "utf8");

  await assert.rejects(
    resolveRepositoryPath(await realpath(root), "../outside.txt"),
    /Path resolves outside REPO_ROOT/,
  );
});

test("resolveRepositoryPath rejects a symlink whose target is outside the root", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "repo-operations-path-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "root");
  const outside = path.join(parent, "outside.txt");
  const link = path.join(root, "external-link.txt");
  await mkdir(root);
  await writeFile(outside, "outside", "utf8");

  try {
    await symlink(outside, link, "file");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      t.skip(`File symlinks are unavailable on this platform (${code})`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    resolveRepositoryPath(await realpath(root), "external-link.txt"),
    /Path resolves outside REPO_ROOT/,
  );
});

test("resolveRepositoryPath rejects direct access through ignored components", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "repo-operations-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const component of [".git", "node_modules", "dist"]) {
    const directory = path.join(root, component);
    await mkdir(directory);
    await writeFile(path.join(directory, "secret.txt"), "hidden", "utf8");

    await assert.rejects(
      resolveRepositoryPath(
        await realpath(root),
        `${component}/secret.txt`,
      ),
      new RegExp(`ignored repository component: ${component.replace(".", "\\.")}`),
    );
  }
});

test("resolveRepositoryPath rejects internal symlinks resolving into ignored directories", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "repo-operations-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ignored = path.join(root, "node_modules");
  const link = path.join(root, "dependency-link");
  await mkdir(ignored);
  await writeFile(path.join(ignored, "secret.txt"), "hidden", "utf8");

  try {
    await symlink(
      ignored,
      link,
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

  await assert.rejects(
    resolveRepositoryPath(await realpath(root), "dependency-link/secret.txt"),
    /ignored repository component: node_modules/,
  );
});
