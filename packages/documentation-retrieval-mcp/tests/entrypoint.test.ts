import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the package exposes a dedicated stdio executable entrypoint", async () => {
  const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    bin?: Record<string, string>;
    exports?: Record<string, string>;
  };

  assert.equal(
    packageJson.bin?.["documentation-retrieval-mcp"],
    "./dist/index.js",
  );
  assert.equal(packageJson.exports?.["."], "./dist/server.js");
  await access(path.join(packageRoot, "src", "index.ts"));
});

test("the programmatic API exports createServer and loadConfig separately", async () => {
  const api = await import("../src/server.js");

  assert.equal("createServer" in api && typeof api.createServer, "function");
  assert.equal("loadConfig" in api && typeof api.loadConfig, "function");
});
