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

import { resolveDocumentPath } from "../src/files.js";

test("resolveDocumentPath rejects traversal in portable relative paths", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "doc-retrieval-path-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "root");
  await mkdir(root);
  await writeFile(path.join(parent, "outside.md"), "secret", "utf8");
  const canonicalRoot = await realpath(root);

  await assert.rejects(
    resolveDocumentPath(canonicalRoot, "../outside.md"),
    /Path traversal is not allowed/,
  );
});

test("resolveDocumentPath rejects ambiguous portable citation segments", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canonicalRoot = await realpath(root);

  for (const requestedPath of [
    "folder\\file.md",
    "line\nbreak.md",
    "carriage\rbreak.md",
    "line\u2028separator.md",
    "paragraph\u2029separator.md",
    "colon:name.md",
    "pipe|name.md",
  ]) {
    await assert.rejects(
      resolveDocumentPath(canonicalRoot, requestedPath),
      /Path contains an ambiguous filename segment/,
    );
  }
});

test("resolveDocumentPath rejects a file symlink resolving outside its root", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "doc-retrieval-path-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "root");
  const outside = path.join(parent, "outside.md");
  const link = path.join(root, "external.md");
  await mkdir(root);
  await writeFile(outside, "secret", "utf8");
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
    resolveDocumentPath(await realpath(root), "external.md"),
    /Path resolves outside its documentation root/,
  );
});
