import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const dist = join(import.meta.dir, '..', 'dist');
const publicDownloads = join(import.meta.dir, '..', 'public', 'downloads');
const repositoryRoot = join(import.meta.dir, '..', '..');
const pageRoutes = [
  'index.html',
  'about/index.html',
  'catalog/index.html',
  'get-started/index.html',
  'sponsors/index.html',
  '404.html'
] as const;
const catalogRoutes = [
  'catalog/database-context-mcp/index.html',
  'catalog/deployment-readiness-skill/index.html',
  'catalog/documentation-retrieval-mcp/index.html',
  'catalog/observability-triage-skill/index.html',
  'catalog/repository-operations-mcp/index.html',
  'catalog/tool-failure-dataset/index.html'
] as const;
const releaseVersion = '0.1.0';
const releasedCatalogRoutes = [
  {
    artifact: 'deployment-readiness-skill',
    route: 'catalog/deployment-readiness-skill/index.html',
    title: 'Deployment Readiness Skill',
    source: 'https://github.com/deirs/ultra-agentic/tree/main/skills/deployment-readiness',
    sourceDirectory: 'skills/deployment-readiness',
    download: '/downloads/deployment-readiness-skill-0.1.0.zip',
    programmingLanguage: 'Markdown',
    archiveKind: 'skill',
    size: 3_399,
    sha256: 'd34cdde92f0e68e473a81e70c6367012fe1dd215d11fee95b919f34cd6ee81bd'
  },
  {
    artifact: 'documentation-retrieval-mcp',
    route: 'catalog/documentation-retrieval-mcp/index.html',
    title: 'Documentation Retrieval MCP',
    source:
      'https://github.com/deirs/ultra-agentic/tree/main/packages/documentation-retrieval-mcp',
    sourceDirectory: 'packages/documentation-retrieval-mcp',
    download: '/downloads/documentation-retrieval-mcp-0.1.0.zip',
    programmingLanguage: 'TypeScript',
    archiveKind: 'mcp',
    invocation: 'DOC_ROOTS=/path/to/docs:/path/to/team-docs node dist/index.js',
    size: 33_200,
    sha256: '290dc787249678d00562bf5965f19a586dfca2a7ffef087d38d4c8e7258a5770'
  },
  {
    artifact: 'repository-operations-mcp',
    route: 'catalog/repository-operations-mcp/index.html',
    title: 'Repository Operations MCP',
    source:
      'https://github.com/deirs/ultra-agentic/tree/main/packages/repository-operations-mcp',
    sourceDirectory: 'packages/repository-operations-mcp',
    download: '/downloads/repository-operations-mcp-0.1.0.zip',
    programmingLanguage: 'TypeScript',
    archiveKind: 'mcp',
    invocation: 'REPO_ROOT=/path/to/repository node dist/index.js',
    size: 36_217,
    sha256: 'eaf5a4f6fd569cb8061e0a9308433f6502a7e32037f827f03226d6b09ae4a30c'
  }
] as const;
const plannedCatalogRoutes = [
  'catalog/database-context-mcp/index.html',
  'catalog/observability-triage-skill/index.html',
  'catalog/tool-failure-dataset/index.html'
] as const;

