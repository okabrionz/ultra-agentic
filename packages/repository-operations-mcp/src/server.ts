import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { RepositoryConfig } from "./config.js";
import { truncateUtf8 } from "./helpers/output.js";
import { listRepositoryTree } from "./tools/list-tree.js";
import { readRepositoryFile } from "./tools/read-file.js";
import { getRepositoryStatus } from "./tools/repo-status.js";
import { showRepositoryDiff } from "./tools/show-diff.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const INVALID_TOOL_INPUT = Symbol("invalid-tool-input");
const invalidToolInput = {
  [INVALID_TOOL_INPUT]: true,
};

function boundedInputSchema<T extends z.ZodType>(schema: T) {
  return schema.catch(() => invalidToolInput as z.output<T>);
}

function assertValidToolInput(input: unknown): void {
  if (
    typeof input === "object" &&
    input !== null &&
    INVALID_TOOL_INPUT in input
  ) {
    throw new Error("Invalid tool input");
  }
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

async function boundedToolResult(
  config: RepositoryConfig,
  operation: () => Promise<string>,
) {
  try {
    return textResult(await operation());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...textResult(
        truncateUtf8(
          `Error: ${message}`,
          config.limits.maxOutputBytes,
        ),
      ),
      isError: true,
    };
  }
}

export function createRepositoryOperationsServer(
  config: RepositoryConfig,
): McpServer {
  const server = new McpServer({
    name: "repository-operations-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "repo_status",
    {
      description: "Show the current Git branch and porcelain working-tree state.",
      inputSchema: boundedInputSchema(z.object({}).strict()),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, extra) =>
      boundedToolResult(config, () => {
        assertValidToolInput(input);
        return getRepositoryStatus(config, { signal: extra.signal });
      }),
  );

  server.registerTool(
    "show_diff",
    {
      description:
        "Show a bounded Git diff for unstaged changes or, when staged is true, the index.",
      inputSchema: boundedInputSchema(
        z
          .object({
            staged: z.boolean().optional(),
            maxBytes: z.number().int().positive().optional(),
          })
          .strict(),
      ),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, extra) =>
      boundedToolResult(config, () => {
        assertValidToolInput(input);
        const { staged, maxBytes } = input;
        return showRepositoryDiff(config, {
          ...(staged === undefined ? {} : { staged }),
          ...(maxBytes === undefined ? {} : { maxBytes }),
          signal: extra.signal,
        });
      }),
  );

  server.registerTool(
    "list_tree",
    {
      description:
        "List repository entries recursively with bounded depth, entry count, and output.",
      inputSchema: boundedInputSchema(
        z
          .object({
            path: z.string().min(1).optional(),
            depth: z.number().int().nonnegative().optional(),
            maxEntries: z.number().int().positive().optional(),
          })
          .strict(),
      ),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, extra) =>
      boundedToolResult(config, () => {
        assertValidToolInput(input);
        const { path, depth, maxEntries } = input;
        return listRepositoryTree(config, {
          ...(path === undefined ? {} : { path }),
          ...(depth === undefined ? {} : { depth }),
          ...(maxEntries === undefined ? {} : { maxEntries }),
          signal: extra.signal,
        });
      }),
  );

  server.registerTool(
    "read_file",
    {
      description:
        "Read a UTF-8 text file under the repository root within configured limits.",
      inputSchema: boundedInputSchema(
        z
          .object({
            path: z.string().min(1),
          })
          .strict(),
      ),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      boundedToolResult(config, () => {
        assertValidToolInput(input);
        return readRepositoryFile(config, input.path);
      }),
  );

  return server;
}
