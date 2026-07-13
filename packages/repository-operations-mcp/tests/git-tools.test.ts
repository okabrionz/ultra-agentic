import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
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
import { getRepositoryStatus } from "../src/tools/repo-status.js";
import { showRepositoryDiff } from "../src/tools/show-diff.js";

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

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
}

function quoteGitShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function createGitRepository(t: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-git-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "-b", "main");
  await git(directory, "config", "user.name", "Repository Operations Tests");
  await git(directory, "config", "user.email", "tests@example.invalid");
  await writeFile(path.join(directory, "tracked.txt"), "original\n", "utf8");
  await git(directory, "add", "tracked.txt");
  await git(directory, "commit", "-m", "initial");
  return realpath(directory);
}

test("getRepositoryStatus reports the branch and porcelain working tree state", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");
  await writeFile(path.join(root, "new.txt"), "new\n", "utf8");

  const status = await getRepositoryStatus(configFor(root));

  assert.match(status, /^Branch: main$/m);
  assert.match(status, /^ M tracked\.txt$/m);
  assert.match(status, /^\?\? new\.txt$/m);
});

test("showRepositoryDiff selects unstaged or staged changes", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(path.join(root, "tracked.txt"), "staged\n", "utf8");
  await git(root, "add", "tracked.txt");
  await writeFile(path.join(root, "tracked.txt"), "working\n", "utf8");

  const unstaged = await showRepositoryDiff(configFor(root));
  const staged = await showRepositoryDiff(configFor(root), { staged: true });

  assert.match(unstaged, /^\+working$/m);
  assert.match(unstaged, /^-staged$/m);
  assert.doesNotMatch(unstaged, /^\+staged$/m);
  assert.match(staged, /^\+staged$/m);
  assert.match(staged, /^-original$/m);
  assert.doesNotMatch(staged, /working/);
});

test("showRepositoryDiff enforces the configured and requested output limits", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(path.join(root, "tracked.txt"), `${"changed ".repeat(50)}\n`, "utf8");

  const diff = await showRepositoryDiff(
    configFor(root, { maxOutputBytes: 40 }),
    { maxBytes: 30 },
  );

  assert.ok(Buffer.byteLength(diff, "utf8") <= 30);
  assert.match(diff, /\[truncated\]$/);
});

test("getRepositoryStatus bounds porcelain output", async (t) => {
  const root = await createGitRepository(t);
  for (let index = 0; index < 10; index += 1) {
    await writeFile(path.join(root, `untracked-${index}.txt`), "new\n", "utf8");
  }

  const status = await getRepositoryStatus(
    configFor(root, { maxOutputBytes: 40 }),
  );

  assert.ok(Buffer.byteLength(status, "utf8") <= 40);
  assert.match(status, /\[truncated\]$/);
});

test("showRepositoryDiff safely truncates output larger than execFile buffers", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(path.join(root, "tracked.txt"), `${"x".repeat(1_200_000)}\n`, "utf8");

  const diff = await showRepositoryDiff(
    configFor(root, { maxOutputBytes: 128 }),
  );

  assert.ok(Buffer.byteLength(diff, "utf8") <= 128);
  assert.match(diff, /\[truncated\]$/);
});

test("getRepositoryStatus identifies a detached HEAD", async (t) => {
  const root = await createGitRepository(t);
  const commit = (await git(root, "rev-parse", "--short", "HEAD")).trim();
  await git(root, "checkout", "--detach");

  const status = await getRepositoryStatus(configFor(root));

  assert.match(status, new RegExp(`^Branch: \\(detached at ${commit}\\)$`, "m"));
});

test("Git tools reject a nested directory that only discovers a parent repository", async (t) => {
  const root = await createGitRepository(t);
  const nested = path.join(root, "nested");
  await mkdir(nested);

  await assert.rejects(
    getRepositoryStatus(configFor(await realpath(nested))),
    /REPO_ROOT must be the exact Git work tree root/,
  );
});

test("showRepositoryDiff rejects a nested directory that discovers a parent repository", async (t) => {
  const root = await createGitRepository(t);
  const nested = path.join(root, "nested");
  await mkdir(nested);

  await assert.rejects(
    showRepositoryDiff(configFor(await realpath(nested))),
    /REPO_ROOT must be the exact Git work tree root/,
  );
});

