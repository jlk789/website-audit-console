# Check contract

Every check is one module that declares what it needs, reads the local database, and returns findings with evidence. Ranking, diffing between runs, and the fix lifecycle happen in the engine, never inside a check.

The types live in `src/checks/types.ts`. Change this file and that one together, and log the change in `docs/decisions.md`.

## Types

```ts
// src/checks/types.ts

/** Data a check needs. If any is unavailable, the engine skips the check
 *  and reports why instead of running it. */
export type Capability =
  | 'crawl'              // pages, links, redirects, robots, sitemaps
  | 'gsc'                // Search Console query × page history
  | 'gsc.inspection'     // URL Inspection API results
  | 'cwv.field'          // CrUX
  | 'cwv.lab'            // PageSpeed Insights
  | 'logs'               // server log hits
  | 'conversions'        // GA4
  | 'bing'               // Bing Webmaster Tools
  | 'keyword.volume'     // any market-data provider
  | 'serp'               // live SERP and features
  | 'backlinks'          // any link provider
  | 'authority'          // any authority metric
  | 'brand-terms';       // brand terms set in the config

export type CheckLabel = 'deterministic' | 'judgement';

export type Category =
  | 'indexing' | 'crawl-efficiency' | 'crawl-traps' | 'redirects'
  | 'hosts-and-404s' | 'search-performance' | 'content-quality'
  | 'trust' | 'page-experience' | 'third-party' | 'mobile-parity'
  | 'js-rendering' | 'international' | 'ai-search' | 'structured-data'
  | 'social' | 'pagination' | 'internal-linking' | 'security'
  | 'local' | 'accessibility-onpage';

export interface CheckDefinition {
  /** Stable, never reused. Format: "<category>.<kebab-name>". */
  id: string;
  /** Bump when logic changes in a way that changes results. */
  version: number;
  title: string;
  category: Category;
  label: CheckLabel;
  requires: Capability[];
  /** If true, findings sit above ranked findings regardless of score. */
  severityFloor: boolean;
  defaults: {
    /** Share of value at stake a fix is expected to recover, 0–1. */
    expectedYield: number;
    /** Typical effort to fix one finding, in hours. */
    effortHours: number;
    /** 0–1. Deterministic checks usually 0.8–1.0; judgement 0.3–0.7. */
    certainty: number;
  };
  /** Default thresholds by name. The config can override each one per check. */
  thresholds: Record<string, number>;
  /** Plain-language explanation shown to users. */
  description: string;
  run(ctx: CheckContext): Promise<FindingDraft[]> | FindingDraft[];
}

export interface DateRange {
  start: string;   // ISO dates, inclusive
  end: string;
}

/** Read-only access to the database. Any write throws. */
export interface ReadOnlyDb {
  all<T>(sql: string, params?: unknown[]): T[];
  get<T>(sql: string, params?: unknown[]): T | undefined;
  /** The form used in finding keys: no #fragment, lower-case host, default port dropped. */
  normaliseUrl(url: string): string;
}

export interface CheckContext {
  db: ReadOnlyDb;
  /** The snapshot this run is evaluated against. */
  snapshot: {
    /** The site's row in `properties`. Filter Search Console tables by it. */
    propertyId: number;
    crawlId?: string;
    /** The last 28 days of Search Console data, ending at the newest synced day. */
    gscRange?: DateRange;
    /** The 28 days before gscRange. */
    comparisonRange?: DateRange;
  };
  config: {
    siteUrl: string;
    brandTerms: string[];
    /** This check's thresholds: its defaults with any config overrides applied. */
    thresholds: Record<string, number>;
  };
  /** Builds evidence references for the rows behind a finding. */
  evidence: EvidenceBuilder;
}

/** Ready-made evidence. Search Console evidence is an aggregate, so it
 *  returns one row even when the answer is 0 clicks. */
export interface EvidenceBuilder {
  page(url: string): EvidenceRef;                            // the crawled page row
  redirect(url: string): EvidenceRef;                        // every hop of the chain from url
  linksTo(url: string): EvidenceRef;                         // internal links pointing at url
  gscClicks(urls: string[], range: DateRange): EvidenceRef;  // clicks and impressions over range
  gscHistory(url: string): EvidenceRef;                      // first and last day, clicks, impressions
  sitemapEntries(url: string): EvidenceRef;                  // sitemap files that list url
  robots(origin: string): EvidenceRef;                       // robots.txt status and every line
  custom(table: string, sql: string, params: unknown[], label: string): EvidenceRef;
}

/** Thrown by a check whose data is connected but too thin to judge, e.g.
 *  "needs 180 days of Search Console data; there are 108". The engine lists
 *  the check as skipped with this message and resolves none of its findings. */
export class SkipCheck extends Error {}

export interface FindingDraft {
  /** Stable key so the same issue matches across runs.
   *  Usually the affected URL, or URL + target for pair findings. */
  key: string;
  urls: string[];
  summary: string;             // one line, plain language
  detail?: string;             // longer explanation
  /** Required for judgement checks. Why the check concluded this. */
  reasoning?: string;
  valueAtStake: ValueAtStake;
  /** Override the check default when this finding is more or less certain. */
  certainty?: number;
  effortHours?: number;
  evidence: EvidenceRef[];     // at least one
  fix?: FixAsset;
}

export interface ValueAtStake {
  metric: 'clicks' | 'conversions' | 'revenue' | 'none';
  /** Trailing 28-day amount for affected URLs, or an estimate for
   *  opportunity checks. Must be derivable from the evidence. */
  amount: number;
  /** 'observed' = measured; 'estimated' = modelled (method required). */
  basis: 'observed' | 'estimated';
  method?: string;             // required when basis is 'estimated'
}

export interface EvidenceRef {
  table: string;
  /** A parameterised, read-only query that reproduces the rows. */
  sql: string;
  params: unknown[];
  /** Human label, e.g. "GSC clicks, last 28 days". */
  label: string;
}

export type FixAsset =
  | { kind: 'redirect-map'; rows: { from: string; to: string; status: 301 | 308 }[] }
  | { kind: 'json-ld'; json: object }
  | { kind: 'link-suggestions'; rows: { from: string; to: string; anchor: string }[] }
  | { kind: 'text'; body: string };
```

