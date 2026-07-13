import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { DEFAULT_LIMITS, type RepositoryConfig } from "../src/config.js";
import { createRepositoryOperationsServer } from "../src/server.js";

const execFileAsync = promisify(execFile);

test("an in-memory MCP client can call repo_status", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await execFileAsync("git", ["init", "-b", "main"], {
    cwd: directory,
    windowsHide: true,
  });
  const config: RepositoryConfig = {
    root: await realpath(directory),
    limits: DEFAULT_LIMITS,
  };
  const server = createRepositoryOperationsServer(config);
  const client = new Client({
    name: "repository-operations-tests",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "repo_status",
      arguments: {},
    }),
  );

  assert.notEqual(result.isError, true);
  assert.equal(result.content[0]?.type, "text");
  if (result.content[0]?.type === "text") {
    assert.match(result.content[0].text, /^Branch: main$/m);
  }
});

test("the MCP server exposes only the four read-only repository tools", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config: RepositoryConfig = {
    root: await realpath(directory),
    limits: DEFAULT_LIMITS,
  };
  const server = createRepositoryOperationsServer(config);
  const client = new Client({
    name: "repository-operations-tests",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });

  const { tools } = await client.listTools();

  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["list_tree", "read_file", "repo_status", "show_diff"],
  );
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
  }
});

test("expected path errors are returned as MCP tool errors", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config: RepositoryConfig = {
    root: await realpath(directory),
    limits: DEFAULT_LIMITS,
  };
  const server = createRepositoryOperationsServer(config);
  const client = new Client({
    name: "repository-operations-tests",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "read_file",
      arguments: { path: "../outside.txt" },
    }),
  );

  assert.equal(result.isError, true);
  assert.equal(result.content[0]?.type, "text");
  if (result.content[0]?.type === "text") {
    assert.match(result.content[0].text, /Path resolves outside REPO_ROOT/);
  }
});

test("MCP tool error text including its prefix stays within the output limit", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const maxOutputBytes = 48;
  const config: RepositoryConfig = {
    root: await realpath(directory),
    limits: {
      ...DEFAULT_LIMITS,
      maxOutputBytes,
    },
  };
  const server = createRepositoryOperationsServer(config);
  const client = new Client({
    name: "repository-operations-tests",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "read_file",
      arguments: { path: `missing-${"x".repeat(120)}.txt` },
    }),
  );

  assert.equal(result.isError, true);
  assert.equal(result.content[0]?.type, "text");
  if (result.content[0]?.type === "text") {
    assert.ok(
      Buffer.byteLength(result.content[0].text, "utf8") <= maxOutputBytes,
    );
    assert.match(result.content[0].text, /^Error: /);
    assert.match(result.content[0].text, /\[truncated\]$/);
  }
});

test("MCP input validation errors stay within the output limit", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-operations-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const maxOutputBytes = 24;
  const config: RepositoryConfig = {
    root: await realpath(directory),
    limits: {
      ...DEFAULT_LIMITS,
      maxOutputBytes,
    },
  };
  const server = createRepositoryOperationsServer(config);
  const client = new Client({
    name: "repository-operations-tests",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "read_file",
      arguments: { path: 42 },
    }),
  );

  assert.equal(result.isError, true);
  assert.equal(result.content[0]?.type, "text");
  if (result.content[0]?.type === "text") {
    assert.ok(
      Buffer.byteLength(result.content[0].text, "utf8") <= maxOutputBytes,
    );
  }
});
