export const catalogTypes = ['mcp', 'skill', 'dataset'] as const;
export const catalogMaturities = ['planned', 'beta', 'stable'] as const;

export type CatalogType = (typeof catalogTypes)[number];
export type CatalogMaturity = (typeof catalogMaturities)[number];
export type CatalogQuickStartStep = {
  label: string;
  command: string;
};
export type CatalogRelease = {
  artifact: string;
  version: string;
  download: string;
  quickStart: readonly CatalogQuickStartStep[];
};

export const catalogTypeLabels: Record<CatalogType, string> = {
  mcp: 'MCP',
  skill: 'Skill',
  dataset: 'Dataset'
};

export const catalogMaturityLabels: Record<CatalogMaturity, string> = {
  planned: 'Planned',
  beta: 'Beta',
  stable: 'Stable'
};

const strictSemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isStrictSemver(value: string): boolean {
  return strictSemverPattern.test(value);
}

const catalogArtifactPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isCatalogArtifactName(value: string): boolean {
  return catalogArtifactPattern.test(value);
}

export function isSafeReleaseDownload(
  download: string,
  artifact: string,
  version: string
): boolean {
  return (
    isCatalogArtifactName(artifact) &&
    isStrictSemver(version) &&
    download === `/downloads/${artifact}-${version}.zip`
  );
}

type CatalogPublicationState = {
  maturity: CatalogMaturity;
  source?: string;
  release?: CatalogRelease;
};

export function getCatalogPublicationIssue(
  entry: CatalogPublicationState
): string | undefined {
  if (entry.maturity === 'planned') {
    return entry.source || entry.release
      ? 'Planned entries cannot publish source or release metadata.'
      : undefined;
  }

  let hasHttpsSource = false;
  if (entry.source) {
    try {
      hasHttpsSource = new URL(entry.source).protocol === 'https:';
    } catch {
      hasHttpsSource = false;
    }
  }

  return hasHttpsSource && entry.release
    ? undefined
    : 'Beta and stable entries require an HTTPS source and release metadata.';
}

export function getCatalogMaturityDescription(
  maturity: CatalogMaturity,
  version?: string
): string {
  if (maturity === 'planned') {
    return 'This page documents intended scope. It is not a released package, hosted service, or usage claim.';
  }

  const releaseLabel = version ? `Version ${version}` : 'This release';
  if (maturity === 'beta') {
    return `${releaseLabel} is available as a beta artifact. Its interfaces may change; review source, permissions, and compatibility before adoption.`;
  }

  return `${releaseLabel} is released as stable. Users must still review source, permissions, and compatibility before adoption.`;
}

type IdentifiedCatalogEntry = {
  id: string;
  data: {
    release?: CatalogRelease;
  };
};

export function validateCatalogEntries<T extends IdentifiedCatalogEntry>(
  entries: readonly T[]
): T[] {
  for (const entry of entries) {
    const { release } = entry.data;
    if (!release) continue;

    if (release.artifact !== entry.id) {
      throw new Error(
        `Release artifact "${release.artifact}" must match catalog entry id "${entry.id}".`
      );
    }

    const expectedDownload = `/downloads/${release.artifact}-${release.version}.zip`;
    if (!isSafeReleaseDownload(release.download, release.artifact, release.version)) {
      throw new Error(
        `Release download for "${entry.id}" must be "${expectedDownload}".`
      );
    }
  }

  return [...entries];
}

export type CatalogFilters = {
  query: string;
  type: CatalogType | 'all';
  maturity: CatalogMaturity | 'all';
};

type FilterableCatalogEntry = {
  data: {
    title: string;
    type: CatalogType;
    maturity: CatalogMaturity;
    summary: string;
    capabilities: readonly string[];
    compatibility: readonly string[];
    tags: readonly string[];
  };
};

type SortableCatalogEntry = {
  data: {
    title: string;
    featured: boolean;
  };
};

export function sortCatalogEntries<T extends SortableCatalogEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.data.featured) - Number(a.data.featured) ||
      a.data.title.localeCompare(b.data.title)
  );
}

export function filterCatalogEntries<T extends FilterableCatalogEntry>(
  entries: readonly T[],
  filters: CatalogFilters
): T[] {
  const query = filters.query.trim().toLocaleLowerCase();

  return entries.filter((entry) => {
    const matchesType = filters.type === 'all' || entry.data.type === filters.type;
    const matchesMaturity =
      filters.maturity === 'all' || entry.data.maturity === filters.maturity;
    const searchable = [
      entry.data.title,
      entry.data.summary,
      ...entry.data.capabilities,
      ...entry.data.compatibility,
      ...entry.data.tags
    ]
      .join(' ')
      .toLocaleLowerCase();

    return matchesType && matchesMaturity && (!query || searchable.includes(query));
  });
}
