import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { unzipSync } from "fflate";

const root = process.cwd();
const rootManifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
) as { version: string };
const version = rootManifest.version;
const archiveNames = [
  `repository-operations-mcp-${version}.zip`,
  `documentation-retrieval-mcp-${version}.zip`,
  `deployment-readiness-skill-${version}.zip`,
].sort();
const decoder = new TextDecoder();
const execFileAsync = promisify(execFile);
const npmCommand = "npm";
const npxCommand = "npx";
const targetArchivePattern =
  /^(?:repository-operations-mcp|documentation-retrieval-mcp|deployment-readiness-skill)-.+\.zip$/;
const mcpPackages = [
  {
    directory: "repository-operations-mcp",
    bin: "repository-operations-mcp",
    environment: { REPO_ROOT: root },
  },
  {
    directory: "documentation-retrieval-mcp",
    bin: "documentation-retrieval-mcp",
    environment: { DOC_ROOTS: "." },
  },
] as const;

async function loadBuilder() {
  return import("../scripts/build-catalog-downloads.js");
}

function platformCommand(command: string, args: string[]) {
  if (process.platform === "win32" && command !== process.execPath) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", [command, ...args].join(" ")],
    };
  }
  return { command, args };
}

async function runRootBuild() {
  const invocation = platformCommand(npmCommand, ["run", "build"]);
  await execFileAsync(invocation.command, invocation.args, {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
}

type ZipEntryMetadata = {
  name: string;
  os: number;
  compressionMethod: number;
  dosTime: number;
  dosDate: number;
  mode: number;
};

function zipEntryMetadata(bytes: Uint8Array): ZipEntryMetadata[] {
  const data = Buffer.from(bytes);
  let endOffset = data.length - 22;
  while (
    endOffset >= 0 &&
    data.readUInt32LE(endOffset) !== 0x06054b50
  ) {
    endOffset -= 1;
  }
  assert.ok(endOffset >= 0, "ZIP end-of-central-directory record is missing");

  const entryCount = data.readUInt16LE(endOffset + 10);
  let offset = data.readUInt32LE(endOffset + 16);
  const entries: ZipEntryMetadata[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(
      data.readUInt32LE(offset),
      0x02014b50,
      "ZIP central-directory entry is malformed",
    );
    const madeBy = data.readUInt16LE(offset + 4);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const externalAttributes = data.readUInt32LE(offset + 38);
    const name = data
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");

    entries.push({
      name,
      os: madeBy >>> 8,
      compressionMethod: data.readUInt16LE(offset + 10),
      dosTime: data.readUInt16LE(offset + 12),
      dosDate: data.readUInt16LE(offset + 14),
      mode: (externalAttributes >>> 16) & 0xffff,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function assertDeterministicMetadata(
  archive: Uint8Array,
  executablePath?: string,
) {
  const entries = zipEntryMetadata(archive);
  assert.deepEqual(
    entries.map(({ name }) => name),
    entries.map(({ name }) => name).sort(),
    "central-directory entries must use stable sorted order",
  );
  for (const entry of entries) {
    assert.equal(entry.os, 3, `${entry.name} must declare Unix ZIP origin`);
    assert.equal(
      entry.compressionMethod,
      8,
      `${entry.name} must use DEFLATE compression`,
    );
    assert.equal(entry.dosTime, 0, `${entry.name} must use fixed DOS time`);
    assert.equal(entry.dosDate, 33, `${entry.name} must use 1980-01-01`);
    assert.equal(
      entry.mode & 0o777,
      entry.name === executablePath ? 0o755 : 0o644,
      `${entry.name} has the wrong Unix mode`,
    );
  }
}

async function extractArchive(archive: Uint8Array, destination: string) {
  const metadata = new Map(
    zipEntryMetadata(archive).map((entry) => [entry.name, entry]),
  );
  const files = unzipSync(archive);
  for (const [name, data] of Object.entries(files)) {
    const outputPath = path.join(destination, ...name.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, data);
    await chmod(outputPath, (metadata.get(name)?.mode ?? 0o644) & 0o777);
  }
}

async function stopProcessTree(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid !== undefined) {
    await execFileAsync("taskkill.exe", [
      "/pid",
      String(child.pid),
      "/t",
      "/f",
    ]).catch(() => undefined);
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([once(child, "exit"), delay(2_000)]);
}

async function assertCommandStarts(
  command: string,
  args: string[],
  cwd: string,
  extraEnvironment: NodeJS.ProcessEnv,
) {
  const invocation = platformCommand(command, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env: { ...process.env, ...extraEnvironment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  await delay(500);
  try {
    assert.equal(
      child.exitCode,
      null,
      `${command} ${args.join(" ")} exited early: ${stderr}`,
    );
  } finally {
    await stopProcessTree(child);
  }
}

async function createCatalogFixture(t: TestContext, catalogVersion: string) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "deirs-downloads-fixture-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({ version: catalogVersion })}\n`,
  );
  await writeFile(path.join(directory, "LICENSE"), "fixture license\n");
  const skillDirectory = path.join(
    directory,
    "skills",
    "deployment-readiness",
  );
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(path.join(skillDirectory, "SKILL.md"), "# Fixture skill\n");
  await writeFile(
    path.join(skillDirectory, "checklist-template.md"),
    "# Fixture template\n",
  );

  for (const packageName of [
    "repository-operations-mcp",
    "documentation-retrieval-mcp",
  ]) {
    const packageDirectory = path.join(directory, "packages", packageName);
    await mkdir(path.join(packageDirectory, "dist"), { recursive: true });
    await writeFile(path.join(packageDirectory, "README.md"), "# Fixture\n");
    await writeFile(
      path.join(packageDirectory, "dist", "index.js"),
      "#!/usr/bin/env node\n",
    );
    await writeFile(
      path.join(packageDirectory, "package.json"),
      `${JSON.stringify({
        name: `@deirs/${packageName}`,
        version: catalogVersion,
        description: "Fixture MCP",
        type: "module",
        engines: { node: ">=22.12.0" },
        bin: { [packageName]: "./dist/index.js" },
        ...(packageName === "documentation-retrieval-mcp"
          ? { exports: { ".": "./dist/index.js" } }
          : {}),
        dependencies: { zod: "^4.4.3" },
      })}\n`,
    );
  }

  return directory;
}

async function seedPublishedTargets(
  outputDirectory: string,
  catalogVersion: string,
) {
  await mkdir(outputDirectory, { recursive: true });
  const names = [
    `deployment-readiness-skill-${catalogVersion}.zip`,
    `documentation-retrieval-mcp-${catalogVersion}.zip`,
    `repository-operations-mcp-${catalogVersion}.zip`,
    "repository-operations-mcp-0.0.1.zip",
  ];
  for (const name of names) {
    await writeFile(path.join(outputDirectory, name), `existing:${name}`);
  }
}

async function snapshotZipFiles(outputDirectory: string) {
  const snapshot = new Map<string, Buffer>();
  for (const name of (await readdir(outputDirectory)).sort()) {
    if (name.endsWith(".zip")) {
      snapshot.set(name, await readFile(path.join(outputDirectory, name)));
    }
  }
  return snapshot;
}

async function assertZipSnapshot(
  outputDirectory: string,
  expected: Map<string, Buffer>,
) {
  assert.deepEqual(await snapshotZipFiles(outputDirectory), expected);
}

async function assertNoPublishTemps(outputDirectory: string) {
  const names = await readdir(outputDirectory);
  assert.equal(
    names.some((name) => name.startsWith(".catalog-download-")),
    false,
    `temporary publish artifacts remain: ${names.join(", ")}`,
  );
}

test("root scripts package downloads and verify artifact tests", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.equal(
    manifest.scripts?.test,
    "npm run test --workspaces --if-present",
  );
  assert.equal(
    manifest.scripts?.["test:artifacts"],
    "tsx --test tests/**/*.test.ts",
  );
  assert.equal(
    manifest.scripts?.["package:downloads"],
    "npm run build && tsx scripts/build-catalog-downloads.ts",
  );
  assert.equal(
    manifest.scripts?.verify,
    "npm run test && npm run typecheck && npm run build && npm run test:artifacts",
  );
});

test("archive names derive from root version and reject package drift", async (t) => {
  const fixtureVersion = "9.8.7";
  const fixtureRoot = await createCatalogFixture(t, fixtureVersion);
  const outputDirectory = path.join(fixtureRoot, "downloads");
  const { buildCatalogDownloads } = await loadBuilder();

  await buildCatalogDownloads({
    rootDirectory: fixtureRoot,
    outputDirectory,
  });

  assert.deepEqual((await readdir(outputDirectory)).sort(), [
    `deployment-readiness-skill-${fixtureVersion}.zip`,
    `documentation-retrieval-mcp-${fixtureVersion}.zip`,
    `repository-operations-mcp-${fixtureVersion}.zip`,
  ]);

  const repositoryManifestPath = path.join(
    fixtureRoot,
    "packages",
    "repository-operations-mcp",
    "package.json",
  );
  const repositoryManifest = JSON.parse(
    await readFile(repositoryManifestPath, "utf8"),
  ) as Record<string, unknown>;
  await writeFile(
    repositoryManifestPath,
    `${JSON.stringify({ ...repositoryManifest, version: "9.8.6" })}\n`,
  );

  await assert.rejects(
    buildCatalogDownloads({
      rootDirectory: fixtureRoot,
      outputDirectory,
    }),
    /version/i,
  );
});

test("validation failure preserves published archives without temp writes", async (t) => {
  const fixtureVersion = "9.8.7";
  const fixtureRoot = await createCatalogFixture(t, fixtureVersion);
  const outputDirectory = path.join(fixtureRoot, "downloads");
  await seedPublishedTargets(outputDirectory, fixtureVersion);
  const before = await snapshotZipFiles(outputDirectory);
  const repositoryManifestPath = path.join(
    fixtureRoot,
    "packages",
    "repository-operations-mcp",
    "package.json",
  );
  const repositoryManifest = JSON.parse(
    await readFile(repositoryManifestPath, "utf8"),
  ) as Record<string, unknown>;
  await writeFile(
    repositoryManifestPath,
    `${JSON.stringify({ ...repositoryManifest, version: "9.8.6" })}\n`,
  );
  let outputWrites = 0;
  const { buildCatalogDownloads } = await loadBuilder();

  await assert.rejects(
    buildCatalogDownloads({
      rootDirectory: fixtureRoot,
      outputDirectory,
      outputOperations: {
        writeFile: async () => {
          outputWrites += 1;
          throw new Error("output write should not run");
        },
      },
    } as Parameters<typeof buildCatalogDownloads>[0]),
    /version/i,
  );

  assert.equal(outputWrites, 0);
  await assertZipSnapshot(outputDirectory, before);
  await assertNoPublishTemps(outputDirectory);
});

test("temp-write failure preserves published archives and removes temps", async (t) => {
  const fixtureVersion = "9.8.7";
  const fixtureRoot = await createCatalogFixture(t, fixtureVersion);
  const outputDirectory = path.join(fixtureRoot, "downloads");
  await seedPublishedTargets(outputDirectory, fixtureVersion);
  const before = await snapshotZipFiles(outputDirectory);
  let tempWrites = 0;
  const { buildCatalogDownloads } = await loadBuilder();

  await assert.rejects(
    buildCatalogDownloads({
      rootDirectory: fixtureRoot,
      outputDirectory,
      outputOperations: {
        writeFile: async (filePath, data, options) => {
          if (
            path.basename(filePath).startsWith(".catalog-download-") &&
            path.basename(filePath).endsWith(".tmp")
          ) {
            tempWrites += 1;
            if (tempWrites === 2) {
              throw new Error("injected temp-write failure");
            }
          }
          await writeFile(filePath, data, options);
        },
      },
    } as Parameters<typeof buildCatalogDownloads>[0]),
    /injected temp-write failure/,
  );

  assert.equal(tempWrites, 2);
  await assertZipSnapshot(outputDirectory, before);
  await assertNoPublishTemps(outputDirectory);
});

test("publish failure restores published archives and removes temps", async (t) => {
  const fixtureVersion = "9.8.7";
  const fixtureRoot = await createCatalogFixture(t, fixtureVersion);
  const outputDirectory = path.join(fixtureRoot, "downloads");
  await seedPublishedTargets(outputDirectory, fixtureVersion);
  const before = await snapshotZipFiles(outputDirectory);
  let publishes = 0;
  const { buildCatalogDownloads } = await loadBuilder();

  await assert.rejects(
    buildCatalogDownloads({
      rootDirectory: fixtureRoot,
      outputDirectory,
      outputOperations: {
        rename: async (sourcePath, destinationPath) => {
          const sourceName = path.basename(sourcePath);
          if (sourceName.endsWith(".tmp")) {
            publishes += 1;
            await readFile(destinationPath);
            if (publishes === 2) {
              throw new Error("injected publish failure");
            }
          }
          await rename(sourcePath, destinationPath);
        },
      },
    } as Parameters<typeof buildCatalogDownloads>[0]),
    /injected publish failure/,
  );

  assert.equal(publishes, 2);
  await assertZipSnapshot(outputDirectory, before);
  await assertNoPublishTemps(outputDirectory);
});

test("archive paths reject portable hazards and normalized collisions", async () => {
  const { validateArchivePaths } = await loadBuilder();
  assert.equal(typeof validateArchivePaths, "function");
  assert.doesNotThrow(() =>
    validateArchivePaths([
      "package/LICENSE",
      "package/dist/index.js",
      "package/README.md",
    ]),
  );

  for (const invalidPath of [
    "../escape",
    "/absolute",
    "C:/absolute",
    "dir\\file",
    "dir//file",
    "dir/.",
    "dir/..",
    "dir/CON",
    "dir/prn.txt",
    "dir/AUX",
    "dir/nul.md",
    "dir/COM1",
    "dir/com9.log",
    "dir/LPT1",
    "dir/lpt9.txt",
    "dir/bad<name",
    "dir/bad>name",
    "dir/bad:name",
    "dir/bad\"name",
    "dir/bad|name",
    "dir/bad?name",
    "dir/bad*name",
    "dir/trailing.",
    "dir/trailing ",
    "dir/control\u0001",
    "dir/cafe\u0301.txt",
  ]) {
    assert.throws(
      () => validateArchivePaths([invalidPath]),
      /unsafe zip entry path/i,
      invalidPath,
    );
  }

  assert.throws(
    () => validateArchivePaths(["dir/Readme.md", "dir/README.MD"]),
    /collision/i,
  );
  assert.throws(
    () => validateArchivePaths(["dir/café.md", "dir/cafe\u0301.md"]),
    /collision|unsafe zip entry path/i,
  );
});

test("MCP READMEs separate downloaded usage from monorepo development", async () => {
  for (const packageSpec of mcpPackages) {
    const readme = await readFile(
      path.join(root, "packages", packageSpec.directory, "README.md"),
      "utf8",
    );
    assert.match(readme, /^## Downloaded archive$/m);
    assert.match(readme, /^npm install --omit=dev$/m);
    assert.match(readme, /^node dist\/index\.js$/m);
    assert.match(
      readme,
      new RegExp(`^npx --no-install ${packageSpec.bin}$`, "m"),
    );
    assert.match(readme, /^## Monorepo development$/m);
  }
});

async function listFiles(
  directory: string,
  relative = "",
): Promise<string[]> {
  const entries = await readdir(path.join(directory, relative), {
    withFileTypes: true,
  });
  const files: string[] = [];

  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, child)));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }

  return files.sort();
}

function assertSafeSortedPaths(names: string[]) {
  assert.deepEqual(names, [...names].sort(), "ZIP entries must be sorted");
  for (const name of names) {
    assert.ok(name.length > 0, "ZIP entry path must not be empty");
    assert.equal(name.includes("\\"), false, `${name} uses a backslash`);
    assert.equal(name.includes("\0"), false, `${name} contains a NUL`);
    assert.equal(path.posix.isAbsolute(name), false, `${name} is absolute`);
    assert.equal(/^[A-Za-z]:/.test(name), false, `${name} has a drive prefix`);
    assert.equal(path.posix.normalize(name), name, `${name} is not normalized`);
    assert.equal(
      name.split("/").some((part) => part === "." || part === ".."),
      false,
      `${name} contains traversal`,
    );
  }
}

function unzip(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  assertSafeSortedPaths(names);
  return { files, names };
}

function assertBytesEqual(
  actual: Uint8Array | undefined,
  expected: Uint8Array,
) {
  assert.ok(actual, "expected archive entry is missing");
  assert.deepEqual(Buffer.from(actual), Buffer.from(expected));
}

async function expectedMcpFiles(packageDirectory: string) {
  const distFiles = await listFiles(
    path.join(root, "packages", packageDirectory, "dist"),
  );
  const top = `${packageDirectory}-${version}`;
  return [
    `${top}/LICENSE`,
    `${top}/README.md`,
    ...distFiles.map((file) => `${top}/dist/${file}`),
    `${top}/package.json`,
  ].sort();
}

async function assertMcpArchive(
  outputDirectory: string,
  packageDirectory: string,
) {
  const archive = await readFile(
    path.join(outputDirectory, `${packageDirectory}-${version}.zip`),
  );
  const { files, names } = unzip(archive);
  const top = `${packageDirectory}-${version}`;
  assertDeterministicMetadata(archive, `${top}/dist/index.js`);
  const packageRoot = path.join(root, "packages", packageDirectory);
  const sourceManifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;

  assert.deepEqual(names, await expectedMcpFiles(packageDirectory));
  assert.deepEqual([...new Set(names.map((name) => name.split("/")[0]))], [
    top,
  ]);
  assert.equal(
    names.some((name) =>
      /(?:^|\/)(?:src|tests?|node_modules)(?:\/|$)/.test(name),
    ),
    false,
  );
  assert.equal(
    names.some((name) => /(?:package-lock|tsconfig).*\.json$/.test(name)),
    false,
  );

  const manifest = JSON.parse(
    decoder.decode(files[`${top}/package.json`]),
  ) as Record<string, unknown>;
  assert.deepEqual(manifest, {
    name: sourceManifest.name,
    version: sourceManifest.version,
    description: sourceManifest.description,
    type: sourceManifest.type,
    license: "MIT",
    engines: { node: ">=22.12.0" },
    bin: sourceManifest.bin,
    ...(sourceManifest.exports ? { exports: sourceManifest.exports } : {}),
    dependencies: sourceManifest.dependencies,
  });
  assert.match(
    decoder.decode(files[`${top}/dist/index.js`]),
    /^#!\/usr\/bin\/env node\r?\n/,
  );

  assertBytesEqual(
    files[`${top}/README.md`],
    await readFile(path.join(packageRoot, "README.md")),
  );
  assertBytesEqual(
    files[`${top}/LICENSE`],
    await readFile(path.join(root, "LICENSE")),
  );
  for (const distFile of await listFiles(path.join(packageRoot, "dist"))) {
    assertBytesEqual(
      files[`${top}/dist/${distFile}`],
      await readFile(path.join(packageRoot, "dist", distFile)),
    );
  }
}

test("catalog download archives contain exact safe distribution files", async (t) => {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "deirs-downloads-content-"),
  );
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const { buildCatalogDownloads } = await loadBuilder();

  await buildCatalogDownloads({ rootDirectory: root, outputDirectory });

  assert.deepEqual((await readdir(outputDirectory)).sort(), archiveNames);
  await assertMcpArchive(outputDirectory, "repository-operations-mcp");
  await assertMcpArchive(outputDirectory, "documentation-retrieval-mcp");

  const skillArchive = await readFile(
    path.join(
      outputDirectory,
      `deployment-readiness-skill-${version}.zip`,
    ),
  );
  const { files, names } = unzip(skillArchive);
  assertDeterministicMetadata(skillArchive);
  assert.deepEqual(names, [
    "deployment-readiness/LICENSE",
    "deployment-readiness/SKILL.md",
    "deployment-readiness/checklist-template.md",
  ]);
  assertBytesEqual(
    files["deployment-readiness/LICENSE"],
    await readFile(path.join(root, "LICENSE")),
  );
  assertBytesEqual(
    files["deployment-readiness/SKILL.md"],
    await readFile(
      path.join(root, "skills", "deployment-readiness", "SKILL.md"),
    ),
  );
  assertBytesEqual(
    files["deployment-readiness/checklist-template.md"],
    await readFile(
      path.join(
        root,
        "skills",
        "deployment-readiness",
        "checklist-template.md",
      ),
    ),
  );
});

test("workspace builds remove stale dist files before packaging", async (t) => {
  const staleName = "stale-removed-source.js";
  const stalePaths = [
    path.join(
      root,
      "packages",
      "repository-operations-mcp",
      "dist",
      staleName,
    ),
    path.join(
      root,
      "packages",
      "documentation-retrieval-mcp",
      "dist",
      staleName,
    ),
  ];
  t.after(async () => {
    await Promise.all(
      stalePaths.map((stalePath) => rm(stalePath, { force: true })),
    );
  });
  for (const stalePath of stalePaths) {
    await writeFile(stalePath, "stale compiled output\n");
  }

  await runRootBuild();

  for (const stalePath of stalePaths) {
    await assert.rejects(readFile(stalePath), { code: "ENOENT" });
  }

  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "deirs-downloads-clean-dist-"),
  );
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const { buildCatalogDownloads } = await loadBuilder();
  await buildCatalogDownloads({ rootDirectory: root, outputDirectory });
  for (const archiveName of archiveNames.slice(1)) {
    const { names } = unzip(await readFile(path.join(outputDirectory, archiveName)));
    assert.equal(
      names.some((name) => name.endsWith(`/${staleName}`)),
      false,
      `${archiveName} contains stale dist output`,
    );
  }
});

