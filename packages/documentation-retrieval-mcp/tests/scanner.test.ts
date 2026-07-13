import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { DocumentationRoot } from "../src/config.js";
import {
  collectDocumentCandidates,
  type DirectoryScanFileSystem,
  type ScanDirectoryEntry,
  type ScanMetadata,
} from "../src/scanner.js";

function directoryMetadata(dev = 1n, ino = 1n): ScanMetadata {
  return {
    dev,
    ino,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  };
}

function symlinkMetadata(): ScanMetadata {
  return {
    dev: 1n,
    ino: 2n,
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => true,
  };
}

function fileMetadata(dev = 1n, ino = 3n): ScanMetadata {
  return {
    dev,
    ino,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

test("collectDocumentCandidates discards an oversized directory after one lookahead", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  const names = ["z.md", "a.md", "m.md", "never-read.md"];
  let reads = 0;
  let closed = false;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () => directoryMetadata(),
    realpath: async (value) => value,
    opendir: async () => ({
      async read(): Promise<ScanDirectoryEntry | null> {
        const name = names[reads];
        reads += 1;
        return name === undefined
          ? null
          : {
              name,
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false,
            };
      },
      async close() {
        closed = true;
      },
    }),
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 3,
  });

  assert.equal(reads, 4);
  assert.equal(closed, true);
  assert.equal(result.entryLimitHit, true);
  assert.deepEqual(result.candidates, []);
});

test("collectDocumentCandidates admits exactly maxEntries without false truncation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  const names = ["z.md", "a.md", "m.md"];
  let reads = 0;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () => directoryMetadata(),
    realpath: async (value) => value,
    opendir: async () => ({
      async read(): Promise<ScanDirectoryEntry | null> {
        const name = names[reads];
        reads += 1;
        return name === undefined
          ? null
          : {
              name,
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false,
            };
      },
      async close() {},
    }),
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 3,
  });

  assert.equal(reads, 4);
  assert.equal(result.entryLimitHit, false);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.relativePath),
    ["a.md", "m.md", "z.md"],
  );
});

test("collectDocumentCandidates recurses in deterministic directory order", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };

  async function scanWithOrder(order: readonly string[]) {
    const fileSystem: DirectoryScanFileSystem = {
      lstat: async () => directoryMetadata(),
      stat: async () => directoryMetadata(),
      realpath: async (value) => value,
      opendir: async (filePath) => {
        const relative = path.relative(root.path, filePath);
        const entries =
          relative.length === 0
            ? order.map((name) => ({
                name,
                isDirectory: () => true,
                isFile: () => false,
                isSymbolicLink: () => false,
              }))
            : [
                {
                  name: "file.md",
                  isDirectory: () => false,
                  isFile: () => true,
                  isSymbolicLink: () => false,
                },
              ];
        let index = 0;
        return {
          async read(): Promise<ScanDirectoryEntry | null> {
            const entry = entries[index];
            index += 1;
            return entry ?? null;
          },
          async close() {},
        };
      },
    };
    return collectDocumentCandidates([root], {
      fileSystem,
      maxEntries: 3,
    });
  }

  const forward = await scanWithOrder(["a", "b"]);
  const reverse = await scanWithOrder(["b", "a"]);

  assert.deepEqual(
    forward.candidates.map((candidate) => candidate.relativePath),
    ["a/file.md"],
  );
  assert.deepEqual(forward.candidates, reverse.candidates);
  assert.equal(forward.entryLimitHit, true);
  assert.equal(reverse.entryLimitHit, true);
});

test("collectDocumentCandidates cancels between incremental entries", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  const controller = new AbortController();
  let reads = 0;
  let closed = false;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () => directoryMetadata(),
    realpath: async (value) => value,
    opendir: async () => ({
      async read(): Promise<ScanDirectoryEntry> {
        reads += 1;
        controller.abort();
        return {
          name: `entry-${reads}.md`,
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        };
      },
      async close() {
        closed = true;
      },
    }),
  };

  await assert.rejects(
    collectDocumentCandidates([root], {
      fileSystem,
      maxEntries: 10,
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "AbortError" &&
      /cancelled/i.test(error.message),
  );
  assert.equal(reads, 1);
  assert.equal(closed, true);
});

