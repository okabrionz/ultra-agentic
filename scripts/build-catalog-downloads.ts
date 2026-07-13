import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { zipSync, type Zippable, type ZipOptions } from "fflate";

const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0);
const ZIP_OPTIONS: ZipOptions = {
  level: 9,
  mtime: FIXED_MTIME,
  os: 3,
};
const MCP_PACKAGES = [
  "repository-operations-mcp",
  "documentation-retrieval-mcp",
] as const;
const TARGET_PREFIXES = [
  ...MCP_PACKAGES,
  "deployment-readiness-skill",
] as const;
const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const encoder = new TextEncoder();

type ArchiveEntry = {
  archivePath: string;
  data: Uint8Array;
  mode?: 0o644 | 0o755;
};

type SourceManifest = {
  name: string;
  version: string;
  description: string;
  type: string;
  engines: { node: string };
  bin: Record<string, string>;
  exports?: Record<string, string>;
  dependencies: Record<string, string>;
};

type RootManifest = {
  version: string;
};

export type BuildCatalogDownloadsOptions = {
  rootDirectory?: string;
  outputDirectory?: string;
  outputOperations?: Partial<CatalogOutputOperations>;
};

export type BuiltArchive = {
  fileName: string;
  byteLength: number;
};

export type CatalogOutputOperations = {
  writeFile: (
    filePath: string,
    data: Uint8Array,
    options: { flag: "wx" },
  ) => Promise<void>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
};

const DEFAULT_OUTPUT_OPERATIONS: CatalogOutputOperations = {
  writeFile: async (filePath, data, options) => {
    await writeFile(filePath, data, options);
  },
  rename,
  unlink,
};

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateArchivePaths(archivePaths: readonly string[]) {
  const canonicalPaths = new Map<string, string>();
  const reservedDeviceName =
    /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;

  for (const archivePath of archivePaths) {
    const normalizedPath = archivePath.normalize("NFC");
    const canonicalPath = normalizedPath.toLowerCase().normalize("NFC");
    const collision = canonicalPaths.get(canonicalPath);
    if (collision !== undefined) {
      throw new Error(
        `ZIP entry path collision: ${JSON.stringify(collision)} and ${JSON.stringify(archivePath)}`,
      );
    }

    const parts = archivePath.split("/");
    const hasUnsafeSegment = parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part !== part.normalize("NFC") ||
        /[ .]$/.test(part) ||
        /[\u0000-\u001f\u007f<>:"|?*]/u.test(part) ||
        reservedDeviceName.test(part),
    );
    if (
      archivePath.length === 0 ||
      archivePath.includes("\\") ||
      path.posix.isAbsolute(archivePath) ||
      /^[A-Za-z]:/.test(archivePath) ||
      path.posix.normalize(archivePath) !== archivePath ||
      hasUnsafeSegment
    ) {
      throw new Error(
        `Unsafe ZIP entry path: ${JSON.stringify(archivePath)}`,
      );
    }

    canonicalPaths.set(canonicalPath, archivePath);
  }
}

