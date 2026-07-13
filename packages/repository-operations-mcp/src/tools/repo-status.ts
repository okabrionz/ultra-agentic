import type { RepositoryConfig } from "../config.js";
import {
  assertExactGitRoot,
  getFilterOverrides,
  runGitCommand,
  type GitConfigOverride,
} from "../helpers/git.js";
import { truncateUtf8 } from "../helpers/output.js";

async function runGit(
  config: RepositoryConfig,
  args: string[],
  configOverrides: readonly GitConfigOverride[],
  signal?: AbortSignal,
): Promise<string> {
  const { stdout } = await runGitCommand(
    config,
    args,
    {
      configOverrides,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  return stdout.trimEnd();
}

export interface RepositoryStatusOptions {
  readonly signal?: AbortSignal;
}

export async function getRepositoryStatus(
  config: RepositoryConfig,
  options: RepositoryStatusOptions = {},
): Promise<string> {
  await assertExactGitRoot(config, options.signal);
  const filterOverrides = await getFilterOverrides(
    config,
    options.signal,
  );

  const [branchName, porcelain] = await Promise.all([
    runGit(
      config,
      ["branch", "--show-current"],
      filterOverrides,
      options.signal,
    ),
    runGit(
      config,
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
        "--ignore-submodules=dirty",
      ],
      filterOverrides,
      options.signal,
    ),
  ]);
  const branch =
    branchName.length > 0
      ? branchName
      : `(detached at ${await runGit(
          config,
          ["rev-parse", "--short", "HEAD"],
          filterOverrides,
          options.signal,
        )})`;

  return truncateUtf8(
    [
      `Branch: ${branch}`,
      "Working tree:",
      porcelain.length > 0 ? porcelain : "(clean)",
    ].join("\n"),
    config.limits.maxOutputBytes,
  );
}
