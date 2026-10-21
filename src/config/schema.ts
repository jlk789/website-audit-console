import { z } from 'zod';

/**
 * Config file, version 1. Search Console settings arrive in M2,
 * once the Google sign-in approach is decided.
 */
export const configSchema = z.object({
  version: z.literal(1),
  site: z.object({
    url: z.url({ protocol: /^https?$/ }),
    brandTerms: z.array(z.string().min(1)).default([]),
  }),
  crawl: z
    .object({
      maxPages: z.int().positive().default(10_000),
    })
    .prefault({}),
});

export type Config = z.infer<typeof configSchema>;
