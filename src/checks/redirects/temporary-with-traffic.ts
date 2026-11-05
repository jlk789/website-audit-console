import { threshold } from '../helpers.js';
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
        WHERE r.crawl_id = ? AND r.hop = 0 AND r.status IN (302, 307) AND r.target IS NOT NULL
        GROUP BY r.url, r.status, r.target
       HAVING clicks >= ?
        ORDER BY r.url`,
      [
        ctx.snapshot.propertyId,
        range.start,
        range.end,
        ctx.snapshot.crawlId,
        threshold(ctx, 'minClicks'),
      ],
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