test("collectDocumentCandidates recursively discovers supported regular files", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "guides"));
  await Promise.all([
    writeFile(path.join(directory, "root.txt"), "root", "utf8"),
    writeFile(path.join(directory, "guides", "nested.md"), "nested", "utf8"),
    writeFile(path.join(directory, "guides", "ignored.html"), "ignored", "utf8"),
  ]);
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };

  const result = await collectDocumentCandidates([root], {
    maxEntries: 10,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.relativePath),
    ["guides/nested.md", "root.txt"],
  );
});

test("collectDocumentCandidates skips a directory replaced before open", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  const child = path.join(root.path, "child");
  let childOpened = false;
  let rootReads = 0;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async (filePath) =>
      filePath === child ? symlinkMetadata() : directoryMetadata(),
    stat: async () => directoryMetadata(),
    realpath: async (value) => value,
    async opendir(filePath) {
      if (filePath === child) {
        childOpened = true;
        throw new Error("unsafe child directory was opened");
      }
      return {
        async read(): Promise<ScanDirectoryEntry | null> {
          rootReads += 1;
          return rootReads === 1
            ? {
                name: "child",
                isDirectory: () => true,
                isFile: () => false,
                isSymbolicLink: () => false,
              }
            : null;
        },
        async close() {},
      };
    },
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 10,
  });

  assert.equal(childOpened, false);
  assert.equal(result.unsafeDirectoriesSkipped, 1);
  assert.deepEqual(result.candidates, []);
});

test("collectDocumentCandidates revalidates a directory immediately after open", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  let replaced = false;
  let reads = 0;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () =>
      replaced ? directoryMetadata(1n, 2n) : directoryMetadata(1n, 1n),
    realpath: async (value) => value,
    async opendir() {
      replaced = true;
      return {
        async read(): Promise<ScanDirectoryEntry | null> {
          reads += 1;
          return {
            name: "outside.md",
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          };
        },
        async close() {},
      };
    },
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 10,
  });

  assert.equal(reads, 0);
  assert.equal(result.unsafeDirectoriesSkipped, 1);
  assert.deepEqual(result.candidates, []);
});

test("collectDocumentCandidates revalidates during directory iteration", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  let replaced = false;
  let reads = 0;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () =>
      replaced ? directoryMetadata(1n, 2n) : directoryMetadata(1n, 1n),
    realpath: async (value) => value,
    async opendir() {
      return {
        async read(): Promise<ScanDirectoryEntry | null> {
          reads += 1;
          if (reads > 1) {
            return null;
          }
          replaced = true;
          return {
            name: "leak.md",
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          };
        },
        async close() {},
      };
    },
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 10,
  });

  assert.equal(reads, 1);
  assert.equal(result.unsafeDirectoriesSkipped, 1);
  assert.deepEqual(result.candidates, []);
});

test("collectDocumentCandidates discards candidates from a replaced directory", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  let replaced = false;
  let reads = 0;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () =>
      replaced ? directoryMetadata(1n, 2n) : directoryMetadata(1n, 1n),
    realpath: async (value) => value,
    opendir: async () => ({
      async read(): Promise<ScanDirectoryEntry | null> {
        reads += 1;
        if (reads === 1) {
          return {
            name: "before.md",
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          };
        }
        replaced = true;
        return {
          name: "after.md",
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        };
      },
      async close() {},
    }),
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 10,
  });

  assert.equal(reads, 2);
  assert.equal(result.unsafeDirectoriesSkipped, 1);
  assert.deepEqual(result.candidates, []);
});

test("collectDocumentCandidates converts directory close races to safe skips", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () => directoryMetadata(),
    realpath: async (value) => value,
    opendir: async () => ({
      async read() {
        return null;
      },
      async close() {
        const error = new Error("directory replaced") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    }),
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 10,
  });

  assert.equal(result.unsafeDirectoriesSkipped, 1);
  assert.deepEqual(result.candidates, []);
});

