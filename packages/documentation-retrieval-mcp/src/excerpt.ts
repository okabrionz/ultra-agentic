import {
  validateDocumentationConfig,
  type DocumentationConfig,
} from "./config.js";
import { readDocumentFile } from "./files.js";
import { boundLine, boundUtf8Output } from "./output.js";

export interface ReadExcerptOptions {
  readonly rootId: string;
  readonly path: string;
  readonly startLine: number;
  readonly lineCount: number;
  readonly signal?: AbortSignal;
}

export async function readExcerpt(
  config: DocumentationConfig,
  options: ReadExcerptOptions,
): Promise<string> {
  validateDocumentationConfig(config);
  if (!Number.isSafeInteger(options.startLine) || options.startLine <= 0) {
    throw new Error("startLine must be a positive integer");
  }
  if (!Number.isSafeInteger(options.lineCount) || options.lineCount <= 0) {
    throw new Error("lineCount must be a positive integer");
  }
  const root = config.roots.find((candidate) => candidate.id === options.rootId);
  if (root === undefined) {
    throw new Error(`Unknown documentation root ID: ${options.rootId}`);
  }
  const document = await readDocumentFile(
    root.path,
    options.path,
    config.limits,
    options.signal === undefined ? {} : { signal: options.signal },
  );
  const startIndex = options.startLine - 1;
  const boundedLineCount = Math.min(
    options.lineCount,
    config.limits.maxExcerptLines,
  );
  const endIndex = Math.min(
    document.lines.length,
    startIndex + boundedLineCount,
  );
  const lines: string[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const content = boundLine(
      document.lines[index] ?? "",
      config.limits.maxLineLength,
    );
    lines.push(
      `${root.id}:${document.relativePath}:${index + 1} | ${content}`,
    );
  }
  if (options.lineCount > config.limits.maxExcerptLines) {
    lines.push(
      `[truncated: line count clamped to ${config.limits.maxExcerptLines}]`,
    );
  }
  return boundUtf8Output(lines.join("\n"), config.limits.maxOutputBytes);
}
