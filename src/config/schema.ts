import { z } from 'zod';

/**
 * Search Console connection, written by `connect google`. Leave
 * credentialsFile or property empty to switch Search Console off.
 */
export const gscConfigSchema = z.object({
  auth: z.enum(['oauth', 'service-account']),
  /** Relative to the home folder, e.g. "secrets/google-oauth-client.json". */
  credentialsFile: z.string(),
  /** e.g. "sc-domain:example.com" or "https://www.example.com/". */
  property: z.string(),
});

export type GscConfig = z.infer<typeof gscConfigSchema>;

/** Config file, version 1. */
export const configSchema = z.object({
  version: z.literal(1),
  site: z.object({
    url: z.url({ protocol: /^https?$/ }),
    brandTerms: z.array(z.string().min(1)).default([]),
  }),
  crawl: z
    .object({
      maxPages: z.int().positive().default(10_000),
      /** Requests in flight at once. Kept low to be gentle on the site. */
      concurrency: z.int().min(1).max(16).default(2),
    })
    .prefault({}),
  gsc: gscConfigSchema.optional(),
  /** Threshold overrides per check, e.g. { "redirects.chain": { "minHops": 3 } }. */
  checks: z.record(z.string(), z.record(z.string(), z.number())).default({}),
});

export type Config = z.infer<typeof configSchema>;
