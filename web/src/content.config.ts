import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import {
  catalogMaturities,
  catalogTypes,
  getCatalogPublicationIssue,
  isCatalogArtifactName,
  isSafeReleaseDownload,
  isStrictSemver
} from './lib/catalog';
import { blogCategories } from './lib/blog';

const releaseSchema = z
  .object({
    artifact: z
      .string()
      .trim()
      .refine(isCatalogArtifactName, 'Release artifacts must use lowercase kebab-case'),
    version: z
      .string()
      .refine(isStrictSemver, 'Release versions must use strict semantic versioning'),
    download: z.string(),
    quickStart: z
      .array(
        z.object({
          label: z.string().trim().min(1),
          command: z.string().trim().min(1)
        })
      )
      .min(1)
  })
  .superRefine((release, context) => {
    if (!isSafeReleaseDownload(release.download, release.artifact, release.version)) {
      context.addIssue({
        code: 'custom',
        message:
          'Release downloads must exactly match /downloads/${artifact}-${version}.zip',
        path: ['download']
      });
    }
  });

const catalog = defineCollection({
  loader: glob({ base: './src/content/catalog', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string().min(1),
      type: z.enum(catalogTypes),
      summary: z.string().min(1),
      capabilities: z.array(z.string().min(1)).min(1),
      compatibility: z.array(z.string().min(1)).min(1),
      maturity: z.enum(catalogMaturities),
      tags: z.array(z.string().min(1)).min(1),
      source: z.url().regex(/^https:\/\//, 'Source URLs must use HTTPS').optional(),
      release: releaseSchema.optional(),
      featured: z.boolean()
    })
    .superRefine((entry, context) => {
      const publicationIssue = getCatalogPublicationIssue(entry);
      if (publicationIssue) {
        context.addIssue({
          code: 'custom',
          message: publicationIssue,
          path: entry.maturity === 'planned' ? ['maturity'] : ['release']
        });
      }
    })
});

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().min(1).default('Ultra Agentic'),
    category: z.enum(blogCategories),
    tags: z.array(z.string().min(1)).min(1),
    draft: z.boolean().default(false)
  })
});

export const collections = { catalog, blog };