async function readBuiltPage(route: string): Promise<string> {
  return Bun.file(join(dist, route)).text();
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readZipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEndRecordOffset = Math.max(0, bytes.byteLength - 65_557);
  let endRecordOffset = -1;

  for (let offset = bytes.byteLength - 22; offset >= minimumEndRecordOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endRecordOffset = offset;
      break;
    }
  }

  if (endRecordOffset === -1) throw new Error('ZIP end-of-central-directory record not found');

  const entryCount = view.getUint16(endRecordOffset + 10, true);
  let offset = view.getUint32(endRecordOffset + 16, true);
  const decoder = new TextDecoder();
  const entries: string[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory entry at offset ${offset}`);
    }

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    entries.push(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

function archiveTopDirectory(bytes: Uint8Array): string {
  const topDirectories = new Set(
    readZipEntryNames(bytes)
      .map((entry) => entry.split('/')[0])
      .filter(Boolean)
  );
  expect(topDirectories.size).toBe(1);
  return [...topDirectories][0];
}

function catalogCardHtml(html: string, route: string): string {
  const href = `/${route.replace('index.html', '')}`;
  const linkOffset = html.indexOf(`href="${href}"`);
  const cardStart = html.lastIndexOf('<article', linkOffset);
  const cardEnd = html.indexOf('</article>', linkOffset);

  if (linkOffset === -1 || cardStart === -1 || cardEnd === -1) {
    throw new Error(`Catalog card not found for ${route}`);
  }

  return html.slice(cardStart, cardEnd + '</article>'.length);
}

describe('generated routes', () => {
  test('emits every public page and catalog detail route', () => {
    for (const route of [...pageRoutes, ...catalogRoutes]) {
      expect(existsSync(join(dist, route)), route).toBe(true);
    }
  });

  test('does not emit sitemap or robots files before a site URL is configured', () => {
    expect(existsSync(join(dist, 'sitemap-index.xml'))).toBe(false);
    expect(existsSync(join(dist, 'robots.txt'))).toBe(false);
  });

  test('copies each locally referenced font and the configured social card', async () => {
    for (const font of [
      'sora-latin-wght-normal.woff2',
      'instrument-sans-latin-wght-normal.woff2',
      'ibm-plex-mono-latin-400-normal.woff2'
    ]) {
      const file = Bun.file(join(dist, 'fonts', font));
      expect(await file.exists(), font).toBe(true);
      expect(file.size, font).toBeGreaterThan(1_000);
    }

    const socialCard = new Uint8Array(await Bun.file(join(dist, 'social-card.png')).arrayBuffer());
    expect([...socialCard.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new DataView(socialCard.buffer).getUint32(16)).toBe(1200);
    expect(new DataView(socialCard.buffer).getUint32(20)).toBe(630);
  });

  test('matches the complete local release mapping and copies every ZIP byte-for-byte', async () => {
    expect(releasedCatalogRoutes).toHaveLength(3);
    expect(
      readdirSync(publicDownloads)
        .filter((name) => name.endsWith('.zip'))
        .sort()
    ).toEqual(releasedCatalogRoutes.map((release) => basename(release.download)).sort());

    for (const release of releasedCatalogRoutes) {
      const filename = basename(release.download);
      const publicPath = join(publicDownloads, filename);
      const distPath = join(dist, release.download.slice(1));

      expect(existsSync(publicPath), `public/${release.download}`).toBe(true);
      expect(statSync(publicPath).isFile(), `public/${release.download}`).toBe(true);
      expect(existsSync(distPath), `dist/${release.download}`).toBe(true);

      const publicBytes = new Uint8Array(await Bun.file(publicPath).arrayBuffer());
      const distBytes = new Uint8Array(await Bun.file(distPath).arrayBuffer());
      expect(publicBytes.byteLength, filename).toBe(release.size);
      expect(sha256(publicBytes), filename).toBe(release.sha256);
      expect([...publicBytes.slice(0, 4)], filename).toEqual([80, 75, 3, 4]);
      expect(distBytes.byteLength, filename).toBe(release.size);
      expect(sha256(distBytes), filename).toBe(release.sha256);
      expect(archiveTopDirectory(publicBytes), filename).toBeTruthy();
    }
  });

  test('maps every canonical GitHub source suffix to its local package or skill directory', () => {
    for (const release of releasedCatalogRoutes) {
      const sourceUrl = new URL(release.source);
      const sourcePrefix = '/deirs/ultra-agentic/tree/main/';

      expect(sourceUrl.protocol, release.source).toBe('https:');
      expect(sourceUrl.hostname, release.source).toBe('github.com');
      expect(sourceUrl.pathname.startsWith(sourcePrefix), release.source).toBe(true);

      const sourceSuffix = sourceUrl.pathname.slice(sourcePrefix.length);
      const localDirectory = join(repositoryRoot, ...sourceSuffix.split('/'));
      expect(sourceSuffix, release.source).toBe(release.sourceDirectory);
      expect(existsSync(localDirectory), localDirectory).toBe(true);
      expect(statSync(localDirectory).isDirectory(), localDirectory).toBe(true);
    }
  });

  test('keeps the source social card separator ASCII-only', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', 'public', 'social-card.svg')).text();

    expect(source).toContain('MCP / SKILL / DATASET');
    expect(source).not.toContain('\uFFFD');
  });
});

describe('built metadata', () => {
  test('includes organization JSON-LD on public pages', async () => {
    for (const route of pageRoutes.filter((route) => route !== '404.html')) {
      const html = await readBuiltPage(route);
      expect(html, route).toContain('data-schema="organization"');
      expect(html, route).toContain('"@type":"Organization"');
    }
  });

  test('keeps canonical metadata absent until a production URL exists', async () => {
    const html = await readBuiltPage('index.html');

    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
  });

  test('marks the generated 404 as noindex', async () => {
    const html = await readBuiltPage('404.html');

    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  test('derives the document language from the configured Open Graph locale', async () => {
    const html = await readBuiltPage('index.html');

    expect(html).toContain('<html lang="en-US">');
    expect(html).toContain('<meta property="og:locale" content="en_US">');
  });

  test('places the title near the start of head metadata', async () => {
    const html = await readBuiltPage('index.html');
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));

    expect(head.indexOf('<title>')).toBeGreaterThan(-1);
    expect(head.indexOf('<title>')).toBeLessThan(head.indexOf('<meta name="description"'));
  });

  test('uses descriptive titles on secondary pages', async () => {
    const expectedTitles = {
      'catalog/index.html': 'Agent Tool Catalog — Ultra Agentic',
      'about/index.html': 'About the Agent Infrastructure Catalog — Ultra Agentic',
      'sponsors/index.html': 'Sponsor Open Agent Infrastructure — Ultra Agentic',
      'get-started/index.html': 'Evaluate and Compose Agent Tools — Ultra Agentic'
    } as const;

    for (const [route, title] of Object.entries(expectedTitles)) {
      expect(await readBuiltPage(route), route).toContain(`<title>${title}</title>`);
    }
  });

  test('keeps absolute social image metadata absent until a production URL exists', async () => {
    const html = await readBuiltPage('index.html');

    expect(html).not.toContain('property="og:image"');
    expect(html).not.toContain('name="twitter:image"');
  });
});

describe('built accessibility semantics', () => {
  test('connects catalog controls to announced results and a named empty state', async () => {
    const html = await readBuiltPage('catalog/index.html');

    expect(html).toContain('aria-controls="catalog-results"');
    expect(html).toContain('data-results-count role="status" aria-atomic="true"');
    expect(html).toContain(
      'data-no-results role="region" aria-labelledby="no-results-heading"'
    );
    expect(html).toContain('id="no-results-heading"');
  });

  test('provides one internal catalog detail link per card', async () => {
    const html = await readBuiltPage('catalog/index.html');

    for (const route of catalogRoutes) {
      const href = `/${route.replace('index.html', '')}`;
      expect(html.split(`href="${href}"`)).toHaveLength(2);
    }
  });

  test('shows one direct download action for each released card and none for planned cards', async () => {
    const html = await readBuiltPage('catalog/index.html');

    for (const release of releasedCatalogRoutes) {
      const card = catalogCardHtml(html, release.route);
      expect(card, release.route).toContain(`Available v${releaseVersion}`);
      expect(card.split('>Download ZIP<'), release.route).toHaveLength(2);
      expect(card, release.route).toContain(`href="${release.download}" download`);
      expect(card, release.route).toContain(`href="${release.source}"`);
    }

    for (const route of plannedCatalogRoutes) {
      const card = catalogCardHtml(html, route);
      expect(card, route).not.toContain('Available v');
      expect(card, route).not.toContain('Download ZIP');
    }
  });

  test('renders collection-derived beta and planned counts on every summary page', async () => {
    const catalogHtml = await readBuiltPage('catalog/index.html');
    const betaCount = catalogHtml.match(/data-catalog-item[^>]+data-maturity="beta"/g)?.length ?? 0;
    const plannedCount =
      catalogHtml.match(/data-catalog-item[^>]+data-maturity="planned"/g)?.length ?? 0;

    expect(betaCount).toBeGreaterThan(0);
    expect(plannedCount).toBeGreaterThan(0);

    for (const route of [
      'index.html',
      'catalog/index.html',
      'get-started/index.html',
      'about/index.html'
    ]) {
      const html = await readBuiltPage(route);
      const summaryOffset = html.indexOf('data-catalog-summary-counts');
      const summaryEnd = html.indexOf('</p>', summaryOffset);
      const summary = html.slice(summaryOffset, summaryEnd);

      expect(summaryOffset, route).toBeGreaterThan(-1);
      expect(summary, route).toContain(`data-beta-count="${betaCount}"`);
      expect(summary, route).toContain(`data-planned-count="${plannedCount}"`);
      expect(summary, route).toContain(`${betaCount} beta`);
      expect(summary, route).toContain(`${plannedCount} planned`);
    }
  });
});

describe('truthful catalog detail states', () => {
  test('describes exactly three released beta entries as downloadable source code', async () => {
    expect(releasedCatalogRoutes).toHaveLength(3);

    for (const release of releasedCatalogRoutes) {
      const html = await readBuiltPage(release.route);
      expect(html, release.route).toContain('data-schema="catalog-entry"');
      expect(html, release.route).toContain('"@type":"SoftwareSourceCode"');
      expect(html, release.route).toContain(`"name":"${release.title}"`);
      expect(html, release.route).toContain(`"codeRepository":"${release.source}"`);
      expect(html, release.route).toContain(`"softwareVersion":"${releaseVersion}"`);
      expect(html, release.route).toContain(`"downloadUrl":"${release.download}"`);
      expect(html, release.route).toContain('"isAccessibleForFree":true');
      expect(html, release.route).toContain(
        `"programmingLanguage":"${release.programmingLanguage}"`
      );
      expect(html, release.route).toContain('"creativeWorkStatus":"Beta"');
      expect(html, release.route).toContain('<meta property="og:type" content="article">');
      expect(html, release.route).toContain(`href="${release.download}" download`);
      expect(html, release.route).toContain(`href="${release.source}"`);
      expect(html, release.route).toContain('Download v0.1.0');
      expect(html, release.route).toContain('Quick start');
      expect(html, release.route).toContain('interfaces may change');
      expect(html, release.route).not.toContain('No source artifact published');

      const archiveBytes = new Uint8Array(
        await Bun.file(join(publicDownloads, basename(release.download))).arrayBuffer()
      );
      const topDirectory = archiveTopDirectory(archiveBytes);
      expect(release.download, release.route).toBe(
        `/downloads/${release.artifact}-${releaseVersion}.zip`
      );
      expect(html, release.route).toContain('After extracting');

      if (release.archiveKind === 'mcp') {
        expect(html, release.route).toContain(`cd ${topDirectory}`);
        expect(html, release.route).toContain('npm install --omit=dev');
        expect(html, release.route).toContain(release.invocation);
        expect(html, release.route).toContain('Windows users');
        expect(html, release.route).toContain('README');
      } else {
        expect(html, release.route).toContain(`unzip ${basename(release.download)}`);
        expect(html, release.route).toContain('mkdir -p .cursor/skills');
        expect(html, release.route).toContain(
          `cp -R ${topDirectory} .cursor/skills/deployment-readiness`
        );
      }
    }
  });

  test('keeps exactly three planned entries free of source and release claims', async () => {
    expect(plannedCatalogRoutes).toHaveLength(3);

    for (const route of plannedCatalogRoutes) {
      const html = await readBuiltPage(route);
      expect(html, route).toContain('data-schema="catalog-entry"');
      expect(html, route).toContain('"@type":"TechArticle"');
      expect(html, route).toContain('"creativeWorkStatus":"Planned"');
      expect(html, route).toContain('<meta property="og:type" content="article">');
      expect(html, route).toContain('No source artifact published');
      expect(html, route).not.toContain('"codeRepository"');
      expect(html, route).not.toContain('"downloadUrl"');
      expect(html, route).not.toContain('"softwareVersion"');
      expect(html, route).not.toContain('Download ZIP');
      expect(html, route).not.toContain('Quick start');
    }
  });

  test('leads released detail descriptions with a declared capability', async () => {
    const html = await readBuiltPage('catalog/repository-operations-mcp/index.html');

    expect(html).toContain('<meta name="description" content="Inspect repository');
    expect(html).toContain('A beta MCP server');
  });
});
