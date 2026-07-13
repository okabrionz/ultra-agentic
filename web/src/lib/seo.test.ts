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
        title: 'Repository Operations MCP',
        summary: 'A planned MCP server specification.',
        type: 'mcp',
        maturity: 'planned',
        tags: ['automation', 'git']
      },
      siteConfig
    );

    expect(structuredData).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'Repository Operations MCP',
      description: 'A planned MCP server specification.',
      genre: 'MCP',
      creativeWorkStatus: 'Planned',
      keywords: ['automation', 'git']
    });
    expect(structuredData).not.toHaveProperty('codeRepository');
    expect(structuredData).not.toHaveProperty('url');
  });

  test('includes only source and page URLs that are actually configured', () => {
    const configuredSite = {
      ...siteConfig,
      siteUrl: 'https://ultra-agentic.example'
    } as const;

    expect(
      buildCatalogEntryStructuredData(
        {
          title: 'Deployment Skill',
          summary: 'A beta deployment workflow.',
          type: 'skill',
          maturity: 'beta',
          tags: ['deployment'],
          source: 'https://github.com/deirs/ultra-agentic/tree/main/deployment'
        },
        configuredSite,
        '/catalog/deployment-skill/'
      )
    ).toMatchObject({
      url: 'https://ultra-agentic.example/catalog/deployment-skill/',
      sameAs: 'https://github.com/deirs/ultra-agentic/tree/main/deployment'
    });
  });
});

describe('serializeStructuredData', () => {
  test('escapes markup-significant characters inside JSON-LD scripts', () => {
    expect(serializeStructuredData({ description: '</script><script>alert(1)</script>' })).toBe(
      '{"description":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}'
    );
  });
});
