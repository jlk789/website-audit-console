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
