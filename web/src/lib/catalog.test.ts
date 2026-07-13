import { describe, expect, test } from 'bun:test';

import * as catalog from './catalog';
import { filterCatalogEntries, sortCatalogEntries } from './catalog';

const releaseHelpers = catalog as typeof catalog & {
  isStrictSemver: (value: string) => boolean;
  isSafeReleaseDownload: (download: string, artifact: string, version: string) => boolean;
  getCatalogPublicationIssue: (entry: {
    maturity: 'planned' | 'beta' | 'stable';
    source?: string;
    release?: {
      artifact: string;
      version: string;
      download: string;
      quickStart: readonly { label: string; command: string }[];
    };
  }) => string | undefined;
  getCatalogMaturityDescription: (
    maturity: 'planned' | 'beta' | 'stable',
    version?: string
  ) => string;
  validateCatalogEntries: <
    T extends {
      id: string;
      data: {
        release?: {
          artifact: string;
          version: string;
          download: string;
          quickStart: readonly { label: string; command: string }[];
        };
      };
    }
  >(
    entries: readonly T[]
  ) => T[];
};

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

describe('catalog release metadata', () => {
  const release = {
    artifact: 'repository-operations-mcp',
    version: '0.1.0',
    download: '/downloads/repository-operations-mcp-0.1.0.zip',
    quickStart: [
      {
        label: 'Enter the extracted package directory',
        command: 'cd repository-operations-mcp-0.1.0'
      },
      { label: 'Install runtime dependencies', command: 'npm install --omit=dev' },
      {
        label: 'Start the server for one repository',
        command: 'REPO_ROOT=/path/to/repository node dist/index.js'
      }
    ]
  } as const;

  test('accepts strict semantic versions and rejects shorthand or prefixed versions', () => {
    expect(typeof releaseHelpers.isStrictSemver).toBe('function');
    expect(releaseHelpers.isStrictSemver('0.1.0')).toBe(true);
    expect(releaseHelpers.isStrictSemver('1.2.3-alpha.1+build.5')).toBe(true);
    expect(releaseHelpers.isStrictSemver('v0.1.0')).toBe(false);
    expect(releaseHelpers.isStrictSemver('01.2.3')).toBe(false);
    expect(releaseHelpers.isStrictSemver('1.2')).toBe(false);
  });

  test('accepts only versioned ZIP files below the site downloads directory', () => {
    expect(typeof releaseHelpers.isSafeReleaseDownload).toBe('function');
    expect(
      releaseHelpers.isSafeReleaseDownload(
        release.download,
        release.artifact,
        release.version
      )
    ).toBe(true);
    expect(
      releaseHelpers.isSafeReleaseDownload(
        '/downloads/repository-operations-mcp.zip',
        release.artifact,
        release.version
      )
    ).toBe(false);
    expect(
      releaseHelpers.isSafeReleaseDownload(
        '/downloads/../repository-operations-mcp-0.1.0.zip',
        release.artifact,
        release.version
      )
    ).toBe(false);
    expect(
      releaseHelpers.isSafeReleaseDownload(
        '/downloads/repository-operations-mcp-0.1.0.zip?raw=1',
        release.artifact,
        release.version
      )
    ).toBe(false);
    expect(
      releaseHelpers.isSafeReleaseDownload(
        'https://example.com/repository-operations-mcp-0.1.0.zip',
        release.artifact,
        release.version
      )
    ).toBe(false);
    expect(
      releaseHelpers.isSafeReleaseDownload(
        '/downloads/documentation-retrieval-mcp-0.1.0.zip',
        release.artifact,
        release.version
      )
    ).toBe(false);
  });

  test('keeps planned entries source-free and requires complete released metadata', () => {
    expect(typeof releaseHelpers.getCatalogPublicationIssue).toBe('function');
    expect(
      releaseHelpers.getCatalogPublicationIssue({
        maturity: 'planned',
        source: 'https://github.com/deirs/ultra-agentic',
        release
      })
    ).toBe('Planned entries cannot publish source or release metadata.');
    expect(releaseHelpers.getCatalogPublicationIssue({ maturity: 'beta' })).toBe(
      'Beta and stable entries require an HTTPS source and release metadata.'
    );
    expect(
      releaseHelpers.getCatalogPublicationIssue({
        maturity: 'stable',
        source: 'http://example.com/source',
        release
      })
    ).toBe('Beta and stable entries require an HTTPS source and release metadata.');
    expect(
      releaseHelpers.getCatalogPublicationIssue({
        maturity: 'beta',
        source: 'https://github.com/deirs/ultra-agentic',
        release
      })
    ).toBeUndefined();
  });

  test('rejects cross-entry artifacts and mismatched release filenames', () => {
    expect(typeof releaseHelpers.validateCatalogEntries).toBe('function');

    expect(() =>
      releaseHelpers.validateCatalogEntries([
        {
          id: 'repository-operations-mcp',
          data: {
            release: {
              ...release,
              artifact: 'documentation-retrieval-mcp',
              download: '/downloads/documentation-retrieval-mcp-0.1.0.zip'
            }
          }
        }
      ])
    ).toThrow(
      'Release artifact "documentation-retrieval-mcp" must match catalog entry id "repository-operations-mcp".'
    );

    expect(() =>
      releaseHelpers.validateCatalogEntries([
        {
          id: 'repository-operations-mcp',
          data: {
            release: {
              ...release,
              download: '/downloads/repository-operations-0.1.0.zip'
            }
          }
        }
      ])
    ).toThrow(
      'Release download for "repository-operations-mcp" must be "/downloads/repository-operations-mcp-0.1.0.zip".'
    );
  });

  test('returns maturity-specific detail copy for beta and stable releases', () => {
    expect(typeof releaseHelpers.getCatalogMaturityDescription).toBe('function');

    const betaCopy = releaseHelpers.getCatalogMaturityDescription('beta', '0.1.0');
    expect(betaCopy).toContain('beta artifact');
    expect(betaCopy).toContain('interfaces may change');

    const stableCopy = releaseHelpers.getCatalogMaturityDescription('stable', '1.0.0');
    expect(stableCopy).toContain('released as stable');
    expect(stableCopy).toContain('review source, permissions, and compatibility');
    expect(stableCopy.toLowerCase()).not.toContain('beta');
  });
});
