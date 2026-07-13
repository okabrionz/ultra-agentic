import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dir, '..', 'dist');
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

async function readBuiltPage(route: string): Promise<string> {
  return Bun.file(join(dist, route)).text();
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
});

describe('truthful catalog detail states', () => {
  test('describes each planned entry without claiming a source artifact', async () => {
    for (const route of catalogRoutes) {
      const html = await readBuiltPage(route);
      expect(html, route).toContain('data-schema="catalog-entry"');
      expect(html, route).toContain('"@type":"TechArticle"');
      expect(html, route).toContain('"creativeWorkStatus":"Planned"');
      expect(html, route).toContain('<meta property="og:type" content="article">');
      expect(html, route).toContain('No source artifact published');
      expect(html, route).not.toContain('"codeRepository"');
    }
  });

  test('leads detail descriptions with a capability while retaining planned status', async () => {
    const html = await readBuiltPage('catalog/repository-operations-mcp/index.html');

    expect(html).toContain(
      '<meta name="description" content="Inspect repository structure and working-tree state. A planned MCP server for scoped repository inspection and routine change workflows.">'
    );
  });
});
