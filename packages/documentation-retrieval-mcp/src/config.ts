import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface DocumentationLimits {
  readonly maxFileBytes: number;
  readonly maxMatches: number;
  readonly maxExcerptLines: number;
  readonly maxLineLength: number;
  readonly maxScanFiles: number;
  readonly maxScannedBytes: number;
  readonly maxOutputBytes: number;
}

export interface DocumentationRoot {
  readonly id: string;
  readonly path: string;
}

export interface DocumentationConfig {
  readonly roots: readonly DocumentationRoot[];
  readonly limits: DocumentationLimits;
}

export const MIN_OUTPUT_BYTES = 64;

export const DEFAULT_LIMITS: DocumentationLimits = Object.freeze({
  maxFileBytes: 512 * 1024,
  maxMatches: 50,
  maxExcerptLines: 20,
  maxLineLength: 2_000,
  maxScanFiles: 2_000,
  maxScannedBytes: 16 * 1024 * 1024,
  maxOutputBytes: 128 * 1024,
});

export function validateDocumentationConfig(
  config: DocumentationConfig,
): void {
  if (config.roots.length === 0) {
    throw new Error("DocumentationConfig must include at least one root");
  }
  for (const root of config.roots) {
    if (
      root.id.length === 0 ||
      root.path.length === 0 ||
      !path.isAbsolute(root.path)
    ) {
      throw new Error(
        "DocumentationConfig roots require an ID and absolute path",
      );
    }
  }
  for (const [name, value] of Object.entries(config.limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (config.limits.maxOutputBytes < MIN_OUTPUT_BYTES) {
    throw new Error(
      `maxOutputBytes must be at least ${MIN_OUTPUT_BYTES}`,
    );
  }
}

function rootKey(root: string): string {
  const portable = root.split(path.sep).join("/");
  return process.platform === "win32" ? portable.toLowerCase() : portable;
}

function rootId(root: string): string {
  const digest = createHash("sha256").update(rootKey(root)).digest("hex");
  return `root-${digest.slice(0, 16)}`;
}

function readLimit(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum = 1,
): number {
  const value = env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (parsed < minimum) {
    throw new Error(`${name} must be at least ${minimum}`);
  }
  return parsed;
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<DocumentationConfig> {
  const requestedRoots =
    env.DOC_ROOTS === undefined
      ? [cwd]
      : env.DOC_ROOTS.split(path.delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
  if (requestedRoots.length === 0) {
    throw new Error("DOC_ROOTS must contain at least one directory");
  }
  const canonicalRoots = await Promise.all(
    requestedRoots.map(async (requestedRoot) => {
      const root = await realpath(path.resolve(cwd, requestedRoot));
      if (!(await stat(root)).isDirectory()) {
        throw new Error("Each DOC_ROOTS entry must resolve to a directory");
      }
      return root;
    }),
  );
  const rootsByKey = new Map<string, string>();
  for (const root of canonicalRoots) {
    rootsByKey.set(rootKey(root), root);
  }
  const roots = [...rootsByKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, root]) => ({ id: rootId(root), path: root }));

  const config: DocumentationConfig = {
    roots,
    limits: {
      maxFileBytes: readLimit(
        env,
        "DOC_MAX_FILE_BYTES",
        DEFAULT_LIMITS.maxFileBytes,
      ),
      maxMatches: readLimit(
        env,
        "DOC_MAX_MATCHES",
        DEFAULT_LIMITS.maxMatches,
      ),
      maxExcerptLines: readLimit(
        env,
        "DOC_MAX_EXCERPT_LINES",
        DEFAULT_LIMITS.maxExcerptLines,
      ),
      maxLineLength: readLimit(
        env,
        "DOC_MAX_LINE_LENGTH",
        DEFAULT_LIMITS.maxLineLength,
      ),
      maxScanFiles: readLimit(
        env,
        "DOC_MAX_SCAN_FILES",
        DEFAULT_LIMITS.maxScanFiles,
      ),
      maxScannedBytes: readLimit(
        env,
        "DOC_MAX_SCANNED_BYTES",
        DEFAULT_LIMITS.maxScannedBytes,
      ),
      maxOutputBytes: readLimit(
        env,
        "DOC_MAX_OUTPUT_BYTES",
        DEFAULT_LIMITS.maxOutputBytes,
        MIN_OUTPUT_BYTES,
      ),
    },
  };
  validateDocumentationConfig(config);
  return config;
}
