import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { catalogMaturities, catalogTypes } from './lib/catalog';

const catalog = defineCollection({
  loader: glob({ base: './src/content/catalog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string().min(1),
    type: z.enum(catalogTypes),
    summary: z.string().min(1),
    capabilities: z.array(z.string().min(1)).min(1),
    compatibility: z.array(z.string().min(1)).min(1),
    maturity: z.enum(catalogMaturities),
    tags: z.array(z.string().min(1)).min(1),
    source: z.url().regex(/^https:\/\//, 'Source URLs must use HTTPS').optional(),
    featured: z.boolean()
  })
});

export const collections = { catalog };
