import { realpath } from "node:fs/promises";
import path from "node:path";

export const IGNORED_REPOSITORY_COMPONENTS = new Set([
  ".git",
  "node_modules",
  "dist",
]);

export class RepositoryPathError extends Error {
  readonly reason: "ignored" | "outside-root";

  constructor(
    message: string,
    reason: "ignored" | "outside-root",
  ) {
    super(message);
    this.name = "RepositoryPathError";
    this.reason = reason;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function assertNoIgnoredComponents(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  for (const component of relative.split(path.sep)) {
    const comparable =
      process.platform === "win32" ? component.toLowerCase() : component;
    if (IGNORED_REPOSITORY_COMPONENTS.has(comparable)) {
      throw new RepositoryPathError(
        `Path uses ignored repository component: ${component}`,
        "ignored",
      );
    }
  }
}

export async function resolveRepositoryPath(
  root: string,
  userPath: string,
): Promise<string> {
  const candidate = path.resolve(root, path.normalize(userPath));
  if (!isInside(root, candidate)) {
    throw new RepositoryPathError(
      "Path resolves outside REPO_ROOT",
      "outside-root",
    );
  }
  assertNoIgnoredComponents(root, candidate);

  const resolved = await realpath(candidate);
  if (!isInside(root, resolved)) {
    throw new RepositoryPathError(
      "Path resolves outside REPO_ROOT",
      "outside-root",
    );
  }
  assertNoIgnoredComponents(root, resolved);

  return resolved;
}
