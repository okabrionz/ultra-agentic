export const catalogTypes = ['mcp', 'skill', 'dataset'] as const;
export const catalogMaturities = ['planned', 'beta', 'stable'] as const;

export type CatalogType = (typeof catalogTypes)[number];
export type CatalogMaturity = (typeof catalogMaturities)[number];

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