test("public target archives exactly match a fresh build", async (t) => {
  await runRootBuild();
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "deirs-downloads-public-freshness-"),
  );
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const { buildCatalogDownloads } = await loadBuilder();
  await buildCatalogDownloads({ rootDirectory: root, outputDirectory });

  const publicDirectory = path.join(root, "web", "public", "downloads");
  const freshNames = (await readdir(outputDirectory))
    .filter((name) => targetArchivePattern.test(name))
    .sort();
  const publicNames = (await readdir(publicDirectory))
    .filter((name) => targetArchivePattern.test(name))
    .sort();
  assert.deepEqual(
    publicNames,
    freshNames,
    "public downloads have missing, stale-version, or extra target archives",
  );
  for (const archiveName of freshNames) {
    assert.deepEqual(
      await readFile(path.join(publicDirectory, archiveName)),
      await readFile(path.join(outputDirectory, archiveName)),
      `${archiveName} is stale; regenerate public downloads`,
    );
  }
});

test("extracted MCP archives install and start documented commands", async (t) => {
  const extractionDirectory = await mkdtemp(
    path.join(tmpdir(), "deirs-downloads-smoke-"),
  );
  t.after(() => rm(extractionDirectory, { recursive: true, force: true }));
  const publicDirectory = path.join(root, "web", "public", "downloads");

  for (const packageSpec of mcpPackages) {
    const archive = await readFile(
      path.join(
        publicDirectory,
        `${packageSpec.directory}-${version}.zip`,
      ),
    );
    await extractArchive(archive, extractionDirectory);
    const packageDirectory = path.join(
      extractionDirectory,
      `${packageSpec.directory}-${version}`,
    );
    const install = platformCommand(npmCommand, ["install", "--omit=dev"]);
    await execFileAsync(install.command, install.args, {
      cwd: packageDirectory,
      maxBuffer: 10 * 1024 * 1024,
    });

    await assertCommandStarts(
      process.execPath,
      ["dist/index.js"],
      packageDirectory,
      packageSpec.environment,
    );
    await assertCommandStarts(
      npxCommand,
      ["--no-install", packageSpec.bin],
      packageDirectory,
      packageSpec.environment,
    );
  }
});

