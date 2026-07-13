import { stat } from "node:fs/promises";

import {
  validateDocumentationConfig,
  type DocumentationConfig,
} from "./config.js";
import {
  DocumentFileError,
  readDocumentFile,
  resolveDocumentPath,
  throwIfCancelled,
} from "./files.js";
import { boundLine, boundUtf8Output } from "./output.js";
import { collectDocumentCandidates } from "./scanner.js";

export interface SearchDocumentsOptions {
  readonly query: string;
  readonly rootId?: string;
  readonly pathPrefix?: string;
  readonly signal?: AbortSignal;
}

function excerptForLine(
  lines: readonly string[],
  matchIndex: number,
  maximumLines: number,
  maximumLineLength: number,
): string[] {
  const count = Math.min(maximumLines, lines.length);
  const before = Math.floor((count - 1) / 2);
  let start = Math.max(0, matchIndex - before);
  let end = Math.min(lines.length, start + count);
  start = Math.max(0, end - count);
  end = Math.min(lines.length, start + count);
  const excerpt: string[] = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? "";
    const boundedLine = boundLine(line, maximumLineLength);
    excerpt.push(`  ${index + 1} | ${boundedLine}`);
  }
  return excerpt;
}

export async function searchDocuments(
  config: DocumentationConfig,
  options: SearchDocumentsOptions,
): Promise<string> {
  validateDocumentationConfig(config);
  throwIfCancelled(options.signal);
  if (options.query.length === 0) {
    throw new Error("Search query must not be empty");
  }
  const foldedQuery = options.query.toLowerCase();
  const blocks: string[] = [];
  let matchLimitHit = false;
  let fileLimitSkips = 0;
  let scannedBytes = 0;
  let scannedByteLimitHit = false;
  const roots =
    options.rootId === undefined
      ? config.roots
      : config.roots.filter((root) => root.id === options.rootId);
  if (options.rootId !== undefined && roots.length === 0) {
    throw new Error(`Unknown documentation root ID: ${options.rootId}`);
  }
  const scan = await collectDocumentCandidates(roots, {
    maxEntries: config.limits.maxScanFiles,
    ...(options.pathPrefix === undefined
      ? {}
      : { pathPrefix: options.pathPrefix }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  scanCandidates:
  for (const candidate of scan.candidates) {
    const { root, relativePath } = candidate;
    throwIfCancelled(options.signal);
    const remainingBytes =
      config.limits.maxScannedBytes - scannedBytes;
    if (remainingBytes <= 0) {
      scannedByteLimitHit = true;
      break;
    }
    const resolved = await resolveDocumentPath(root.path, relativePath);
    const metadata = await stat(resolved.absolutePath, { bigint: true });
    throwIfCancelled(options.signal);
    if (!metadata.isFile()) {
      continue;
    }
    if (metadata.size > BigInt(config.limits.maxFileBytes)) {
      fileLimitSkips += 1;
      continue;
    }
    if (metadata.size > BigInt(remainingBytes)) {
      scannedByteLimitHit = true;
      break;
    }
    let document;
    try {
      document = await readDocumentFile(
        root.path,
        relativePath,
        {
          ...config.limits,
          maxFileBytes: Math.min(
            config.limits.maxFileBytes,
            remainingBytes,
          ),
        },
        options.signal === undefined
          ? {}
          : { signal: options.signal },
      );
    } catch (error) {
      if (
        error instanceof DocumentFileError &&
        error.reason === "binary"
      ) {
        scannedBytes += Number(metadata.size);
        continue;
      }
      if (
        error instanceof DocumentFileError &&
        error.reason === "too-large"
      ) {
        scannedByteLimitHit = true;
        break;
      }
      throw error;
    }
    scannedBytes += document.byteLength;
    throwIfCancelled(options.signal);
    for (let index = 0; index < document.lines.length; index += 1) {
      if (!(document.lines[index] ?? "").toLowerCase().includes(foldedQuery)) {
        continue;
      }
      if (blocks.length >= config.limits.maxMatches) {
        matchLimitHit = true;
        break scanCandidates;
      }
      const lineNumber = index + 1;
      blocks.push(
        [
          `${root.id}:${relativePath}:${lineNumber}`,
          ...excerptForLine(
            document.lines,
            index,
            config.limits.maxExcerptLines,
            config.limits.maxLineLength,
          ),
        ].join("\n"),
      );
    }
  }
  if (matchLimitHit) {
    blocks.push(
      `[truncated: match limit reached (${config.limits.maxMatches})]`,
    );
  }
  if (fileLimitSkips > 0) {
    blocks.push(
      `[truncated: file byte limit skipped ${fileLimitSkips} ${
        fileLimitSkips === 1 ? "file" : "files"
      }]`,
    );
  }
  if (scan.entryLimitHit) {
    blocks.push(
      `[truncated: scan file limit reached (${config.limits.maxScanFiles})]`,
    );
  }
  if (scan.unsafeDirectoriesSkipped > 0) {
    blocks.push(
      `[truncated: unsafe directory change skipped ${
        scan.unsafeDirectoriesSkipped
      } ${
        scan.unsafeDirectoriesSkipped === 1 ? "directory" : "directories"
      }]`,
    );
  }
  if (scannedByteLimitHit) {
    blocks.push(
      `[truncated: scanned byte limit reached (${config.limits.maxScannedBytes})]`,
    );
  }
  const output = blocks.length === 0 ? "No matches." : blocks.join("\n\n");
  throwIfCancelled(options.signal);
  return boundUtf8Output(output, config.limits.maxOutputBytes);
}
