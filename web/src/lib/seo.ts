import type { SiteConfig } from '../config/site';
import {
  catalogMaturityLabels,
  catalogTypeLabels,
  type CatalogMaturity,
  type CatalogRelease,
  type CatalogType
} from './catalog';

type CatalogEntrySeoData = {
  title: string;
  summary: string;
  type: CatalogType;
  maturity: CatalogMaturity;
  tags: readonly string[];
  source?: string;
  release?: CatalogRelease;
};

const catalogProgrammingLanguages: Record<CatalogType, string> = {
  mcp: 'TypeScript',
  skill: 'Markdown',
  dataset: 'JSON'
};

type PageMetadataOptions = {
  title?: string;
  pathname: string;
  canonical?: string | URL;
  image: string;
};

export function buildPageMetadata(config: SiteConfig, options: PageMetadataOptions) {
  const pageTitle = options.title
    ? config.metadata.titleTemplate.replace('%s', options.title)
    : config.metadata.defaultTitle;
  const siteBase = config.siteUrl ? new URL(config.siteUrl) : undefined;
  const canonicalUrl =
    options.canonical instanceof URL
      ? options.canonical
      : options.canonical?.startsWith('http')
        ? new URL(options.canonical)
        : siteBase
          ? new URL(options.canonical ?? options.pathname, siteBase)
          : undefined;
  const socialImageUrl = options.image.startsWith('http')
    ? new URL(options.image)
    : siteBase
      ? new URL(options.image, siteBase)
      : undefined;

  return {
    pageTitle,
    languageTag: config.metadata.locale.replace('_', '-'),
    canonicalUrl,
    socialImageUrl
  };
}

export function buildOrganizationStructuredData(config: SiteConfig) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: config.brand.name,
    description: config.metadata.description,
    ...(config.siteUrl ? { url: config.siteUrl } : {}),
    sameAs: [config.links.repository]
  };
}

export function buildCatalogEntryStructuredData(
  entry: CatalogEntrySeoData,
  config: SiteConfig,
  pathname?: string
) {
  const pageUrl =
    config.siteUrl && pathname ? new URL(pathname, config.siteUrl).toString() : undefined;

  if (entry.maturity !== 'planned' && entry.source && entry.release) {
    const downloadUrl = config.siteUrl
      ? new URL(entry.release.download, config.siteUrl).toString()
      : entry.release.download;

    return {
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: entry.title,
      description: entry.summary,
      codeRepository: entry.source,
      softwareVersion: entry.release.version,
      downloadUrl,
      isAccessibleForFree: true,
      programmingLanguage: catalogProgrammingLanguages[entry.type],
      creativeWorkStatus: catalogMaturityLabels[entry.maturity],
      keywords: [...entry.tags],
      ...(pageUrl ? { url: pageUrl } : {})
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: entry.title,
    description: entry.summary,
    genre: catalogTypeLabels[entry.type],
    creativeWorkStatus: catalogMaturityLabels[entry.maturity],
    keywords: [...entry.tags],
    ...(pageUrl ? { url: pageUrl } : {})
  };
}

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
