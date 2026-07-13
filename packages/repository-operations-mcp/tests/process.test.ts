import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runProcess } from "../src/helpers/process.js";

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessExit(
  processId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(processId)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isProcessAlive(processId);
}

test("runProcess terminates a child after its timeout", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const startedAt = Date.now();

  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", "setTimeout(() => process.exit(0), 1000)"],
      {
        cwd,
        maxOutputBytes: 1024,
        timeoutMs: 40,
      },
    ),
    /Process timed out after 40 ms/,
  );

  assert.ok(Date.now() - startedAt < 700);
});

test("runProcess terminates a child when cancelled", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const controller = new AbortController();
  const startedAt = Date.now();
  setTimeout(() => controller.abort(), 30);

  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", "setTimeout(() => process.exit(0), 1000)"],
      {
        cwd,
        maxOutputBytes: 1024,
        signal: controller.signal,
      },
    ),
    /Process cancelled/,
  );

  assert.ok(Date.now() - startedAt < 700);
});

test("runProcess terminates after output exceeds its byte limit", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const startedAt = Date.now();

  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write('x'.repeat(4096)); setTimeout(() => process.exit(0), 1000)",
    ],
    {
      cwd,
      maxOutputBytes: 64,
    },
  );

  assert.ok(Date.now() - startedAt < 700);
  assert.ok(Buffer.byteLength(result.stdout, "utf8") <= 64);
  assert.match(result.stdout, /\[truncated\]$/);
});

test("runProcess kills descendants that inherit its output pipes", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const processIdFile = path.join(cwd, "descendant.pid");
  const descendantScript = "setTimeout(() => process.exit(0), 1200)";
  const parentScript = [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}],`,
    '  { detached: true, stdio: ["ignore", "inherit", "inherit"] });',
    `fs.writeFileSync(${JSON.stringify(processIdFile)}, String(child.pid));`,
    "process.stdout.write('x'.repeat(4096));",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const startedAt = Date.now();

  await runProcess(process.execPath, ["-e", parentScript], {
    cwd,
    maxOutputBytes: 64,
  });

  const elapsedMs = Date.now() - startedAt;
  const descendantProcessId = Number(
    await readFile(processIdFile, "utf8"),
  );
  assert.ok(elapsedMs < 700, `process tree cleanup took ${elapsedMs} ms`);
  assert.equal(
    await waitForProcessExit(descendantProcessId, 500),
    true,
    `descendant ${descendantProcessId} remained alive`,
  );
});

test("runProcess settles when process-tree termination fails", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let terminationAttempts = 0;
  const startedAt = Date.now();

  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write('x'.repeat(4096)); setTimeout(() => process.exit(0), 1000)",
    ],
    {
      cleanupDeadlineMs: 100,
      cwd,
      maxOutputBytes: 64,
      terminateTree: async () => {
        terminationAttempts += 1;
        throw new Error("simulated kill command failure");
      },
    },
  );

  assert.equal(terminationAttempts, 1);
  assert.ok(Date.now() - startedAt < 700);
  assert.equal(result.truncated, true);
});

test("runProcess settles by the cleanup deadline when termination hangs", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let terminationAttempted = false;
  const startedAt = Date.now();

  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write('x'.repeat(4096)); setTimeout(() => process.exit(0), 1000)",
    ],
    {
      cleanupDeadlineMs: 100,
      cwd,
      maxOutputBytes: 64,
      terminateTree: () => {
        terminationAttempted = true;
        return new Promise<void>(() => {});
      },
    },
  );

  assert.equal(terminationAttempted, true);
  assert.ok(Date.now() - startedAt < 700);
  assert.equal(result.truncated, true);
});

test("runProcess unreferences a surviving child after cleanup expires", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "repo-operations-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let childHandle:
    | Parameters<NonNullable<Parameters<typeof runProcess>[2]["terminateTree"]>>[0]
    | undefined;
  let originalKill:
    | ((signal?: NodeJS.Signals | number) => boolean)
    | undefined;
  let unrefCalled = false;

  try {
    await runProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write('x'.repeat(4096)); setTimeout(() => process.exit(0), 1000)",
      ],
      {
        cleanupDeadlineMs: 100,
        cwd,
        maxOutputBytes: 64,
        terminateTree: (child) => {
          childHandle = child;
          originalKill = child.kill.bind(child);
          child.kill = () => false;
          const originalUnref = child.unref.bind(child);
          child.unref = () => {
            unrefCalled = true;
            originalUnref();
            return child;
          };
          return new Promise<void>(() => {});
        },
      },
    );

    assert.equal(unrefCalled, true);
  } finally {
    if (childHandle !== undefined && originalKill !== undefined) {
      originalKill("SIGKILL");
      await new Promise<void>((resolve) => {
        if (childHandle?.exitCode !== null) {
          resolve();
          return;
        }
        childHandle?.once("exit", () => resolve());
        setTimeout(resolve, 500);
      });
    }
  }
});
