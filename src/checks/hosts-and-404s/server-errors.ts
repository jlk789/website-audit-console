import { clicksAtStake, clicksPhrase } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const serverErrors: CheckDefinition = {
  id: 'hosts-and-404s.server-errors',
  version: 1,
  title: 'Server error or page that would not load',
  category: 'hosts-and-404s',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.6, effortHours: 1, certainty: 0.8 },
  thresholds: {},
  description:
    'A page returned a 5xx server error, or did not answer at all, even after a retry. Search engines drop pages that keep failing. The error may be temporary; check the server logs.',
  run(ctx) {
    const origin = new URL(ctx.config.siteUrl).origin;
    const failing = ctx.db.all<{ url: string; status: number | null; error: string | null }>(
      `SELECT url, status, fetch_error AS error FROM pages
        WHERE crawl_id = ? AND url LIKE ? AND robots_blocked = 0
          AND (status >= 500 OR (status IS NULL AND fetch_error IS NOT NULL))
        ORDER BY url`,
      [ctx.snapshot.crawlId, `${origin}/%`],
    );
    return failing.map((page): FindingDraft => {
      const value = clicksAtStake(ctx, [page.url]);
      const what =
        page.status === null ? `could not be loaded (${page.error})` : `returns ${page.status}`;
      return {
        key: ctx.db.normaliseUrl(page.url),
        urls: [page.url],
        summary: `${page.url} ${what}.${clicksPhrase(value.valueAtStake)}`,
        valueAtStake: value.valueAtStake,
        evidence: [ctx.evidence.page(page.url), ...value.evidence],
      };
    });
  },
};
