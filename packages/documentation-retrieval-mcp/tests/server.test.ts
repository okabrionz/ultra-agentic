import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "../src/config.js";
import { createDocumentationRetrievalServer } from "../src/server.js";

function schemaPropertyType(
  schema: { properties?: Record<string, object> | undefined },
  property: string,
): unknown {
  return (
    schema.properties?.[property] as { type?: unknown } | undefined
  )?.type;
}

test("an in-memory MCP client can list only configured documentation roots", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-server-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await loadConfig({ DOC_ROOTS: root }, root);
  const server = createDocumentationRetrievalServer(config);
  const client = new Client({
    name: "documentation-retrieval-tests",
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
      name: "list_doc_roots",
      arguments: {},
    }),
  );

  assert.notEqual(result.isError, true);
  assert.equal(result.content[0]?.type, "text");
  if (result.content[0]?.type === "text") {
    assert.deepEqual(JSON.parse(result.content[0].text), config.roots);
  }
});

test("createServer rejects a programmatic config below the output minimum", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-server-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await loadConfig({ DOC_ROOTS: root }, root);

  assert.throws(
    () =>
      createDocumentationRetrievalServer({
        ...config,
        limits: {
          ...config.limits,
          maxOutputBytes: 63,
        },
      }),
    /maxOutputBytes must be at least 64/,
  );
});

test("the MCP server exposes exactly three read-only local tools", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-server-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await loadConfig({ DOC_ROOTS: root }, root);
  const server = createDocumentationRetrievalServer(config);
  const client = new Client({
    name: "documentation-retrieval-tests",
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
    ["list_doc_roots", "read_excerpt", "search_docs"],
  );
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
  }

  const searchSchema = tools.find(
    (tool) => tool.name === "search_docs",
  )?.inputSchema;
  const excerptSchema = tools.find(
    (tool) => tool.name === "read_excerpt",
  )?.inputSchema;
  assert.ok(searchSchema);
  assert.ok(excerptSchema);
  assert.equal(searchSchema.type, "object");
  assert.deepEqual(
    Object.keys(searchSchema.properties ?? {}).sort(),
    ["pathPrefix", "query", "rootId"],
  );
  assert.deepEqual(searchSchema.required, ["query"]);
  assert.equal(schemaPropertyType(searchSchema, "query"), "string");
  assert.equal(schemaPropertyType(searchSchema, "rootId"), "string");
  assert.equal(schemaPropertyType(searchSchema, "pathPrefix"), "string");
  assert.equal(excerptSchema.type, "object");
  assert.deepEqual(
    Object.keys(excerptSchema.properties ?? {}).sort(),
    ["lineCount", "path", "rootId", "startLine"],
  );
  assert.deepEqual(
    [...(excerptSchema.required ?? [])].sort(),
    ["lineCount", "path", "rootId", "startLine"],
  );
  assert.equal(schemaPropertyType(excerptSchema, "rootId"), "string");
  assert.equal(schemaPropertyType(excerptSchema, "path"), "string");
  assert.equal(schemaPropertyType(excerptSchema, "startLine"), "integer");
  assert.equal(schemaPropertyType(excerptSchema, "lineCount"), "integer");
});

test("an in-memory client can search and read excerpts while unknown roots are tool errors", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-server-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "guide.md"), "first\nNeedle line", "utf8");
  const config = await loadConfig({ DOC_ROOTS: root }, root);
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);
  const server = createDocumentationRetrievalServer(config);
  const client = new Client({
    name: "documentation-retrieval-tests",
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

  const search = CallToolResultSchema.parse(
    await client.callTool({
      name: "search_docs",
      arguments: { query: "needle", rootId },
    }),
  );
  const excerpt = CallToolResultSchema.parse(
    await client.callTool({
      name: "read_excerpt",
      arguments: {
        rootId,
        path: "guide.md",
        startLine: 2,
        lineCount: 1,
      },
    }),
  );
  const unknownRoot = CallToolResultSchema.parse(
    await client.callTool({
      name: "search_docs",
      arguments: { query: "needle", rootId: "root-missing" },
    }),
  );

  assert.equal(search.content[0]?.type, "text");
  if (search.content[0]?.type === "text") {
    assert.match(search.content[0].text, new RegExp(`${rootId}:guide\\.md:2`));
  }
  assert.equal(excerpt.content[0]?.type, "text");
  if (excerpt.content[0]?.type === "text") {
    assert.equal(excerpt.content[0].text, `${rootId}:guide.md:2 | Needle line`);
  }
  assert.equal(unknownRoot.isError, true);
});

test("MCP tool failures return isError results and do not crash the server", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doc-retrieval-server-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await loadConfig(
    {
      DOC_ROOTS: root,
      DOC_MAX_OUTPUT_BYTES: "64",
    },
    root,
  );
  const rootId = config.roots[0]?.id;
  assert.ok(rootId);
  const server = createDocumentationRetrievalServer(config);
  const client = new Client({
    name: "documentation-retrieval-tests",
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

  const traversal = CallToolResultSchema.parse(
    await client.callTool({
      name: "read_excerpt",
      arguments: {
        rootId,
        path: `../${"outside".repeat(30)}.md`,
        startLine: 1,
        lineCount: 1,
      },
    }),
  );
  const invalidInput = CallToolResultSchema.parse(
    await client.callTool({
      name: "read_excerpt",
      arguments: {
        rootId,
        path: "guide.md",
        startLine: 0,
        lineCount: 1,
      },
    }),
  );
  const stillResponsive = await client.listTools();

  assert.equal(traversal.isError, true);
  assert.equal(traversal.content[0]?.type, "text");
  if (traversal.content[0]?.type === "text") {
    assert.ok(
      Buffer.byteLength(traversal.content[0].text, "utf8") <=
        config.limits.maxOutputBytes,
    );
  }
  assert.equal(invalidInput.isError, true);
  assert.equal(invalidInput.content[0]?.type, "text");
  if (invalidInput.content[0]?.type === "text") {
    assert.match(invalidInput.content[0].text, /Invalid tool input/);
    assert.ok(
      Buffer.byteLength(invalidInput.content[0].text, "utf8") <=
        config.limits.maxOutputBytes,
    );
  }
  assert.equal(stillResponsive.tools.length, 3);
});
