import type { RepositoryConfig } from "../config.js";
import {
  assertExactGitRoot,
  getFilterOverrides,
  runGitCommand,
} from "../helpers/git.js";
import { truncateUtf8 } from "../helpers/output.js";

export interface ShowDiffOptions {
  readonly staged?: boolean;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export async function showRepositoryDiff(
  config: RepositoryConfig,
  options: ShowDiffOptions = {},
): Promise<string> {
  await assertExactGitRoot(config, options.signal);
  const filterOverrides = await getFilterOverrides(
    config,
    options.signal,
  );

  const args = [
    "diff",
    "--ignore-submodules=dirty",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
  ];
  if (options.staged === true) {
    args.push("--cached");
  }
  args.push("--");

  const maximumBytes = Math.min(
    options.maxBytes ?? config.limits.maxOutputBytes,
    config.limits.maxOutputBytes,
  );
  const { stdout } = await runGitCommand(config, args, {
    configOverrides: filterOverrides,
    maxOutputBytes: maximumBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const output = stdout.length > 0 ? stdout.trimEnd() : "(no differences)";
  return truncateUtf8(output, maximumBytes);
}
