/**
 * The check contract. docs/check-contract.md explains each part; change
 * both together, and log the change in docs/decisions.md.
 */

/** Data a check needs. If any is unavailable, the engine skips the check
 *  and reports why instead of running it. */
export type Capability =
  | 'crawl' // pages, links, redirects, robots, sitemaps
  | 'gsc' // Search Console query × page history
  | 'gsc.inspection' // URL Inspection API results
  | 'cwv.field' // CrUX
  | 'cwv.lab' // PageSpeed Insights
  | 'logs' // server log hits
  | 'conversions' // GA4
  | 'bing' // Bing Webmaster Tools
  | 'keyword.volume' // any market-data provider
  | 'serp' // live SERP and features
  | 'backlinks' // any link provider
  | 'authority' // any authority metric
  | 'brand-terms'; // brand terms set in the config

export type CheckLabel = 'deterministic' | 'judgement';

export type Category =
  | 'indexing'
  | 'crawl-efficiency'
  | 'crawl-traps'
  | 'redirects'
  | 'hosts-and-404s'
  | 'search-performance'
  | 'content-quality'
  | 'trust'
  | 'page-experience'
  | 'third-party'
  | 'mobile-parity'
  | 'js-rendering'
  | 'international'
  | 'ai-search'
  | 'structured-data'
  | 'social'
  | 'pagination'
  | 'internal-linking'
  | 'security'
  | 'local'
  | 'accessibility-onpage';

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
  /** ISO dates, inclusive. */
  start: string;
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

/**
 * Ready-made evidence. Each returns a read-only query that reproduces the
 * rows behind a finding. Search Console evidence is an aggregate, so it
 * returns one row even when the answer is 0 clicks.
 */
export interface EvidenceBuilder {
  /** The crawled page row. */
  page(url: string): EvidenceRef;
  /** Every hop of the redirect chain starting at `url`. */
  redirect(url: string): EvidenceRef;
  /** Internal links pointing at `url`. */
  linksTo(url: string): EvidenceRef;
  /** Clicks and impressions for these pages over `range`. */
  gscClicks(urls: string[], range: DateRange): EvidenceRef;
  /** A page's whole Search Console history: first and last day, clicks, impressions. */
  gscHistory(url: string): EvidenceRef;
  /** The sitemap files that list `url`, with lastmod. */
  sitemapEntries(url: string): EvidenceRef;
  /** The robots.txt fetched for `origin`: its status and every line. */
  robots(origin: string): EvidenceRef;
  /** Any other read-only query. */
  custom(table: string, sql: string, params: unknown[], label: string): EvidenceRef;
}

/**
 * Thrown by a check whose data is connected but not enough to judge, e.g.
 * "needs 180 days of Search Console data; you have 108". The engine lists the
 * check as skipped with this message, and resolves none of its earlier findings.
 */
export class SkipCheck extends Error {}

export interface FindingDraft {
  /** Stable key so the same issue matches across runs.
   *  Usually the affected URL, or URL + target for pair findings. */
  key: string;
  urls: string[];
  /** One line, plain language. */
  summary: string;
  /** Longer explanation. */
  detail?: string;
  /** Required for judgement checks. Why the check concluded this. */
  reasoning?: string;
  valueAtStake: ValueAtStake;
  /** Override the check default when this finding is more or less certain. */
  certainty?: number;
  effortHours?: number;
  /** At least one. */
  evidence: EvidenceRef[];
  fix?: FixAsset;
  /**
   * Set when one change fixes many of this check's findings (a template, a
   * sitemap setting). Findings of the check with the same fixGroup are one
   * fix: plan_sprint costs them once, at the largest effort among them.
   * Plain language naming the shared fix, e.g. "Add the /tags/ section to the sitemap".
   */
  fixGroup?: string;
}

export interface ValueAtStake {
  metric: 'clicks' | 'conversions' | 'revenue' | 'none';
  /** Trailing 28-day amount for affected URLs, or an estimate for
   *  opportunity checks. Must be derivable from the evidence. */
  amount: number;
  /** 'observed' = measured; 'estimated' = modelled (method required). */
  basis: 'observed' | 'estimated';
  /** Required when basis is 'estimated'. */
  method?: string;
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