test("Git tools ignore inherited environment variables that redirect repository state", async (t) => {
  const root = await createGitRepository(t);
  const redirectedRoot = await createGitRepository(t);
  await git(redirectedRoot, "branch", "-m", "redirected");
  const redirectedGitDirectory = path.join(redirectedRoot, ".git");
  const overrides: Record<string, string> = {
    GIT_DIR: redirectedGitDirectory,
    GIT_WORK_TREE: redirectedRoot,
    GIT_INDEX_FILE: path.join(redirectedGitDirectory, "index"),
    GIT_OBJECT_DIRECTORY: path.join(redirectedGitDirectory, "objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(
      redirectedGitDirectory,
      "objects",
    ),
    GIT_COMMON_DIR: redirectedGitDirectory,
    GIT_EXTERNAL_DIFF: "definitely-not-a-real-command",
  };
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }

  try {
    const status = await getRepositoryStatus(configFor(root));
    assert.match(status, /^Branch: main$/m);
    assert.doesNotMatch(status, /redirected/);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test("showRepositoryDiff ignores an inherited GIT_DIR and GIT_WORK_TREE", async (t) => {
  const root = await createGitRepository(t);
  const redirectedRoot = await createGitRepository(t);
  await writeFile(path.join(root, "tracked.txt"), "root change\n", "utf8");
  await writeFile(
    path.join(redirectedRoot, "tracked.txt"),
    "redirected change\n",
    "utf8",
  );
  const previousDirectory = process.env.GIT_DIR;
  const previousWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(redirectedRoot, ".git");
  process.env.GIT_WORK_TREE = redirectedRoot;

  try {
    const diff = await showRepositoryDiff(configFor(root));
    assert.match(diff, /^\+root change$/m);
    assert.doesNotMatch(diff, /redirected change/);
  } finally {
    if (previousDirectory === undefined) {
      delete process.env.GIT_DIR;
    } else {
      process.env.GIT_DIR = previousDirectory;
    }
    if (previousWorkTree === undefined) {
      delete process.env.GIT_WORK_TREE;
    } else {
      process.env.GIT_WORK_TREE = previousWorkTree;
    }
  }
});

test("Git tools never execute a repository-configured filter command", async (t) => {
  const root = await createGitRepository(t);
  const helper = path.join(root, "filter-helper.cjs");
  const sentinel = path.join(root, "filter-executed.txt");
  await writeFile(
    helper,
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync(process.argv[2], "executed");',
      "process.stdin.pipe(process.stdout);",
    ].join("\n"),
    "utf8",
  );
  const command = [
    quoteGitShellArgument(process.execPath.replaceAll("\\", "/")),
    quoteGitShellArgument(helper.replaceAll("\\", "/")),
    quoteGitShellArgument(sentinel.replaceAll("\\", "/")),
  ].join(" ");
  await git(root, "config", "filter.sentinel.clean", command);
  await git(root, "config", "filter.sentinel.smudge", command);
  await git(root, "config", "filter.sentinel.required", "true");
  await writeFile(
    path.join(root, ".gitattributes"),
    "tracked.txt filter=sentinel\n",
    "utf8",
  );
  await git(root, "add", ".gitattributes", "filter-helper.cjs");
  await git(root, "commit", "-m", "configure local filter");
  await rm(sentinel, { force: true });
  await writeFile(path.join(root, "tracked.txt"), "filtered change\n", "utf8");

  await getRepositoryStatus(configFor(root));
  await showRepositoryDiff(configFor(root));

  await assert.rejects(access(sentinel), { code: "ENOENT" });
});

test("Git filter neutralization handles a driver name containing equals", async (t) => {
  const root = await createGitRepository(t);
  const helper = path.join(root, "equals-filter-helper.cjs");
  const sentinel = path.join(root, "equals-filter-executed.txt");
  await writeFile(
    helper,
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync(process.argv[2], "executed");',
      "process.stdin.pipe(process.stdout);",
    ].join("\n"),
    "utf8",
  );
  const command = [
    quoteGitShellArgument(process.execPath.replaceAll("\\", "/")),
    quoteGitShellArgument(helper.replaceAll("\\", "/")),
    quoteGitShellArgument(sentinel.replaceAll("\\", "/")),
  ].join(" ");
  const driver = "sentinel=equals";
  await git(root, "config", `filter.${driver}.clean`, command);
  await git(root, "config", `filter.${driver}.required`, "true");
  await writeFile(
    path.join(root, ".gitattributes"),
    `tracked.txt filter=${driver}\n`,
    "utf8",
  );
  await git(root, "add", ".gitattributes", "equals-filter-helper.cjs");
  await git(root, "commit", "-m", "configure equals filter");
  await rm(sentinel, { force: true });
  await writeFile(path.join(root, "tracked.txt"), "equals change\n", "utf8");

  await getRepositoryStatus(configFor(root));
  await showRepositoryDiff(configFor(root));

  await assert.rejects(access(sentinel), { code: "ENOENT" });
});