async function listRegularFiles(
  directory: string,
  relativeDirectory = "",
): Promise<string[]> {
  const entries = await readdir(path.join(directory, relativeDirectory), {
    withFileTypes: true,
  });
  entries.sort((left, right) => compareCodePoints(left.name, right.name));
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(
      relativeDirectory.replaceAll("\\", "/"),
      entry.name,
    );
    if (entry.isDirectory()) {
      files.push(...(await listRegularFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported distribution entry: ${relativePath}`);
    }
  }

  return files;
}

async function readSourceManifest(
  packageDirectory: string,
  catalogVersion: string,
): Promise<SourceManifest> {
  const manifestPath = path.join(packageDirectory, "package.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as SourceManifest;

  if (
    !manifest.name ||
    !manifest.description ||
    manifest.type !== "module" ||
    manifest.engines?.node !== ">=22.12.0" ||
    !manifest.bin ||
    !manifest.dependencies
  ) {
    throw new Error(`Invalid distribution metadata in ${manifestPath}`);
  }
  if (manifest.version !== catalogVersion) {
    throw new Error(
      `Package version ${manifest.version} in ${manifestPath} must match catalog version ${catalogVersion}`,
    );
  }

  return manifest;
}

async function readCatalogVersion(rootDirectory: string) {
  const manifestPath = path.join(rootDirectory, "package.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as RootManifest;
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`Invalid catalog version in ${manifestPath}`);
  }
  return manifest.version;
}

function productionManifest(source: SourceManifest) {
  return {
    name: source.name,
    version: source.version,
    description: source.description,
    type: source.type,
    license: "MIT",
    engines: { node: ">=22.12.0" },
    bin: source.bin,
    ...(source.exports ? { exports: source.exports } : {}),
    dependencies: source.dependencies,
  };
}

function createDeterministicZip(entries: ArchiveEntry[]) {
  const sortedEntries = [...entries].sort((left, right) =>
    compareCodePoints(left.archivePath, right.archivePath),
  );
  validateArchivePaths(sortedEntries.map(({ archivePath }) => archivePath));
  const zippable: Zippable = {};

  for (const entry of sortedEntries) {
    if (Object.hasOwn(zippable, entry.archivePath)) {
      throw new Error(`Duplicate ZIP entry path: ${entry.archivePath}`);
    }
    zippable[entry.archivePath] = [
      entry.data,
      {
        ...ZIP_OPTIONS,
        attrs: (entry.mode ?? 0o644) << 16,
      },
    ];
  }

  return zipSync(zippable);
}

async function mcpArchiveEntries(
  rootDirectory: string,
  packageName: (typeof MCP_PACKAGES)[number],
  catalogVersion: string,
) {
  const packageDirectory = path.join(rootDirectory, "packages", packageName);
  const distDirectory = path.join(packageDirectory, "dist");
  const topDirectory = `${packageName}-${catalogVersion}`;
  const source = await readSourceManifest(packageDirectory, catalogVersion);
  const executablePaths = new Set(
    Object.values(source.bin).map((binPath) => binPath.replace(/^\.\//, "")),
  );
  const entries: ArchiveEntry[] = [
    {
      archivePath: `${topDirectory}/LICENSE`,
      data: await readFile(path.join(rootDirectory, "LICENSE")),
    },
    {
      archivePath: `${topDirectory}/README.md`,
      data: await readFile(path.join(packageDirectory, "README.md")),
    },
    {
      archivePath: `${topDirectory}/package.json`,
      data: encoder.encode(
        `${JSON.stringify(productionManifest(source), null, 2)}\n`,
      ),
    },
  ];

  for (const relativePath of await listRegularFiles(distDirectory)) {
    entries.push({
      archivePath: `${topDirectory}/dist/${relativePath}`,
      data: await readFile(path.join(distDirectory, relativePath)),
      mode: executablePaths.has(`dist/${relativePath}`) ? 0o755 : 0o644,
    });
  }

  return entries;
}

async function skillArchiveEntries(rootDirectory: string) {
  const skillDirectory = path.join(
    rootDirectory,
    "skills",
    "deployment-readiness",
  );
  return [
    {
      archivePath: "deployment-readiness/LICENSE",
      data: await readFile(path.join(rootDirectory, "LICENSE")),
    },
    {
      archivePath: "deployment-readiness/SKILL.md",
      data: await readFile(path.join(skillDirectory, "SKILL.md")),
    },
    {
      archivePath: "deployment-readiness/checklist-template.md",
      data: await readFile(path.join(skillDirectory, "checklist-template.md")),
    },
  ] satisfies ArchiveEntry[];
}

type InMemoryArchive = {
  fileName: string;
  data: Uint8Array;
};

type PreparedArchive = InMemoryArchive & {
  finalPath: string;
  tempPath: string;
  backupPath?: string;
  published: boolean;
};

async function constructCatalogArchives(
  rootDirectory: string,
  catalogVersion: string,
): Promise<InMemoryArchive[]> {
  const archives = [
    ...(
      await Promise.all(
        MCP_PACKAGES.map(async (packageName) => ({
          fileName: `${packageName}-${catalogVersion}.zip`,
          data: createDeterministicZip(
            await mcpArchiveEntries(
              rootDirectory,
              packageName,
              catalogVersion,
            ),
          ),
        })),
      )
    ),
    {
      fileName: `deployment-readiness-skill-${catalogVersion}.zip`,
      data: createDeterministicZip(
        await skillArchiveEntries(rootDirectory),
      ),
    },
  ];
  return archives.sort((left, right) =>
    compareCodePoints(left.fileName, right.fileName),
  );
}

function isFileNotFound(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function readExistingFile(filePath: string) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

async function cleanPublishArtifacts(paths: Iterable<string>) {
  await Promise.all(
    [...paths].map(async (filePath) => {
      await rm(filePath, { force: true }).catch(() => undefined);
    }),
  );
}

async function cleanStaleTargets(
  outputDirectory: string,
  currentFileNames: ReadonlySet<string>,
  outputOperations: CatalogOutputOperations,
) {
  const entries = await readdir(outputDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const isTarget = TARGET_PREFIXES.some(
      (prefix) =>
        entry.name.startsWith(`${prefix}-`) && entry.name.endsWith(".zip"),
    );
    if (
      isTarget &&
      !currentFileNames.has(entry.name) &&
      (entry.isFile() || entry.isSymbolicLink())
    ) {
      await outputOperations.unlink(path.join(outputDirectory, entry.name));
    }
  }
}

async function publishCatalogArchives(
  archives: InMemoryArchive[],
  outputDirectory: string,
  outputOperations: CatalogOutputOperations,
) {
  await mkdir(outputDirectory, { recursive: true });
  const transactionId = randomUUID();
  const cleanupPaths = new Set<string>();
  const prepared: PreparedArchive[] = archives.map((archive, index) => {
    const tempPath = path.join(
      outputDirectory,
      `.catalog-download-${transactionId}-${index}.tmp`,
    );
    cleanupPaths.add(tempPath);
    return {
      ...archive,
      finalPath: path.join(outputDirectory, archive.fileName),
      tempPath,
      published: false,
    };
  });

  try {
    for (const archive of prepared) {
      await outputOperations.writeFile(
        archive.tempPath,
        archive.data,
        { flag: "wx" },
      );
    }

    for (const [index, archive] of prepared.entries()) {
      const existingData = await readExistingFile(archive.finalPath);
      if (existingData === undefined) continue;
      archive.backupPath = path.join(
        outputDirectory,
        `.catalog-download-${transactionId}-${index}.bak`,
      );
      cleanupPaths.add(archive.backupPath);
      await outputOperations.writeFile(
        archive.backupPath,
        existingData,
        { flag: "wx" },
      );
    }

    for (const archive of prepared) {
      await outputOperations.rename(archive.tempPath, archive.finalPath);
      cleanupPaths.delete(archive.tempPath);
      archive.published = true;
    }
  } catch (error) {
    for (const archive of [...prepared].reverse()) {
      if (!archive.published) continue;
      if (archive.backupPath !== undefined) {
        try {
          await outputOperations.rename(
            archive.backupPath,
            archive.finalPath,
          );
          cleanupPaths.delete(archive.backupPath);
        } catch {
          // The newly published target remains linked if restoration fails.
        }
      } else {
        await outputOperations.unlink(archive.finalPath).catch(() => undefined);
      }
    }
    await cleanPublishArtifacts(cleanupPaths);
    throw error;
  }

  await cleanPublishArtifacts(cleanupPaths);
  await cleanStaleTargets(
    outputDirectory,
    new Set(archives.map(({ fileName }) => fileName)),
    outputOperations,
  );
}

export async function buildCatalogDownloads(
  options: BuildCatalogDownloadsOptions = {},
): Promise<BuiltArchive[]> {
  const rootDirectory = path.resolve(options.rootDirectory ?? DEFAULT_ROOT);
  const catalogVersion = await readCatalogVersion(rootDirectory);
  const archives = await constructCatalogArchives(
    rootDirectory,
    catalogVersion,
  );
  const outputDirectory = path.resolve(
    options.outputDirectory ??
      path.join(rootDirectory, "web", "public", "downloads"),
  );
  const outputOperations = {
    ...DEFAULT_OUTPUT_OPERATIONS,
    ...options.outputOperations,
  };
  await publishCatalogArchives(
    archives,
    outputDirectory,
    outputOperations,
  );

  return archives.map(({ fileName, data }) => ({
    fileName,
    byteLength: data.byteLength,
  }));
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  const archives = await buildCatalogDownloads();
  for (const archive of archives) {
    console.log(`${archive.fileName}\t${archive.byteLength} bytes`);
  }
}
