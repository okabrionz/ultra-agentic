import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  validateDocumentationConfig,
  type DocumentationConfig,
} from "./config.js";
export {
  DEFAULT_LIMITS,
  MIN_OUTPUT_BYTES,
  loadConfig,
  validateDocumentationConfig,
} from "./config.js";
export type {
  DocumentationConfig,
  DocumentationLimits,
  DocumentationRoot,
} from "./config.js";
import { readExcerpt } from "./excerpt.js";
import { boundUtf8Output } from "./output.js";
import { searchDocuments } from "./search.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const INVALID_STRING_INPUT = "\0invalid-tool-input";
const INVALID_NUMBER_INPUT = -1;

function assertValidToolFields(...values: readonly unknown[]): void {
  if (
    values.some(
      (value) =>
        value === INVALID_STRING_INPUT ||
        value === INVALID_NUMBER_INPUT,
    )
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
  config: DocumentationConfig,
  operation: () => Promise<string> | string,
) {
  try {
    const output = await operation();
    return textResult(
      boundUtf8Output(output, config.limits.maxOutputBytes),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...textResult(
        boundUtf8Output(
          `Error: ${message}`,
          config.limits.maxOutputBytes,
        ),
      ),
      isError: true,
    };
  }
}

export function createDocumentationRetrievalServer(
  config: DocumentationConfig,
): McpServer {
  validateDocumentationConfig(config);
  const server = new McpServer({
    name: "documentation-retrieval-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "list_doc_roots",
    {
      description:
        "List stable IDs and absolute paths for configured local documentation roots.",
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      boundedToolResult(config, () => {
        void input;
        return JSON.stringify(config.roots, null, 2);
      }),
  );

  server.registerTool(
    "search_docs",
    {
      description:
        "Search configured local documentation using case-insensitive literal text.",
      inputSchema: z
        .object({
          query: z
            .string()
            .min(1)
            .max(config.limits.maxLineLength)
            .catch(INVALID_STRING_INPUT)
            .meta({ default: undefined }),
          rootId: z
            .string()
            .min(1)
            .max(64)
            .catch(INVALID_STRING_INPUT)
            .optional()
            .meta({ default: undefined }),
          pathPrefix: z
            .string()
            .min(1)
            .max(4_096)
            .catch(INVALID_STRING_INPUT)
            .optional()
            .meta({ default: undefined }),
        })
        .meta({ required: ["query"] }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, extra) =>
      boundedToolResult(config, () => {
        assertValidToolFields(
          input.query,
          input.rootId,
          input.pathPrefix,
        );
        return searchDocuments(config, {
          query: input.query,
          ...(input.rootId === undefined
            ? {}
            : { rootId: input.rootId }),
          ...(input.pathPrefix === undefined
            ? {}
            : { pathPrefix: input.pathPrefix }),
          signal: extra.signal,
        });
      }),
  );

  server.registerTool(
    "read_excerpt",
    {
      description:
        "Read bounded cited lines from a local documentation file.",
      inputSchema: z
        .object({
          rootId: z
            .string()
            .min(1)
            .max(64)
            .catch(INVALID_STRING_INPUT)
            .meta({ default: undefined }),
          path: z
            .string()
            .min(1)
            .max(4_096)
            .catch(INVALID_STRING_INPUT)
            .meta({ default: undefined }),
          startLine: z
            .number()
            .int()
            .positive()
            .catch(INVALID_NUMBER_INPUT)
            .meta({ default: undefined }),
          lineCount: z
            .number()
            .int()
            .positive()
            .catch(INVALID_NUMBER_INPUT)
            .meta({ default: undefined }),
        })
        .meta({
          required: ["rootId", "path", "startLine", "lineCount"],
        }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, extra) =>
      boundedToolResult(config, () => {
        assertValidToolFields(
          input.rootId,
          input.path,
          input.startLine,
          input.lineCount,
        );
        return readExcerpt(config, {
          rootId: input.rootId,
          path: input.path,
          startLine: input.startLine,
          lineCount: input.lineCount,
          signal: extra.signal,
        });
      }),
  );

  return server;
}

export const createServer = createDocumentationRetrievalServer;