test("Git tools neutralize linked-worktree filter configuration", async (t) => {
  const root = await createGitRepository(t);
  await writeFile(
    path.join(root, ".gitattributes"),
    "tracked.txt filter=worktree-sentinel\n",
    "utf8",
  );
  await git(root, "add", ".gitattributes");
  await git(root, "commit", "-m", "configure worktree attributes");
  await git(root, "config", "extensions.worktreeConfig", "true");

  const worktreeParent = await mkdtemp(
    path.join(tmpdir(), "repo-operations-linked-"),
  );
  t.after(() => rm(worktreeParent, { recursive: true, force: true }));
  const linkedRoot = path.join(worktreeParent, "linked");
  await git(
    root,
    "worktree",
    "add",
    "-b",
    "linked-filter-test",
    linkedRoot,
  );
  const helper = path.join(linkedRoot, "worktree-filter-helper.cjs");
  const sentinel = path.join(linkedRoot, "worktree-filter-executed.txt");
  await writeFile(
    helper,
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync(process.argv[2], "executed");',
      "process.stdin.pipe(process.stdout);",
    ].join("\n"),
    "utf8",
  );
  const command = [
    quoteGitShellArgument(process.execPath.replaceAll("\\", "/")),
    quoteGitShellArgument(helper.replaceAll("\\", "/")),
    quoteGitShellArgument(sentinel.replaceAll("\\", "/")),
  ].join(" ");
  await git(
    linkedRoot,
    "config",
    "--worktree",
    "filter.worktree-sentinel.clean",
    command,
  );
  await git(
    linkedRoot,
    "config",
    "--worktree",
    "filter.worktree-sentinel.required",
    "true",
  );
  await writeFile(
    path.join(linkedRoot, "tracked.txt"),
    "worktree change\n",
    "utf8",
  );

  await getRepositoryStatus(configFor(await realpath(linkedRoot)));
  await showRepositoryDiff(configFor(await realpath(linkedRoot)));

  await assert.rejects(access(sentinel), { code: "ENOENT" });
});

test("Git tools ignore dirty gitlink worktrees but show pointer changes", async (t) => {
  const root = await createGitRepository(t);
  const nested = path.join(root, "vendor");
  await mkdir(nested);
  await git(nested, "init", "-b", "main");
  await git(nested, "config", "user.name", "Nested Repository Tests");
  await git(nested, "config", "user.email", "nested@example.invalid");
  await writeFile(path.join(nested, "inside.txt"), "original\n", "utf8");
  await git(nested, "add", "inside.txt");
  await git(nested, "commit", "-m", "nested initial");
  await git(root, "add", "vendor");
  await git(root, "commit", "-m", "track nested gitlink");
  await writeFile(path.join(nested, "inside.txt"), "dirty\n", "utf8");

  const status = await getRepositoryStatus(configFor(root));
  const diff = await showRepositoryDiff(configFor(root));

  assert.match(status, /^Working tree:\n\(clean\)$/m);
  assert.equal(diff, "(no differences)");

  await git(nested, "add", "inside.txt");
  await git(nested, "commit", "-m", "advance nested pointer");

  const pointerStatus = await getRepositoryStatus(configFor(root));
  const pointerDiff = await showRepositoryDiff(configFor(root));

  assert.match(pointerStatus, /^ M vendor$/m);
  assert.match(pointerDiff, /Subproject commit/);
});
