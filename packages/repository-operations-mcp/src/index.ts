#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createRepositoryOperationsServer } from "./server.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const server = createRepositoryOperationsServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`repository-operations-mcp: ${message}`);
  process.exitCode = 1;
});
