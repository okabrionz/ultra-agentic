import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import {
  DEFAULT_LIMITS,
  type RepositoryConfig,
  type RepositoryLimits,
} from "../src/config.js";
import { listRepositoryTree } from "../src/tools/list-tree.js";

const execFileAsync = promisify(execFile);

function configFor(
  root: string,
  limits: Partial<RepositoryLimits> = {},
): RepositoryConfig {
  return {
    root,
    limits: {
      ...DEFAULT_LIMITS,
      ...limits,
    },
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

async function createGitRepository(t: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-tree-git-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "-b", "main");
  await git(directory, "config", "user.name", "Git Tree Tests");
  await git(directory, "config", "user.email", "tree@example.invalid");
  return realpath(directory);
}

test("listRepositoryTree uses tracked and untracked Git paths while omitting ignored and empty entries", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(
    path.join(root, ".gitignore"),
    "ignored.txt\ndist/\n",
    "utf8",
  );
  await writeFile(path.join(root, "tracked.txt"), "tracked", "utf8");
  await git(root, "add", ".gitignore", "tracked.txt");
  await git(root, "commit", "-m", "tracked files");
  await writeFile(path.join(root, "untracked.txt"), "untracked", "utf8");
  await writeFile(path.join(root, "ignored.txt"), "ignored", "utf8");
  await mkdir(path.join(root, "empty"));
  await mkdir(path.join(root, "dist"));
  await writeFile(path.join(root, "dist", "bundle.js"), "ignored", "utf8");

  const listing = await listRepositoryTree(configFor(root));
  const entries = new Set(listing.split("\n"));

  assert.deepEqual(entries, new Set([
    ".gitignore",
    "tracked.txt",
    "untracked.txt",
  ]));
});

test("listRepositoryTree escapes newline filenames from NUL-delimited Git output", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows filenames cannot contain newlines");
    return;
  }

  const root = await createGitRepository(t);
  await writeFile(path.join(root, "line\nbreak.txt"), "content", "utf8");

  const listing = await listRepositoryTree(configFor(root));

  assert.equal(listing, "line\\nbreak.txt");
});

test("listRepositoryTree applies depth relative to the requested base path", async (t) => {
  const root = await createGitRepository(t);
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await writeFile(path.join(root, "top.txt"), "top", "utf8");
  await writeFile(path.join(root, "src", "a.txt"), "a", "utf8");
  await writeFile(path.join(root, "src", "deep", "b.txt"), "b", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "nested files");

  const rootListing = await listRepositoryTree(configFor(root), {
    depth: 1,
  });
  const srcListing = await listRepositoryTree(configFor(root), {
    depth: 0,
    path: "src",
  });

  assert.deepEqual(new Set(rootListing.split("\n")), new Set([
    "src/",
    "src/a.txt",
    "src/deep/",
    "top.txt",
  ]));
  assert.deepEqual(new Set(srcListing.split("\n")), new Set([
    "src/a.txt",
    "src/deep/",
  ]));
});

test("listRepositoryTree preserves entry and work limits for Git paths", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(path.join(root, "a.txt"), "a", "utf8");
  await writeFile(path.join(root, "b.txt"), "b", "utf8");
  await writeFile(path.join(root, "c.txt"), "c", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "bounded files");

  const listing = await listRepositoryTree(
    configFor(root, { maxTreeEntries: 2 }),
  );

  assert.equal(listing, "a.txt\nb.txt\n[entry limit reached: 2]");
});

test("listRepositoryTree skips an external symlink while charging its work budget", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "repo-tree-git-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "root");
  const outside = path.join(parent, "outside.txt");
  await mkdir(root);
  await git(root, "init", "-b", "main");
  await writeFile(outside, "outside", "utf8");
  await writeFile(path.join(root, "visible.txt"), "visible", "utf8");
  try {
    await symlink(outside, path.join(root, "external-link.txt"), "file");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      t.skip(`File symlinks are unavailable on this platform (${code})`);
      return;
    }
    throw error;
  }

  const listing = await listRepositoryTree(
    configFor(await realpath(root), { maxTreeEntries: 1 }),
  );

  assert.equal(listing, "[entry limit reached: 1]");
});

test("listRepositoryTree charges a tracked ignored component against its work budget", async (t) => {
  const root = await createGitRepository(t);
  await mkdir(path.join(root, "dist"));
  await writeFile(path.join(root, "dist", "hidden.txt"), "hidden", "utf8");
  await writeFile(path.join(root, "visible.txt"), "visible", "utf8");
  await git(root, "add", "-f", "dist/hidden.txt", "visible.txt");
  await git(root, "commit", "-m", "tracked ignored component");

  const listing = await listRepositoryTree(
    configFor(root, { maxTreeEntries: 1 }),
  );

  assert.equal(listing, "[entry limit reached: 1]");
});

test("listRepositoryTree bounds Git-derived text output", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(
    path.join(root, "a-very-long-untracked-filename.txt"),
    "content",
    "utf8",
  );

  const listing = await listRepositoryTree(
    configFor(root, { maxOutputBytes: 24 }),
  );

  assert.ok(Buffer.byteLength(listing, "utf8") <= 24);
  assert.match(listing, /\[truncated\]$/);
});

test("listRepositoryTree forwards cancellation to its Git commands", async (t) => {
  const root = await createGitRepository(t);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    listRepositoryTree(configFor(root), {
      signal: controller.signal,
    }),
    /Process cancelled/,
  );
});
