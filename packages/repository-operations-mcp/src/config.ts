import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface RepositoryLimits {
  readonly gitTimeoutMs: number;
  readonly maxFileBytes: number;
  readonly maxOutputBytes: number;
  readonly maxTreeDepth: number;
  readonly maxTreeEntries: number;
}

export interface RepositoryConfig {
  readonly root: string;
  readonly limits: RepositoryLimits;
}

export const DEFAULT_LIMITS: RepositoryLimits = Object.freeze({
  gitTimeoutMs: 10_000,
  maxFileBytes: 256 * 1024,
  maxOutputBytes: 128 * 1024,
  maxTreeDepth: 6,
  maxTreeEntries: 1_000,
});

function readLimit(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = env[name];
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<RepositoryConfig> {
  const requestedRoot = env.REPO_ROOT ?? cwd;
  const root = await realpath(path.resolve(cwd, requestedRoot));
  const rootMetadata = await stat(root);
  if (!rootMetadata.isDirectory()) {
    throw new Error("REPO_ROOT must resolve to a directory");
  }

  return {
    root,
    limits: {
      gitTimeoutMs: readLimit(
        env,
        "REPO_GIT_TIMEOUT_MS",
        DEFAULT_LIMITS.gitTimeoutMs,
      ),
      maxFileBytes: readLimit(
        env,
        "REPO_MAX_FILE_BYTES",
        DEFAULT_LIMITS.maxFileBytes,
      ),
      maxOutputBytes: readLimit(
        env,
        "REPO_MAX_OUTPUT_BYTES",
        DEFAULT_LIMITS.maxOutputBytes,
      ),
      maxTreeDepth: readLimit(
        env,
        "REPO_MAX_TREE_DEPTH",
        DEFAULT_LIMITS.maxTreeDepth,
      ),
      maxTreeEntries: readLimit(
        env,
        "REPO_MAX_TREE_ENTRIES",
        DEFAULT_LIMITS.maxTreeEntries,
      ),
    },
  };
}
