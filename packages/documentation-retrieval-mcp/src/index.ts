#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createDocumentationRetrievalServer } from "./server.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const server = createDocumentationRetrievalServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`documentation-retrieval-mcp: ${message}`);
  process.exitCode = 1;
});
