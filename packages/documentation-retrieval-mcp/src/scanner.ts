import {
  lstat,
  opendir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

import type { DocumentationRoot } from "./config.js";
import {
  isInsideRoot,
  isSafeCitationSegment,
  isSupportedDocumentPath,
  normalizeRelativePath,
  throwIfCancelled,
} from "./files.js";

export interface ScanMetadata {
  readonly dev: bigint;
  readonly ino: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface ScanDirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface ScanDirectoryHandle {
  read(): Promise<ScanDirectoryEntry | null>;
  close(): Promise<void>;
}

export interface DirectoryScanFileSystem {
  lstat(filePath: string): Promise<ScanMetadata>;
  stat(filePath: string): Promise<ScanMetadata>;
  realpath(filePath: string): Promise<string>;
  opendir(filePath: string): Promise<ScanDirectoryHandle>;
}

export interface DocumentCandidate {
  readonly root: DocumentationRoot;
  readonly relativePath: string;
}

export interface CollectDocumentCandidatesOptions {
  readonly maxEntries: number;
  readonly pathPrefix?: string;
  readonly signal?: AbortSignal;
  readonly fileSystem?: DirectoryScanFileSystem;
}

export interface DocumentCandidateCollection {
  readonly candidates: readonly DocumentCandidate[];
  readonly entryLimitHit: boolean;
  readonly unsafeDirectoriesSkipped: number;
}

const nodeDirectoryScanFileSystem: DirectoryScanFileSystem = {
  lstat: (filePath) => lstat(filePath, { bigint: true }),
  stat: (filePath) => stat(filePath, { bigint: true }),
  realpath,
  async opendir(filePath) {
    const directory = await opendir(filePath, { bufferSize: 1 });
    return {
      read: () => directory.read(),
      close: () => directory.close(),
    };
  },
};

function compareCandidates(
  left: DocumentCandidate,
  right: DocumentCandidate,
): number {
  if (left.root.path !== right.root.path) {
    return left.root.path < right.root.path ? -1 : 1;
  }
  return left.relativePath < right.relativePath
    ? -1
    : left.relativePath > right.relativePath
      ? 1
      : 0;
}

interface ValidatedDirectory {
  readonly canonicalPath: string;
  readonly dev: bigint;
  readonly ino: bigint;
}

class UnsafeDirectoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnsafeDirectoryError";
  }
}

