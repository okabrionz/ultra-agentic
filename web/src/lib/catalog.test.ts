import { describe, expect, test } from 'bun:test';

import { filterCatalogEntries, sortCatalogEntries } from './catalog';

const entries = [
  {
    data: {
      title: 'Repository Operations MCP',
      type: 'mcp',
      maturity: 'planned',
      summary: 'Scoped repository workflows',
      capabilities: ['Inspect repository state'],
      compatibility: ['Git repositories'],
      tags: ['automation', 'git']
    }
  },
  {
    data: {
      title: 'Observability Triage Skill',
      type: 'skill',
      maturity: 'beta',
      summary: 'Evidence-linked incident briefs',
      capabilities: ['Correlate telemetry'],
      compatibility: ['Structured logs'],
      tags: ['observability', 'diagnostics']
    }
  },
  {
    data: {
      title: 'Tool Failure Dataset',
      type: 'dataset',
      maturity: 'planned',
      summary: 'Failure classification records',
      capabilities: ['Define recovery labels'],
      compatibility: ['Evaluation pipelines'],
      tags: ['reliability']
    }
  }
] as const;

describe('sortCatalogEntries', () => {
  test('places featured entries first and sorts each group by title', () => {
    const entries = [
      { data: { title: 'Telemetry', featured: false } },
      { data: { title: 'Repository', featured: true } },
      { data: { title: 'Docs', featured: true } },
      { data: { title: 'Database', featured: false } }
    ];

    expect(sortCatalogEntries(entries).map((entry) => entry.data.title)).toEqual([
      'Docs',
      'Repository',
      'Database',
      'Telemetry'
    ]);
  });

  test('does not mutate the collection returned by Astro', () => {
    const entries = [
      { data: { title: 'Zeta', featured: false } },
      { data: { title: 'Alpha', featured: true } }
    ];

    sortCatalogEntries(entries);

    expect(entries.map((entry) => entry.data.title)).toEqual(['Zeta', 'Alpha']);
  });
});

describe('filterCatalogEntries', () => {
  test('matches a normalized query across searchable entry fields', () => {
    expect(
      filterCatalogEntries(entries, { query: '  TELEMETRY ', type: 'all', maturity: 'all' })
        .map((entry) => entry.data.title)
    ).toEqual(['Observability Triage Skill']);
  });

  test('combines type and maturity filters', () => {
    expect(
      filterCatalogEntries(entries, { query: '', type: 'mcp', maturity: 'planned' })
        .map((entry) => entry.data.title)
    ).toEqual(['Repository Operations MCP']);
  });

  test('returns all entries when filters are reset', () => {
    expect(
      filterCatalogEntries(entries, { query: '', type: 'all', maturity: 'all' })
    ).toHaveLength(entries.length);
  });
});
