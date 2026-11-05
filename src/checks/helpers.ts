import { MISSING_PAGE_PATH } from '../connectors/crawler/urls.js';
import type { CheckContext, EvidenceRef, ValueAtStake } from './types.js';

/**
 * Trailing 28-day clicks on `urls`, with the evidence that proves the number.
 * Without Search Console there is no number to claim, so the value is 'none'.
 */
export function clicksAtStake(
  ctx: CheckContext,
  urls: string[],
): { valueAtStake: ValueAtStake; evidence: EvidenceRef[] } {
  const range = ctx.snapshot.gscRange;
  if (!range) {
    return { valueAtStake: { metric: 'none', amount: 0, basis: 'observed' }, evidence: [] };
  }
  const evidence = ctx.evidence.gscClicks(urls, range);
  const row = ctx.db.get<{ clicks: number }>(evidence.sql, evidence.params);
  return {
    valueAtStake: { metric: 'clicks', amount: row?.clicks ?? 0, basis: 'observed' },
    evidence: [evidence],
  };
}

/** "34 clicks in the last 28 days", or nothing without Search Console. */
export function clicksPhrase(value: ValueAtStake): string {
  if (value.metric !== 'clicks') return '';
  return ` It earned ${value.amount.toLocaleString('en')} click${value.amount === 1 ? '' : 's'} in the last 28 days.`;
}

/**
 * The whole site's clicks in the last 28 days (every page in the Search
 * Console property), for findings that put the entire site at risk.
 */
export function siteClicksAtStake(ctx: CheckContext): {
  valueAtStake: ValueAtStake;
  evidence: EvidenceRef[];
} {
  const range = ctx.snapshot.gscRange;
  if (!range) return { valueAtStake: noValue, evidence: [] };
  const evidence = ctx.evidence.custom(
    'gsc_page_daily',
    `SELECT COALESCE(SUM(clicks), 0) AS clicks, COUNT(DISTINCT page) AS pages FROM gsc_page_daily
      WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?`,
    [ctx.snapshot.propertyId, range.start, range.end],
    `Search Console clicks for the whole site, ${range.start} to ${range.end}`,
  );
  const row = ctx.db.get<{ clicks: number }>(evidence.sql, evidence.params);
  return {
    valueAtStake: { metric: 'clicks', amount: row?.clicks ?? 0, basis: 'observed' },
    evidence: [evidence],
  };
}

export interface HtmlPage {
  url: string;
  metaRobots: string | null;
  xRobotsTag: string | null;
  canonical: string | null;
  indexable: number;
  inSitemap: number | null;
}

/**
 * Crawled HTML pages on the site's own origin that returned 200, without
 * the crawler's made-up missing-page URL.
 */
export const HTML_200 = `crawl_id = ? AND status = 200 AND url LIKE ? AND url NOT LIKE ?
  AND (content_type LIKE 'text/html%' OR content_type LIKE 'application/xhtml%')`;

export function html200Params(ctx: CheckContext): unknown[] {
  const origin = new URL(ctx.config.siteUrl).origin;
  return [ctx.snapshot.crawlId, `${origin}/%`, `${origin}${MISSING_PAGE_PATH}%`];
}

export function htmlPages(ctx: CheckContext): HtmlPage[] {
  return ctx.db.all<HtmlPage>(
    `SELECT url, meta_robots AS metaRobots, x_robots_tag AS xRobotsTag, canonical,
            indexable, in_sitemap AS inSitemap
       FROM pages WHERE ${HTML_200} ORDER BY url`,
    html200Params(ctx),
  );
}

/** Lists these crawled pages: the rows behind a site-wide count. */
export function pagesEvidence(ctx: CheckContext, urls: string[], label: string): EvidenceRef {
  return ctx.evidence.custom(
    'pages',
    `SELECT url, status, meta_robots, x_robots_tag, canonical FROM pages
      WHERE crawl_id = ? AND url IN (SELECT value FROM json_each(?)) ORDER BY url`,
    [ctx.snapshot.crawlId, JSON.stringify(urls)],
    label,
  );
}

/** Counts the site's crawled HTML pages that returned 200: the total behind a share. */
export function html200CountEvidence(ctx: CheckContext): EvidenceRef {
  return ctx.evidence.custom(
    'pages',
    `SELECT COUNT(*) AS pages FROM pages WHERE ${HTML_200}`,
    html200Params(ctx),
    'Crawled HTML pages on the site that returned 200',
  );
}

/** A threshold by name. Every name a check reads must be in its `thresholds`. */
export function threshold(ctx: CheckContext, name: string): number {
  const value = ctx.config.thresholds[name];
  if (value === undefined) throw new Error(`the check has no threshold "${name}"`);
  return value;
}

/** A value of 'none', for hygiene findings with no traffic link. */
export const noValue: ValueAtStake = { metric: 'none', amount: 0, basis: 'observed' };

export interface Chain {
  /** Where the chain starts. */
  url: string;
  /** Number of redirect responses. */
  hops: number;
  firstStatus: number;
  /** Where the last redirect points. */
  target: string | null;
  /** Status of the page at `target`, if it was crawled. */
  finalStatus: number | null;
  /** Why the crawler stopped following, e.g. "redirect loop". */
  stopped: string | null;
}

/** Every redirect chain in the snapshot's crawl. */
export function redirectChains(ctx: CheckContext): Chain[] {
  return ctx.db.all<Chain>(
    `WITH ends AS (
       SELECT url, COUNT(*) AS hops, MAX(hop) AS last_hop
         FROM redirect_hops WHERE crawl_id = ? GROUP BY url)
     SELECT e.url, e.hops, s.status AS firstStatus, h.target, p.status AS finalStatus,
            s.fetch_error AS stopped
       FROM ends e
       JOIN redirect_hops h ON h.crawl_id = ? AND h.url = e.url AND h.hop = e.last_hop
       JOIN pages s ON s.crawl_id = ? AND s.url = e.url
       LEFT JOIN pages p ON p.crawl_id = ? AND p.url = h.target
      ORDER BY e.url`,
    Array(4).fill(ctx.snapshot.crawlId),
  );
}
