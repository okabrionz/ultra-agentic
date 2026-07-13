import { constants } from "node:fs";
import {
  open,
  stat,
} from "node:fs/promises";
import { TextDecoder } from "node:util";

import type { RepositoryConfig } from "../config.js";
import { truncateUtf8 } from "../helpers/output.js";
import { resolveRepositoryPath } from "../helpers/paths.js";

export interface ReadFileMetadata {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  isFile(): boolean;
}

export interface ReadFileHandle {
  stat(): Promise<ReadFileMetadata>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface ReadFileSystem {
  stat(filePath: string): Promise<ReadFileMetadata>;
  open(filePath: string, flags: number): Promise<ReadFileHandle>;
}

const nodeFileSystem: ReadFileSystem = {
  async stat(filePath: string): Promise<ReadFileMetadata> {
    return stat(filePath, { bigint: true });
  },
  async open(filePath: string, flags: number): Promise<ReadFileHandle> {
    const handle = await open(filePath, flags);
    return {
      close: () => handle.close(),
      read: (buffer, offset, length, position) =>
        handle.read(buffer, offset, length, position),
      stat: () => handle.stat({ bigint: true }),
    };
  },
};

export async function readRepositoryFile(
  config: RepositoryConfig,
  userPath: string,
  fileSystem: ReadFileSystem = nodeFileSystem,
): Promise<string> {
  const resolved = await resolveRepositoryPath(config.root, userPath);
  const validated = await fileSystem.stat(resolved);
  if (!validated.isFile()) {
    throw new Error("Path is not a regular file");
  }
  if (validated.size > BigInt(config.limits.maxFileBytes)) {
    throw new Error(
      `File size ${validated.size} bytes exceeds the ${config.limits.maxFileBytes} byte limit`,
    );
  }

  const file = await fileSystem.open(
    resolved,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const opened = await file.stat();
    if (!opened.isFile()) {
      throw new Error("Path is not a regular file");
    }
    if (opened.dev !== validated.dev || opened.ino !== validated.ino) {
      throw new Error("File changed between validation and open");
    }
    if (opened.size > BigInt(config.limits.maxFileBytes)) {
      throw new Error(
        `File size ${opened.size} bytes exceeds the ${config.limits.maxFileBytes} byte limit`,
      );
    }

    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, offset),
      );
    } catch (error) {
      throw new Error("File is not valid UTF-8 text", { cause: error });
    }
    return truncateUtf8(content, config.limits.maxOutputBytes);
  } finally {
    await file.close();
  }
}
