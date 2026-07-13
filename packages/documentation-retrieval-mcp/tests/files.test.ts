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

import { DEFAULT_LIMITS } from "../src/config.js";
import {
  readDocumentFile,
  type DocumentFileSystem,
} from "../src/files.js";

const execFileAsync = promisify(execFile);

test("readDocumentFile reads supported UTF-8 documentation with normalized lines", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "guide.mdx"),
    "Heading\r\nSecond\rThird\n",
    "utf8",
  );

  const document = await readDocumentFile(
    await realpath(directory),
    "guide.mdx",
    DEFAULT_LIMITS,
  );

  assert.equal(document.relativePath, "guide.mdx");
  assert.equal(document.byteLength, 22);
  assert.deepEqual(document.lines, ["Heading", "Second", "Third", ""]);
});

test("readDocumentFile rejects unsupported extensions", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "page.html"), "needle", "utf8");

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "page.html",
      DEFAULT_LIMITS,
    ),
    /Unsupported documentation extension/,
  );
});

test("readDocumentFile enforces the configured file byte limit", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "large.md"), "123456", "utf8");

  await assert.rejects(
    readDocumentFile(await realpath(directory), "large.md", {
      ...DEFAULT_LIMITS,
      maxFileBytes: 5,
    }),
    /File size 6 bytes exceeds the 5 byte limit/,
  );
});

test("readDocumentFile rejects invalid UTF-8 binary content", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "binary.md"),
    Buffer.from([0xc3, 0x28]),
  );

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "binary.md",
      DEFAULT_LIMITS,
    ),
    /File is not UTF-8 text/,
  );
});

test("readDocumentFile rejects NUL-containing binary content", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "binary.txt"), "before\0after", "utf8");

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "binary.txt",
      DEFAULT_LIMITS,
    ),
    /File appears to be binary/,
  );
});

test("readDocumentFile rejects C0/C1 controls but allows text whitespace", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(directory, "escape.md"), "safe\u001b[31mred", "utf8"),
    writeFile(path.join(directory, "c1.md"), "safe\u0085bad", "utf8"),
    writeFile(path.join(directory, "whitespace.md"), "a\tb\r\nc\rd", "utf8"),
  ]);
  const root = await realpath(directory);

  await assert.rejects(
    readDocumentFile(root, "escape.md", DEFAULT_LIMITS),
    /File contains disallowed control characters/,
  );
  await assert.rejects(
    readDocumentFile(root, "c1.md", DEFAULT_LIMITS),
    /File contains disallowed control characters/,
  );
  const allowed = await readDocumentFile(
    root,
    "whitespace.md",
    DEFAULT_LIMITS,
  );
  assert.deepEqual(allowed.lines, ["a\tb", "c", "d"]);
});

test("readDocumentFile rejects non-regular filesystem entries", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "folder.md"));

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "folder.md",
      DEFAULT_LIMITS,
    ),
    /Path is not a regular file/,
  );
});

test("readDocumentFile rejects a file replaced between validation and open", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "replace.md");
  await writeFile(target, "before", "utf8");
  const fileSystem: DocumentFileSystem = {
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
    readDocumentFile(
      await realpath(directory),
      "replace.md",
      DEFAULT_LIMITS,
      { fileSystem },
    ),
    /File changed between validation and open/,
  );
});

test("readDocumentFile validates the opened identity again before returning", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "replace-after-open.md");
  await writeFile(target, "original", "utf8");
  const fileSystem: DocumentFileSystem = {
    stat: (filePath) => stat(filePath, { bigint: true }),
    async open(filePath, flags) {
      const handle = await open(filePath, flags);
      let replaced = false;
      return {
        close: () => handle.close(),
        async read(buffer, offset, length, position) {
          const result = await handle.read(buffer, offset, length, position);
          if (!replaced) {
            replaced = true;
            await rename(filePath, `${filePath}.opened`);
            await writeFile(filePath, "replacement", "utf8");
          }
          return result;
        },
        stat: () => handle.stat({ bigint: true }),
      };
    },
  };

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "replace-after-open.md",
      DEFAULT_LIMITS,
      { fileSystem },
    ),
    /File changed while being read/,
  );
});

test("readDocumentFile honors cancellation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "cancel.md"), "content", "utf8");
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "cancel.md",
      DEFAULT_LIMITS,
      { signal: controller.signal },
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "AbortError" &&
      /cancelled/i.test(error.message),
  );
});

test("readDocumentFile observes cancellation raised during a read", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "cancel-during-read.md");
  await writeFile(target, "content", "utf8");
  const controller = new AbortController();
  const fileSystem: DocumentFileSystem = {
    stat: (filePath) => stat(filePath, { bigint: true }),
    async open(filePath, flags) {
      const handle = await open(filePath, flags);
      return {
        close: () => handle.close(),
        async read(buffer, offset, length, position) {
          const result = await handle.read(buffer, offset, length, position);
          controller.abort();
          return result;
        },
        stat: () => handle.stat({ bigint: true }),
      };
    },
  };

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "cancel-during-read.md",
      DEFAULT_LIMITS,
      { fileSystem, signal: controller.signal },
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "AbortError" &&
      /cancelled/i.test(error.message),
  );
});

test("readDocumentFile rejects a FIFO without blocking when supported", async (t) => {
  if (process.platform === "win32") {
    t.skip("Filesystem FIFOs are not supported on Windows");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "doc-retrieval-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fifo = path.join(directory, "stream.md");
  try {
    await execFileAsync("mkfifo", [fifo], { windowsHide: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      t.skip("mkfifo is unavailable on this platform");
      return;
    }
    throw error;
  }

  await assert.rejects(
    readDocumentFile(
      await realpath(directory),
      "stream.md",
      DEFAULT_LIMITS,
    ),
    /Path is not a regular file/,
  );
});
