import {
  execFile,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { promisify } from "node:util";

import { markUtf8Truncated, truncateUtf8 } from "./output.js";

const DEFAULT_CLEANUP_DEADLINE_MS = 500;
const execFileAsync = promisify(execFile);

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

export type ProcessTreeTerminator = (
  child: ChildProcess,
) => Promise<void>;

interface BoundedCollector {
  append(chunk: string): boolean;
  finish(): string;
}

function createBoundedCollector(maxBytes: number): BoundedCollector {
  let output = "";
  let outputBytes = 0;
  let truncated = false;

  return {
    append(chunk: string): boolean {
      if (truncated) {
        return true;
      }

      const remaining = maxBytes - outputBytes;
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (chunkBytes <= remaining) {
        output += chunk;
        outputBytes += chunkBytes;
        return false;
      }

      output += truncateUtf8(chunk, Math.max(remaining, 0), "");
      truncated = true;
      return true;
    },
    finish(): string {
      if (!truncated) {
        return output;
      }
      return markUtf8Truncated(output, maxBytes);
    },
  };
}

function destroyChildStdio(child: ChildProcess): void {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function terminateWindowsProcessTree(processId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(processId), "/T", "/F"],
      {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      killer.kill("SIGKILL");
      finish();
    }, 400);
    killer.once("error", finish);
    killer.once("close", finish);
  });
}

async function discoverPosixDescendants(
  rootProcessId: number,
): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-A", "-o", "pid=,ppid="],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 200,
        windowsHide: true,
      },
    );
    const childrenByParent = new Map<number, number[]>();
    for (const line of stdout.split(/\r?\n/u)) {
      const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) {
        continue;
      }
      const processId = Number(match[1]);
      const parentProcessId = Number(match[2]);
      const children = childrenByParent.get(parentProcessId) ?? [];
      children.push(processId);
      childrenByParent.set(parentProcessId, children);
    }

    const descendants: number[] = [];
    const pending = [...(childrenByParent.get(rootProcessId) ?? [])];
    while (pending.length > 0) {
      const processId = pending.pop();
      if (processId === undefined) {
        break;
      }
      descendants.push(processId);
      pending.push(...(childrenByParent.get(processId) ?? []));
    }
    return descendants;
  } catch {
    return [];
  }
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const processId = child.pid;
  if (processId === undefined) {
    child.kill("SIGKILL");
    destroyChildStdio(child);
    return;
  }

  if (process.platform === "win32") {
    await terminateWindowsProcessTree(processId);
  } else {
    const descendants = await discoverPosixDescendants(processId);
    try {
      process.kill(-processId, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    for (const descendant of descendants.reverse()) {
      try {
        process.kill(descendant, "SIGKILL");
      } catch {
        // The process may already have exited with its process group.
      }
    }
  }
  destroyChildStdio(child);
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    timeoutMs <= 0
  ) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      child.off("exit", finish);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    child.once("exit", finish);
  });
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly allowedExitCodes?: readonly number[];
    readonly cleanupDeadlineMs?: number;
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly maxOutputBytes: number;
    readonly signal?: AbortSignal;
    readonly terminateTree?: ProcessTreeTerminator;
    readonly timeoutMs?: number;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
    });
    const stdout = createBoundedCollector(options.maxOutputBytes);
    const stderr = createBoundedCollector(options.maxOutputBytes);
    let settled = false;
    let terminationStarted = false;
    let terminationError: Error | undefined;
    let outputLimitReached = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cancel = (): void =>
      beginTermination(new Error("Process cancelled"), false);
    const cleanUp = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      options.signal?.removeEventListener("abort", cancel);
    };
    const settleAfterTermination = async (): Promise<void> => {
      const cleanupDeadlineMs =
        options.cleanupDeadlineMs ?? DEFAULT_CLEANUP_DEADLINE_MS;
      const terminateTree = options.terminateTree ?? terminateProcessTree;
      const cleanupStartedAt = Date.now();
      await Promise.race([
        Promise.resolve()
          .then(() => terminateTree(child))
          .catch(() => undefined),
        new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.max(1, Math.floor(cleanupDeadlineMs / 2)),
          ),
        ),
      ]);
      try {
        child.kill("SIGKILL");
      } catch {
        // The direct child may already be gone.
      }
      await waitForChildExit(
        child,
        Math.max(
          0,
          cleanupDeadlineMs - (Date.now() - cleanupStartedAt),
        ),
      );
      destroyChildStdio(child);
      try {
        child.unref();
      } catch {
        // A failed spawn may not have a reference to release.
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanUp();
      const stdoutText = stdout.finish();
      const stderrText = stderr.finish();
      if (terminationError !== undefined) {
        reject(terminationError);
      } else {
        resolve({
          stdout: stdoutText,
          stderr: stderrText,
          truncated: outputLimitReached,
        });
      }
    };
    function beginTermination(
      error: Error | undefined,
      dueToOutputLimit: boolean,
    ): void {
      if (terminationStarted) {
        return;
      }
      terminationStarted = true;
      terminationError = error;
      outputLimitReached = dueToOutputLimit;
      destroyChildStdio(child);
      void settleAfterTermination();
    }
    timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            beginTermination(
              new Error(`Process timed out after ${options.timeoutMs} ms`),
              false,
            );
          }, options.timeoutMs);
    if (options.signal?.aborted === true) {
      cancel();
    } else {
      options.signal?.addEventListener("abort", cancel, { once: true });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.append(chunk)) {
        beginTermination(undefined, true);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.append(chunk)) {
        beginTermination(undefined, true);
      }
    });
    child.once("error", (error) => {
      if (terminationStarted || settled) {
        return;
      }
      cleanUp();
      settled = true;
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled || terminationStarted) {
        return;
      }
      settled = true;
      cleanUp();
      const stdoutText = stdout.finish();
      const stderrText = stderr.finish();
      if (
        code !== 0 &&
        (code === null || !options.allowedExitCodes?.includes(code))
      ) {
        const reason =
          code === null ? `terminated by signal ${signal ?? "unknown"}` : `exited with code ${code}`;
        reject(
          new Error(
            `${command} ${reason}${stderrText.length > 0 ? `: ${stderrText.trimEnd()}` : ""}`,
          ),
        );
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText, truncated: false });
    });
  });
}