async function validateDirectory(
  fileSystem: DirectoryScanFileSystem,
  root: DocumentationRoot,
  requestedPath: string,
  expected?: ValidatedDirectory,
): Promise<ValidatedDirectory> {
  let entry: ScanMetadata;
  let canonicalPath: string;
  let target: ScanMetadata;
  try {
    entry = await fileSystem.lstat(requestedPath);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new UnsafeDirectoryError(
        "Directory is not a regular non-symlink directory",
      );
    }
    canonicalPath = await fileSystem.realpath(requestedPath);
    if (!isInsideRoot(root.path, canonicalPath)) {
      throw new UnsafeDirectoryError(
        "Directory resolves outside its documentation root",
      );
    }
    target = await fileSystem.stat(canonicalPath);
  } catch (error) {
    if (error instanceof UnsafeDirectoryError) {
      throw error;
    }
    throw new UnsafeDirectoryError("Directory validation failed", {
      cause: error,
    });
  }
  if (!target.isDirectory()) {
    throw new UnsafeDirectoryError("Directory target is not a directory");
  }
  if (
    expected !== undefined &&
    (path.relative(expected.canonicalPath, canonicalPath) !== "" ||
      target.dev !== expected.dev ||
      target.ino !== expected.ino)
  ) {
    throw new UnsafeDirectoryError("Directory identity changed");
  }
  return {
    canonicalPath,
    dev: target.dev,
    ino: target.ino,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function collectDocumentCandidates(
  roots: readonly DocumentationRoot[],
  options: CollectDocumentCandidatesOptions,
): Promise<DocumentCandidateCollection> {
  throwIfCancelled(options.signal);
  const fileSystem = options.fileSystem ?? nodeDirectoryScanFileSystem;
  const pending: Array<{
    root: DocumentationRoot;
    relativeDirectory: string;
  }> = [];
  const candidates: DocumentCandidate[] = [];
  let inspectedEntries = 0;
  let entryLimitHit = false;
  let unsafeDirectoriesSkipped = 0;

  for (const root of [...roots].reverse()) {
    throwIfCancelled(options.signal);
    if (options.pathPrefix === undefined) {
      pending.push({ root, relativeDirectory: "" });
      continue;
    }
    const relativePath = normalizeRelativePath(options.pathPrefix);
    const requestedPath = path.join(
      root.path,
      ...relativePath.split("/"),
    );
    try {
      const entry = await fileSystem.lstat(requestedPath);
      if (entry.isSymbolicLink()) {
        unsafeDirectoriesSkipped += 1;
        continue;
      }
      const canonicalPath = await fileSystem.realpath(requestedPath);
      if (!isInsideRoot(root.path, canonicalPath)) {
        unsafeDirectoriesSkipped += 1;
        continue;
      }
      const target = await fileSystem.stat(canonicalPath);
      if (target.isDirectory()) {
        pending.push({ root, relativeDirectory: relativePath });
      } else if (
        target.isFile() &&
        isSupportedDocumentPath(relativePath)
      ) {
        if (inspectedEntries < options.maxEntries) {
          inspectedEntries += 1;
          candidates.push({ root, relativePath });
        } else {
          entryLimitHit = true;
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        unsafeDirectoriesSkipped += 1;
      }
    }
  }
  if (
    inspectedEntries >= options.maxEntries &&
    pending.length > 0
  ) {
    entryLimitHit = true;
  }

  while (pending.length > 0 && !entryLimitHit) {
    throwIfCancelled(options.signal);
    if (inspectedEntries >= options.maxEntries) {
      entryLimitHit = true;
      break;
    }
    const directoryWork = pending.pop();
    if (directoryWork === undefined) {
      break;
    }
    const absoluteDirectory =
      directoryWork.relativeDirectory.length === 0
        ? directoryWork.root.path
        : path.join(
            directoryWork.root.path,
            ...directoryWork.relativeDirectory.split("/"),
          );
    let validated: ValidatedDirectory;
    let directory: ScanDirectoryHandle;
    try {
      validated = await validateDirectory(
        fileSystem,
        directoryWork.root,
        absoluteDirectory,
      );
      throwIfCancelled(options.signal);
      directory = await fileSystem.opendir(validated.canonicalPath);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      unsafeDirectoriesSkipped += 1;
      continue;
    }
    const directoryEntries: ScanDirectoryEntry[] = [];
    const remainingEntries =
      options.maxEntries - inspectedEntries;
    let directoryUnsafe = false;
    let directoryComplete = false;
    let directoryOverflow = false;
    try {
      try {
        await validateDirectory(
          fileSystem,
          directoryWork.root,
          absoluteDirectory,
          validated,
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        directoryUnsafe = true;
      }
      for (
        let offset = 0;
        !directoryUnsafe && offset <= remainingEntries;
        offset += 1
      ) {
        throwIfCancelled(options.signal);
        const entry = await directory.read();
        throwIfCancelled(options.signal);
        const isLookahead = offset === remainingEntries;
        if (entry !== null && !isLookahead) {
          inspectedEntries += 1;
        }
        try {
          await validateDirectory(
            fileSystem,
            directoryWork.root,
            absoluteDirectory,
            validated,
          );
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          directoryUnsafe = true;
          break;
        }
        if (entry === null) {
          directoryComplete = true;
          break;
        }
        if (isLookahead) {
          directoryOverflow = true;
          break;
        }
        directoryEntries.push(entry);
      }
    } finally {
      try {
        await directory.close();
      } catch {
        directoryUnsafe = true;
      }
      if (!directoryUnsafe) {
        try {
          throwIfCancelled(options.signal);
          await validateDirectory(
            fileSystem,
            directoryWork.root,
            absoluteDirectory,
            validated,
          );
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          directoryUnsafe = true;
        }
      }
      if (directoryUnsafe) {
        unsafeDirectoriesSkipped += 1;
      }
    }
    if (directoryUnsafe) {
      continue;
    }
    if (directoryOverflow) {
      entryLimitHit = true;
      break;
    }
    if (!directoryComplete) {
      entryLimitHit = true;
      break;
    }

    directoryEntries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    const childDirectories: string[] = [];
    for (const entry of directoryEntries) {
      if (
        entry.isSymbolicLink() ||
        !isSafeCitationSegment(entry.name)
      ) {
        continue;
      }
      const relativePath =
        directoryWork.relativeDirectory.length === 0
          ? entry.name
          : `${directoryWork.relativeDirectory}/${entry.name}`;
      if (
        entry.isFile() &&
        isSupportedDocumentPath(relativePath)
      ) {
        candidates.push({
          root: directoryWork.root,
          relativePath,
        });
      }
      if (entry.isDirectory()) {
        childDirectories.push(relativePath);
      }
    }
    for (
      let index = childDirectories.length - 1;
      index >= 0;
      index -= 1
    ) {
      const relativeDirectory = childDirectories[index];
      if (relativeDirectory !== undefined) {
        pending.push({
          root: directoryWork.root,
          relativeDirectory,
        });
      }
    }
    if (
      inspectedEntries >= options.maxEntries &&
      pending.length > 0
    ) {
      entryLimitHit = true;
    }
  }

  candidates.sort(compareCandidates);
  return {
    candidates,
    entryLimitHit,
    unsafeDirectoriesSkipped,
  };
}
