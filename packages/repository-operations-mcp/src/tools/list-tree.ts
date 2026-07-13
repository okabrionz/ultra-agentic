import { stat } from "node:fs/promises";
import path from "node:path";

import type { RepositoryConfig } from "../config.js";
import {
  assertExactGitRoot,
  runGitCommand,
} from "../helpers/git.js";
import { truncateUtf8 } from "../helpers/output.js";
import {
  RepositoryPathError,
  resolveRepositoryPath,
} from "../helpers/paths.js";

export interface ListTreeOptions {
  readonly path?: string;
  readonly depth?: number;
  readonly maxEntries?: number;
  readonly signal?: AbortSignal;
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function toFileSystemPath(root: string, gitPath: string): string {
  return path.join(root, ...gitPath.split("/"));
}

function escapeTreePath(filePath: string): string {
  return filePath
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t");
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function listRepositoryTree(
  config: RepositoryConfig,
  options: ListTreeOptions = {},
): Promise<string> {
  const base = await resolveRepositoryPath(
    config.root,
    options.path ?? ".",
  );
  if (!(await stat(base)).isDirectory()) {
    throw new Error("Path is not a directory");
  }
  await assertExactGitRoot(config, options.signal);

  const maximumDepth = Math.min(
    options.depth ?? config.limits.maxTreeDepth,
    config.limits.maxTreeDepth,
  );
  const maximumEntries = Math.min(
    options.maxEntries ?? config.limits.maxTreeEntries,
    config.limits.maxTreeEntries,
  );
  const baseGitPath = toGitPath(path.relative(config.root, base));
  const command = [
    "--literal-pathspecs",
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...(baseGitPath.length === 0 ? [] : [baseGitPath]),
  ];
  const result = await runGitCommand(
    config,
    command,
    options.signal === undefined ? {} : { signal: options.signal },
  );
  const rawPaths = result.stdout.split("\0");
  if (rawPaths.at(-1) === "") {
    rawPaths.pop();
  } else if (result.truncated) {
    rawPaths.pop();
  }

  const entries: string[] = [];
  const seenEntries = new Set<string>();
  let inspectedPaths = 0;
  let truncated = result.truncated;

  const addEntry = (entry: string): boolean => {
    if (seenEntries.has(entry)) {
      return true;
    }
    if (entries.length >= maximumEntries) {
      truncated = true;
      return false;
    }
    seenEntries.add(entry);
    entries.push(entry);
    if (entries.length >= maximumEntries) {
      truncated = true;
      return false;
    }
    return true;
  };

  for (const gitPath of rawPaths) {
    inspectedPaths += 1;
    const workBudgetReached = inspectedPaths >= maximumEntries;
    const absolutePath = toFileSystemPath(config.root, gitPath);
    const relativeToBase = path.relative(base, absolutePath);
    if (
      path.isAbsolute(relativeToBase) ||
      relativeToBase === ".." ||
      relativeToBase.startsWith(`..${path.sep}`)
    ) {
      if (workBudgetReached) {
        truncated = true;
        break;
      }
      continue;
    }

    try {
      await resolveRepositoryPath(config.root, gitPath);
    } catch (error) {
      if (
        error instanceof RepositoryPathError ||
        isMissingPathError(error)
      ) {
        if (workBudgetReached) {
          truncated = true;
          break;
        }
        continue;
      }
      throw error;
    }

    const relativeComponents = toGitPath(relativeToBase)
      .split("/")
      .filter((component) => component.length > 0);
    const baseComponents =
      baseGitPath.length === 0 ? [] : baseGitPath.split("/");
    const directoryCount = Math.max(0, relativeComponents.length - 1);

    for (
      let directoryIndex = 0;
      directoryIndex < directoryCount &&
      directoryIndex <= maximumDepth;
      directoryIndex += 1
    ) {
      const directoryPath = [
        ...baseComponents,
        ...relativeComponents.slice(0, directoryIndex + 1),
      ].join("/");
      if (!addEntry(`${escapeTreePath(directoryPath)}/`)) {
        break;
      }
    }
    if (truncated) {
      break;
    }

    if (directoryCount <= maximumDepth) {
      addEntry(escapeTreePath(gitPath));
    }
    if (truncated || workBudgetReached) {
      truncated = true;
      break;
    }
  }

  if (truncated) {
    entries.push(`[entry limit reached: ${maximumEntries}]`);
  }
  return truncateUtf8(
    entries.join("\n"),
    config.limits.maxOutputBytes,
  );
}
