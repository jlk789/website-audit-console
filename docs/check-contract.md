# Check contract

Every check is one module that declares what it needs, reads the local database, and returns findings with evidence. Ranking, diffing between runs, and the fix lifecycle happen in the engine, never inside a check.

## Types

```ts
// src/checks/types.ts

/** Data a check needs. If any is unavailable, the engine skips the check
 *  and reports it as "needs a provider" instead of running it. */
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
  | 'authority';         // any authority metric

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
  /** Plain-language explanation shown to users. */
  description: string;
  run(ctx: CheckContext): Promise<FindingDraft[]> | FindingDraft[];
}

export interface CheckContext {
  /** Read-only query helper. Writes throw. */
  db: ReadOnlyDb;
  /** The snapshot this run is evaluated against. */
  snapshot: {
    crawlId?: string;
    gscRange?: { start: string; end: string };     // ISO dates
    comparisonRange?: { start: string; end: string };
  };
  config: {
    siteUrl: string;
    brandTerms: string[];
    thresholds: Record<string, number>;   // overridable per check id
  };
  /** Builds an evidence reference for the rows behind a finding. */
  evidence: EvidenceBuilder;
}

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
2. **Evidence is mandatory.** Every finding has at least one `EvidenceRef`, and every number in `summary`, `detail` or `valueAtStake` must be reproducible from that evidence.
3. **Stable keys.** `key` must identify the same issue across runs so the engine can mark findings new, persisting or resolved. Normalise URLs first (`ctx.db.normaliseUrl`).
4. **Value at stake.** Default to trailing 28-day GSC clicks on affected URLs (`basis: 'observed'`). Opportunity checks such as striking distance use `basis: 'estimated'` and must state the method. Use `metric: 'none'` only for severity-floor or hygiene checks with no traffic link.
5. **Judgement checks explain themselves.** `reasoning` is required and must cite what in the data led to the conclusion.
6. **No scoring inside checks.** Checks supply inputs. The engine computes priority as value × yield × certainty ÷ effort.
7. **Thresholds are config.** Hard-coded numbers go in `defaults` or `thresholds`, never buried in logic.
8. **One fixture test minimum.** Each check proves it fires on a broken fixture and stays silent on a clean one.

## Example

```ts
// src/checks/redirects/temporary-redirect-with-traffic.ts
import type { CheckDefinition } from '../types';

export const temporaryRedirectWithTraffic: CheckDefinition = {
  id: 'redirects.temporary-with-traffic',
  version: 1,
  title: 'Temporary redirect on a page with search traffic',
  category: 'redirects',
  label: 'deterministic',
  requires: ['crawl', 'gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.15, effortHours: 0.25, certainty: 0.9 },
  description:
    'Pages that earned search clicks now return a 302 or 307. Search engines may keep the old URL indexed and split signals. A permanent redirect is usually intended.',
  run(ctx) {
    const rows = ctx.db.all<{ url: string; status: number; target: string; clicks: number }>(
      `SELECT r.url, r.status, r.target, COALESCE(SUM(g.clicks), 0) AS clicks
         FROM redirect_hops r
         LEFT JOIN gsc_page_daily g
           ON g.page = r.url AND g.date BETWEEN ? AND ?
        WHERE r.crawl_id = ? AND r.hop = 0 AND r.status IN (302, 307)
        GROUP BY r.url, r.status, r.target
       HAVING clicks > ?`,
      [ctx.snapshot.gscRange!.start, ctx.snapshot.gscRange!.end,
       ctx.snapshot.crawlId, ctx.config.thresholds.minClicks ?? 0],
    );

    return rows.map((r) => ({
      key: ctx.db.normaliseUrl(r.url),
      urls: [r.url, r.target],
      summary: `${r.url} returns ${r.status} to ${r.target} and earned ${r.clicks} clicks in the last 28 days.`,
      valueAtStake: { metric: 'clicks', amount: r.clicks, basis: 'observed' },
      evidence: [
        ctx.evidence.redirect(r.url),
        ctx.evidence.gscPageClicks(r.url, ctx.snapshot.gscRange!),
      ],
      fix: { kind: 'redirect-map', rows: [{ from: r.url, to: r.target, status: 301 }] },
    }));
  },
};
```