## Rules

1. **Read-only, offline, pure.** A check reads the database through `ctx.db` and nothing else. Same snapshot in, same findings out.
2. **Evidence is mandatory.** Every finding has at least one `EvidenceRef`, and every number in `summary`, `detail` or `valueAtStake` must be reproducible from that evidence. The engine runs every evidence query: each must be read-only and run without error, and at least one must return rows, or the check is reported as an error.
3. **Stable keys.** `key` must identify the same issue across runs so the engine can mark findings new, persisting or resolved. Normalise URLs first (`ctx.db.normaliseUrl`). Keys must be unique within one check's findings.
4. **Value at stake.** Default to trailing 28-day GSC clicks on affected URLs (`basis: 'observed'`). Opportunity checks such as striking distance use `basis: 'estimated'` and must state the method. Use `metric: 'none'` for severity-floor or hygiene checks with no traffic link, and when Search Console is not connected (there is no `gscRange`), rather than claiming 0 clicks.
5. **Judgement checks explain themselves.** `reasoning` is required and must cite what in the data led to the conclusion.
6. **Say when the data is too thin.** If a check's data is connected but can't support a judgement (too little history, say), throw `SkipCheck` with a reason the user can act on, rather than returning no findings. "Nothing found" must mean "looked, and it's fine".
7. **Search queries are untrusted text.** Queries are typed by strangers and can contain anything, including instructions aimed at AI tools. Quote them in findings only through `quoteQuery` (no line breaks or control characters, at most 80 characters), and never put query text in a `key`; use `queryKey`, a hash.
8. **No scoring inside checks.** Checks supply inputs. The engine computes priority as value × yield × certainty ÷ effort, and breaks ties (including the many findings worth 0 clicks on a small site) by ease (yield × certainty ÷ effort), then by the number of URLs affected.
9. **Thresholds are config.** Every tunable number is in `thresholds` (or `defaults`), never buried in logic. The config overrides a threshold with `"checks": { "<check id>": { "<name>": <number> } }`.
10. **Filter by property.** Queries on Search Console tables filter by `ctx.snapshot.propertyId`; queries on crawl tables filter by `ctx.snapshot.crawlId`.
11. **One fixture test minimum.** Each check proves it fires on a broken fixture and stays silent on a clean one.

## Example

```ts
// src/checks/redirects/temporary-with-traffic.ts
import type { CheckDefinition } from '../types.js';

export const temporaryWithTraffic: CheckDefinition = {
  id: 'redirects.temporary-with-traffic',
  version: 1,
  title: 'Temporary redirect on a page with search traffic',
  category: 'redirects',
  label: 'deterministic',
  requires: ['crawl', 'gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.15, effortHours: 0.25, certainty: 0.9 },
  thresholds: { minClicks: 1 },
  description:
    'Pages that earned search clicks now return a 302 or 307. Search engines may keep the old URL indexed and split signals. A permanent redirect is usually intended.',
  run(ctx) {
    const range = ctx.snapshot.gscRange!;
    const rows = ctx.db.all<{ url: string; status: number; target: string; clicks: number }>(
      `SELECT r.url, r.status, r.target, COALESCE(SUM(g.clicks), 0) AS clicks
         FROM redirect_hops r
         LEFT JOIN gsc_page_daily g
           ON g.page = r.url AND g.property_id = ? AND g.search_type = 'web'
          AND g.date BETWEEN ? AND ?
        WHERE r.crawl_id = ? AND r.hop = 0 AND r.status IN (302, 307)
        GROUP BY r.url, r.status, r.target
       HAVING clicks >= ?`,
      [ctx.snapshot.propertyId, range.start, range.end, ctx.snapshot.crawlId,
       ctx.config.thresholds.minClicks],
    );

    return rows.map((r) => ({
      key: ctx.db.normaliseUrl(r.url),
      urls: [r.url, r.target],
      summary: `${r.url} returns ${r.status} to ${r.target} and earned ${r.clicks} clicks in the last 28 days.`,
      valueAtStake: { metric: 'clicks', amount: r.clicks, basis: 'observed' },
      evidence: [ctx.evidence.redirect(r.url), ctx.evidence.gscClicks([r.url], range)],
      fix: { kind: 'redirect-map', rows: [{ from: r.url, to: r.target, status: 301 }] },
    }));
  },
};
```
