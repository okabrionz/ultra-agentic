import { describe, expect, test } from 'bun:test';

import { siteConfig } from '../config/site';
import {
  buildCatalogEntryStructuredData,
  buildOrganizationStructuredData,
	buildPageMetadata,
  serializeStructuredData
} from './seo';

describe('buildOrganizationStructuredData', () => {
  test('describes the organization without inventing an unconfigured site URL', () => {
    expect(buildOrganizationStructuredData(siteConfig)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Ultra Agentic',
      description: siteConfig.metadata.description,
      sameAs: ['https://github.com/deirs/ultra-agentic']
    });
  });
});

describe('buildPageMetadata', () => {
	test('omits canonical and social image URLs until a site URL is configured', () => {
		expect(
			buildPageMetadata(siteConfig, {
				title: 'Catalog',
				pathname: '/catalog/',
				image: siteConfig.metadata.socialImage.src
			})
		).toEqual({
			pageTitle: 'Catalog — Ultra Agentic',
			languageTag: 'en-US',
			canonicalUrl: undefined,
			socialImageUrl: undefined
		});
	});

	test('resolves canonical and social image URLs from a configured production origin', () => {
		const configuredSite = {
			...siteConfig,
			siteUrl: 'https://ultra-agentic.example'
		} as const;

		expect(
			buildPageMetadata(configuredSite, {
				pathname: '/catalog/',
				canonical: '/catalog/?type=mcp',
				image: '/social-card.png'
			})
		).toEqual({
			pageTitle: siteConfig.metadata.defaultTitle,
			languageTag: 'en-US',
			canonicalUrl: new URL('https://ultra-agentic.example/catalog/?type=mcp'),
			socialImageUrl: new URL('https://ultra-agentic.example/social-card.png')
		});
	});
});

describe('buildCatalogEntryStructuredData', () => {
  test('marks a source-free planned entry as a specification rather than software', () => {
    const structuredData = buildCatalogEntryStructuredData(
      {
        title: 'Database Context MCP',
        summary: 'A planned database MCP server specification.',
        type: 'mcp',
        maturity: 'planned',
        tags: ['databases', 'sql']
      },
      siteConfig
    );

    expect(structuredData).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'Database Context MCP',
      description: 'A planned database MCP server specification.',
      genre: 'MCP',
      creativeWorkStatus: 'Planned',
      keywords: ['databases', 'sql']
    });
    expect(structuredData).not.toHaveProperty('codeRepository');
    expect(structuredData).not.toHaveProperty('downloadUrl');
    expect(structuredData).not.toHaveProperty('softwareVersion');
    expect(structuredData).not.toHaveProperty('url');
  });

  test('describes a released skill as free source code with configured absolute URLs', () => {
    const configuredSite = {
      ...siteConfig,
      siteUrl: 'https://ultra-agentic.example'
    } as const;

    expect(
      buildCatalogEntryStructuredData(
        {
          title: 'Deployment Readiness Skill',
          summary: 'A beta deployment-readiness workflow.',
          type: 'skill',
          maturity: 'beta',
          tags: ['deployment'],
          source: 'https://github.com/deirs/ultra-agentic/tree/main/skills/deployment-readiness',
          release: {
            artifact: 'deployment-readiness-skill',
            version: '0.1.0',
            download: '/downloads/deployment-readiness-skill-0.1.0.zip',
            quickStart: [
              {
                label: 'Copy the extracted skill',
                command: 'cp -R deployment-readiness .cursor/skills/'
              }
            ]
          }
        },
        configuredSite,
        '/catalog/deployment-readiness-skill/'
      )
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: 'Deployment Readiness Skill',
      description: 'A beta deployment-readiness workflow.',
      codeRepository:
        'https://github.com/deirs/ultra-agentic/tree/main/skills/deployment-readiness',
      softwareVersion: '0.1.0',
      downloadUrl:
        'https://ultra-agentic.example/downloads/deployment-readiness-skill-0.1.0.zip',
      isAccessibleForFree: true,
      programmingLanguage: 'Markdown',
      creativeWorkStatus: 'Beta',
      keywords: ['deployment'],
      url: 'https://ultra-agentic.example/catalog/deployment-readiness-skill/'
    });
  });

  test('keeps a released MCP download site-relative until a production origin is configured', () => {
    const structuredData = buildCatalogEntryStructuredData(
      {
        title: 'Repository Operations MCP',
        summary: 'A beta repository MCP server.',
        type: 'mcp',
        maturity: 'beta',
        tags: ['repositories'],
        source:
          'https://github.com/deirs/ultra-agentic/tree/main/packages/repository-operations-mcp',
        release: {
          artifact: 'repository-operations-mcp',
          version: '0.1.0',
          download: '/downloads/repository-operations-mcp-0.1.0.zip',
          quickStart: [
            { label: 'Install dependencies', command: 'npm install --omit=dev' }
          ]
        }
      },
      siteConfig,
      '/catalog/repository-operations-mcp/'
    );

    expect(structuredData).toMatchObject({
      '@type': 'SoftwareSourceCode',
      programmingLanguage: 'TypeScript',
      downloadUrl: '/downloads/repository-operations-mcp-0.1.0.zip'
    });
    expect(structuredData).not.toHaveProperty('url');
  });
});

describe('serializeStructuredData', () => {
  test('escapes markup-significant characters inside JSON-LD scripts', () => {
    expect(serializeStructuredData({ description: '</script><script>alert(1)</script>' })).toBe(
      '{"description":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}'
    );
  });
});
