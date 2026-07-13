import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import type { DocumentationLimits } from "./config.js";

const READ_CHUNK_BYTES = 64 * 1024;
const DISALLOWED_TEXT_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const AMBIGUOUS_CITATION_SEGMENT =
  /[\\:|\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
]);

export interface ResolvedDocumentPath {
  readonly absolutePath: string;
  readonly requestedAbsolutePath: string;
  readonly relativePath: string;
}

export interface DocumentFile {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly lines: readonly string[];
}

export class DocumentFileError extends Error {
  readonly reason: "binary" | "too-large";

  constructor(
    message: string,
    reason: "binary" | "too-large",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentFileError";
    this.reason = reason;
  }
}

export interface DocumentFileMetadata {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  isFile(): boolean;
}

export interface DocumentFileHandle {
  stat(): Promise<DocumentFileMetadata>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface DocumentFileSystem {
  stat(filePath: string): Promise<DocumentFileMetadata>;
  open(filePath: string, flags: number): Promise<DocumentFileHandle>;
}

export interface ReadDocumentOptions {
  readonly signal?: AbortSignal;
  readonly fileSystem?: DocumentFileSystem;
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    const error = new Error("Operation cancelled");
    error.name = "AbortError";
    throw error;
  }
}

const nodeFileSystem: DocumentFileSystem = {
  stat: (filePath) => stat(filePath, { bigint: true }),
  async open(filePath, flags) {
    const handle = await open(filePath, flags);
    return {
      close: () => handle.close(),
      read: (buffer, offset, length, position) =>
        handle.read(buffer, offset, length, position),
      stat: () => handle.stat({ bigint: true }),
    };
  },
};

export function isSupportedDocumentPath(relativePath: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(
    path.posix.extname(relativePath).toLowerCase(),
  );
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

export function isSafeCitationSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !AMBIGUOUS_CITATION_SEGMENT.test(segment)
  );
}

export function normalizeRelativePath(
  requestedPath: string,
  allowRoot = false,
): string {
  if (requestedPath.includes("\0")) {
    throw new Error("Path contains an invalid null byte");
  }
  const portable = requestedPath;
  if (
    path.posix.isAbsolute(portable) ||
    /^[a-zA-Z]:/.test(portable) ||
    portable.split("/").includes("..")
  ) {
    throw new Error("Path traversal is not allowed");
  }
  const rawComponents = portable.split("/");
  if (
    rawComponents.some(
      (component) =>
        component.length > 0 &&
        component !== "." &&
        !isSafeCitationSegment(component),
    )
  ) {
    throw new Error("Path contains an ambiguous filename segment");
  }
  const components = rawComponents.filter(
    (component) => component.length > 0 && component !== ".",
  );
  if (!allowRoot && components.length === 0) {
    throw new Error("Path must name an entry inside the documentation root");
  }
  return components.join("/");
}

export async function resolveDocumentPath(
  root: string,
  requestedPath: string,
): Promise<ResolvedDocumentPath> {
  const relativePath = normalizeRelativePath(requestedPath);
  const candidate = path.join(root, ...relativePath.split("/"));
  const absolutePath = await realpath(candidate);
  if (!isInsideRoot(root, absolutePath)) {
    throw new Error("Path resolves outside its documentation root");
  }
  return {
    absolutePath,
    requestedAbsolutePath: candidate,
    relativePath,
  };
}

export async function readDocumentFile(
  root: string,
  requestedPath: string,
  limits: DocumentationLimits,
  options: ReadDocumentOptions = {},
): Promise<DocumentFile> {
  throwIfCancelled(options.signal);
  const resolved = await resolveDocumentPath(root, requestedPath);
  throwIfCancelled(options.signal);
  if (!isSupportedDocumentPath(resolved.relativePath)) {
    throw new Error("Unsupported documentation extension");
  }
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const metadata = await fileSystem.stat(resolved.absolutePath);
  throwIfCancelled(options.signal);
  if (!metadata.isFile()) {
    throw new Error("Path is not a regular file");
  }
  if (metadata.size > BigInt(limits.maxFileBytes)) {
    throw new DocumentFileError(
      `File size ${metadata.size} bytes exceeds the ${limits.maxFileBytes} byte limit`,
      "too-large",
    );
  }
  const file = await fileSystem.open(
    resolved.absolutePath,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const opened = await file.stat();
    throwIfCancelled(options.signal);
    if (!opened.isFile()) {
      throw new Error("Path is not a regular file");
    }
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      throw new Error("File changed between validation and open");
    }
    if (opened.size > BigInt(limits.maxFileBytes)) {
      throw new DocumentFileError(
        `File size ${opened.size} bytes exceeds the ${limits.maxFileBytes} byte limit`,
        "too-large",
      );
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      throwIfCancelled(options.signal);
      const { bytesRead } = await file.read(
        bytes,
        offset,
        Math.min(READ_CHUNK_BYTES, bytes.length - offset),
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
      throwIfCancelled(options.signal);
    }
    let currentPath: string;
    try {
      currentPath = await realpath(resolved.requestedAbsolutePath);
    } catch (error) {
      throw new Error("File changed while being read", { cause: error });
    }
    if (!isInsideRoot(root, currentPath)) {
      throw new Error("File changed while being read");
    }
    const [current, afterRead] = await Promise.all([
      fileSystem.stat(currentPath),
      file.stat(),
    ]);
    throwIfCancelled(options.signal);
    if (
      !current.isFile() ||
      !afterRead.isFile() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      afterRead.size !== opened.size
    ) {
      throw new Error("File changed while being read");
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, offset),
      );
    } catch (error) {
      throw new DocumentFileError("File is not UTF-8 text", "binary", {
        cause: error,
      });
    }
    if (content.includes("\0")) {
      throw new DocumentFileError("File appears to be binary", "binary");
    }
    if (DISALLOWED_TEXT_CONTROLS.test(content)) {
      throw new DocumentFileError(
        "File contains disallowed control characters",
        "binary",
      );
    }
    content = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    return {
      relativePath: resolved.relativePath,
      byteLength: offset,
      lines: content.split("\n"),
    };
  } finally {
    await file.close();
  }
}
