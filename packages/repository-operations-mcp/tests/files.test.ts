import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DEFAULT_LIMITS,
  type RepositoryConfig,
  type RepositoryLimits,
} from "../src/config.js";
import {
  readRepositoryFile,
  type ReadFileSystem,
} from "../src/tools/read-file.js";

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

test("readRepositoryFile returns UTF-8 text from inside the root", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "note.txt"), "hello, 世界\n", "utf8");
  const root = await realpath(directory);

  const content = await readRepositoryFile(configFor(root), "note.txt");

  assert.equal(content, "hello, 世界\n");
});

test("readRepositoryFile rejects files above the configured byte limit", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "large.txt"), "123456", "utf8");
  const root = await realpath(directory);

  await assert.rejects(
    readRepositoryFile(configFor(root, { maxFileBytes: 5 }), "large.txt"),
    /File size 6 bytes exceeds the 5 byte limit/,
  );
});

test("readRepositoryFile bounds output without splitting UTF-8 text", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "wide.txt"), "世".repeat(20), "utf8");
  const root = await realpath(directory);

  const content = await readRepositoryFile(
    configFor(root, { maxOutputBytes: 20 }),
    "wide.txt",
  );

  assert.ok(Buffer.byteLength(content, "utf8") <= 20);
  assert.match(content, /\[truncated\]$/);
  assert.doesNotMatch(content, /\uFFFD/);
});

test("readRepositoryFile rejects content that is not valid UTF-8", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "binary.dat"), Buffer.from([0xc3, 0x28]));
  const root = await realpath(directory);

  await assert.rejects(
    readRepositoryFile(configFor(root), "binary.dat"),
    /File is not valid UTF-8 text/,
  );
});

test("readRepositoryFile rejects directories", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "folder"));
  const root = await realpath(directory);

  await assert.rejects(
    readRepositoryFile(configFor(root), "folder"),
    /Path is not a regular file/,
  );
});

test("readRepositoryFile rejects a non-regular file before opening it", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "entry"), "regular for setup", "utf8");
  const root = await realpath(directory);
  let opened = false;
  const fileSystem: ReadFileSystem = {
    stat: async () => ({
      dev: 1n,
      ino: 2n,
      isFile: () => false,
      size: 0n,
    }),
    open: async () => {
      opened = true;
      throw new Error("open must not be called");
    },
  };

  await assert.rejects(
    readRepositoryFile(configFor(root), "entry", fileSystem),
    /Path is not a regular file/,
  );
  assert.equal(opened, false);
});

test("readRepositoryFile rejects a path replaced between validation and open", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "target.txt");
  await writeFile(target, "before", "utf8");
  const root = await realpath(directory);
  const fileSystem: ReadFileSystem = {
    stat: (filePath) => stat(filePath, { bigint: true }),
    async open(filePath, flags) {
      await rename(filePath, `${filePath}.validated`);
      await writeFile(filePath, "replacement", "utf8");
      const handle = await open(filePath, flags);
      return {
        close: () => handle.close(),
        read: (buffer, offset, length, position) =>
          handle.read(buffer, offset, length, position),
        stat: () => handle.stat({ bigint: true }),
      };
    },
  };

  await assert.rejects(
    readRepositoryFile(configFor(root), "target.txt", fileSystem),
    /File changed between validation and open/,
  );
});

test("readRepositoryFile rejects a FIFO without blocking when supported", async (t) => {
  if (process.platform === "win32") {
    t.skip("Filesystem FIFOs are not supported on Windows");
    return;
  }

  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fifo = path.join(directory, "stream");
  try {
    await execFileAsync("mkfifo", [fifo], { windowsHide: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      t.skip("mkfifo is unavailable on this platform");
      return;
    }
    throw error;
  }

  const startedAt = Date.now();
  let writer: Promise<void> | undefined;
  const unblock = setTimeout(() => {
    writer = writeFile(fifo, "x");
  }, 1000);

  try {
    await assert.rejects(
      readRepositoryFile(
        configFor(await realpath(directory)),
        "stream",
      ),
      /Path is not a regular file/,
    );
    assert.ok(Date.now() - startedAt < 700);
  } finally {
    clearTimeout(unblock);
    await writer;
  }
});
