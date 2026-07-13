import { lstat } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";

import type { RepositoryConfig } from "../config.js";
import { runProcess, type ProcessResult } from "./process.js";

const gitNullDevice = process.platform === "win32" ? "NUL" : devNull;

export interface GitConfigOverride {
  readonly key: string;
  readonly value: string;
}

export function createGitEnvironment(
  repositoryRoot?: string,
  inherited: NodeJS.ProcessEnv = process.env,
  configOverrides: readonly GitConfigOverride[] = [],
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (!name.toUpperCase().startsWith("GIT_") && value !== undefined) {
      environment[name] = value;
    }
  }

  const repositoryParent =
    repositoryRoot === undefined ? undefined : path.dirname(repositoryRoot);

  const result: NodeJS.ProcessEnv = {
    ...environment,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitNullDevice,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: gitNullDevice,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    ...(repositoryRoot !== undefined && repositoryParent !== repositoryRoot
      ? { GIT_CEILING_DIRECTORIES: repositoryParent }
      : {}),
  };
  result.GIT_CONFIG_COUNT = String(configOverrides.length);
  configOverrides.forEach((override, index) => {
    result[`GIT_CONFIG_KEY_${index}`] = override.key;
    result[`GIT_CONFIG_VALUE_${index}`] = override.value;
  });
  return result;
}

export interface GitCommandOptions {
  readonly allowedExitCodes?: readonly number[];
  readonly configOverrides?: readonly GitConfigOverride[];
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

export async function runGitCommand(
  config: RepositoryConfig,
  args: readonly string[],
  options: GitCommandOptions = {},
): Promise<ProcessResult> {
  const configOverrides: GitConfigOverride[] = [
    { key: "core.fsmonitor", value: "false" },
    { key: "core.hooksPath", value: gitNullDevice },
    { key: "diff.external", value: "" },
    { key: "submodule.recurse", value: "false" },
    ...(options.configOverrides ?? []),
  ];
  return runProcess(
    "git",
    [
      "--no-optional-locks",
      ...args,
    ],
    {
      ...(options.allowedExitCodes === undefined
        ? {}
        : { allowedExitCodes: options.allowedExitCodes }),
      cwd: config.root,
      env: createGitEnvironment(
        config.root,
        process.env,
        configOverrides,
      ),
      maxOutputBytes:
        options.maxOutputBytes ?? config.limits.maxOutputBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: config.limits.gitTimeoutMs,
    },
  );
}

export async function getFilterOverrides(
  config: RepositoryConfig,
  signal?: AbortSignal,
): Promise<GitConfigOverride[]> {
  const listFilterKeys = async (
    scope: "--local" | "--worktree",
  ): Promise<string[]> => {
    const result = await runGitCommand(
      config,
      [
        "config",
        scope,
        "--includes",
        "--name-only",
        "--get-regexp",
        "^filter\\..*\\.(clean|process|required|smudge)$",
      ],
      {
        allowedExitCodes: [0, 1],
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (result.truncated) {
      throw new Error(
        `${scope.slice(2)} Git filter configuration exceeds the output limit`,
      );
    }
    return result.stdout.split(/\r?\n/u);
  };

  const worktreeConfig = await runGitCommand(
    config,
    [
      "config",
      "--local",
      "--get",
      "--bool",
      "extensions.worktreeConfig",
    ],
    {
      allowedExitCodes: [0, 1],
      ...(signal === undefined ? {} : { signal }),
    },
  );
  if (worktreeConfig.truncated) {
    throw new Error("Git worktree configuration check exceeds the output limit");
  }

  const keys = await listFilterKeys("--local");
  if (worktreeConfig.stdout.trim() === "true") {
    keys.push(...(await listFilterKeys("--worktree")));
  }

  const drivers = new Set<string>();
  for (const key of keys) {
    const match = /^(filter\..+)\.(clean|process|required|smudge)$/iu.exec(
      key,
    );
    if (match?.[1] !== undefined) {
      drivers.add(match[1]);
    }
  }

  return [...drivers].flatMap((driver) => [
    { key: `${driver}.clean`, value: "" },
    { key: `${driver}.process`, value: "" },
    { key: `${driver}.smudge`, value: "" },
    { key: `${driver}.required`, value: "false" },
  ]);
}

export async function assertExactGitRoot(
  config: RepositoryConfig,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const gitEntry = await lstat(path.join(config.root, ".git"));
    if (
      gitEntry.isSymbolicLink() ||
      (!gitEntry.isDirectory() && !gitEntry.isFile())
    ) {
      throw new Error("invalid .git entry");
    }
  } catch (error) {
    throw new Error("REPO_ROOT must be the exact Git work tree root", {
      cause: error,
    });
  }

  const { stdout } = await runGitCommand(
    config,
    ["rev-parse", "--show-prefix"],
    signal === undefined ? {} : { signal },
  );
  if (stdout.trim().length > 0) {
    throw new Error("REPO_ROOT must be the exact Git work tree root");
  }
}