test("collectDocumentCandidates revalidates after directory iteration", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  let replaced = false;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () =>
      replaced ? directoryMetadata(1n, 2n) : directoryMetadata(1n, 1n),
    realpath: async (value) => value,
    opendir: async () => ({
      async read() {
        return null;
      },
      async close() {
        replaced = true;
      },
    }),
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 10,
  });

  assert.equal(result.unsafeDirectoriesSkipped, 1);
  assert.deepEqual(result.candidates, []);
});

test("collectDocumentCandidates starts at an existing relative path prefix", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(directory, "api")),
    mkdir(path.join(directory, "guides")),
  ]);
  await Promise.all([
    writeFile(path.join(directory, "api", "reference.md"), "api", "utf8"),
    writeFile(path.join(directory, "guides", "start.md"), "guide", "utf8"),
  ]);
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };

  const result = await collectDocumentCandidates([root], {
    maxEntries: 10,
    pathPrefix: "guides",
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.relativePath),
    ["guides/start.md"],
  );
});

test("collectDocumentCandidates opens no more directories after reaching the cap", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fileRoot: DocumentationRoot = {
    id: "root-file",
    path: path.join(directory, "file-root"),
  };
  const directoryRoot: DocumentationRoot = {
    id: "root-directory",
    path: path.join(directory, "directory-root"),
  };
  let opens = 0;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async (filePath) =>
      filePath.startsWith(fileRoot.path)
        ? fileMetadata()
        : directoryMetadata(),
    stat: async (filePath) =>
      filePath.startsWith(fileRoot.path)
        ? fileMetadata()
        : directoryMetadata(),
    realpath: async (value) => value,
    opendir: async () => {
      opens += 1;
      return {
        async read() {
          return null;
        },
        async close() {},
      };
    },
  };

  const result = await collectDocumentCandidates(
    [fileRoot, directoryRoot],
    {
      fileSystem,
      maxEntries: 1,
      pathPrefix: "target.md",
    },
  );

  assert.equal(result.entryLimitHit, true);
  assert.equal(opens, 0);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.relativePath),
    ["target.md"],
  );
});

test("collectDocumentCandidates skips ambiguous citation filenames", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };
  const names = [
    "bad:name.md",
    "bad|name.md",
    "bad\\name.md",
    "bad\nname.md",
    "bad\u2028name.md",
    "bad\u2029name.md",
    "good.md",
  ];
  let reads = 0;
  const fileSystem: DirectoryScanFileSystem = {
    lstat: async () => directoryMetadata(),
    stat: async () => directoryMetadata(),
    realpath: async (value) => value,
    opendir: async () => ({
      async read(): Promise<ScanDirectoryEntry | null> {
        const name = names[reads];
        reads += 1;
        return name === undefined
          ? null
          : {
              name,
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false,
            };
      },
      async close() {},
    }),
  };

  const result = await collectDocumentCandidates([root], {
    fileSystem,
    maxEntries: 10,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.relativePath),
    ["good.md"],
  );
});

test("real scans skip ambiguous POSIX filenames", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows forbids or reinterprets the tested filename delimiters");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "doc-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(directory, "bad:name.md"), "bad", "utf8"),
    writeFile(path.join(directory, "bad|name.md"), "bad", "utf8"),
    writeFile(path.join(directory, "bad\\name.md"), "bad", "utf8"),
    writeFile(path.join(directory, "bad\nname.md"), "bad", "utf8"),
    writeFile(path.join(directory, "bad\u2028name.md"), "bad", "utf8"),
    writeFile(path.join(directory, "bad\u2029name.md"), "bad", "utf8"),
    writeFile(path.join(directory, "good.md"), "good", "utf8"),
  ]);
  const root: DocumentationRoot = {
    id: "root-test",
    path: await realpath(directory),
  };

  const result = await collectDocumentCandidates([root], {
    maxEntries: 10,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.relativePath),
    ["good.md"],
  );
});