test("catalog downloads are byte-identical and stale targets are cleaned", async (t) => {
  const firstDirectory = await mkdtemp(
    path.join(tmpdir(), "deirs-downloads-first-"),
  );
  const secondDirectory = await mkdtemp(
    path.join(tmpdir(), "deirs-downloads-second-"),
  );
  t.after(() => rm(firstDirectory, { recursive: true, force: true }));
  t.after(() => rm(secondDirectory, { recursive: true, force: true }));
  const { buildCatalogDownloads } = await loadBuilder();

  await buildCatalogDownloads({
    rootDirectory: root,
    outputDirectory: firstDirectory,
  });
  await buildCatalogDownloads({
    rootDirectory: root,
    outputDirectory: secondDirectory,
  });

  for (const archiveName of archiveNames) {
    assert.deepEqual(
      await readFile(path.join(firstDirectory, archiveName)),
      await readFile(path.join(secondDirectory, archiveName)),
      `${archiveName} changed between builds`,
    );
  }

  const staleNames = [
    "repository-operations-mcp-0.0.9.zip",
    "documentation-retrieval-mcp-old.zip",
    "deployment-readiness-skill-previous.zip",
  ];
  for (const staleName of staleNames) {
    await writeFile(path.join(secondDirectory, staleName), "stale");
  }
  await writeFile(path.join(secondDirectory, "unrelated.zip"), "keep");

  await buildCatalogDownloads({
    rootDirectory: root,
    outputDirectory: secondDirectory,
  });

  for (const staleName of staleNames) {
    await assert.rejects(readFile(path.join(secondDirectory, staleName)), {
      code: "ENOENT",
    });
  }
  assert.equal(
    await readFile(path.join(secondDirectory, "unrelated.zip"), "utf8"),
    "keep",
  );
  for (const archiveName of archiveNames) {
    assert.deepEqual(
      await readFile(path.join(firstDirectory, archiveName)),
      await readFile(path.join(secondDirectory, archiveName)),
      `${archiveName} changed after stale cleanup`,
    );
  }
  await assertNoPublishTemps(firstDirectory);
  await assertNoPublishTemps(secondDirectory);
});
