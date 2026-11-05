import { pageTotals, percent, windows } from '../gsc-helpers.js';
import { threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const trafficDecay: CheckDefinition = {
  id: 'search-performance.traffic-decay',
  version: 1,
  title: 'Page losing search traffic',
  category: 'search-performance',
  label: 'deterministic',
  requires: ['gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 2, certainty: 0.7 },
  thresholds: { windowDays: 90, minDrop: 0.3, minBaselineClicks: 20 },
  description:
    'A page earned far fewer search clicks in the last 90 days than in the 90 days before. Common causes: content that has gone stale, a competitor overtaking it, or a technical change. Seasonal pages can dip too, so compare with the same period last year before acting.',
  run(ctx) {
    const days = threshold(ctx, 'windowDays');
    const { before, recent } = windows(ctx, days);
    const pages = ctx.db.all<{ page: string; before: number; recent: number }>(
      `SELECT page,
              SUM(CASE WHEN date <= ? THEN clicks ELSE 0 END) AS before,
              SUM(CASE WHEN date >= ? THEN clicks ELSE 0 END) AS recent
         FROM gsc_page_daily
        WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?
        GROUP BY page
       HAVING before >= ?
        ORDER BY page`,
      [
        before.end,
        recent.start,
        ctx.snapshot.propertyId,
        before.start,
        recent.end,
        threshold(ctx, 'minBaselineClicks'),
      ],
    );

    const minDrop = threshold(ctx, 'minDrop');
    return pages
      .filter((p) => 1 - p.recent / p.before >= minDrop)
      .map((p): FindingDraft => {
        const lost = Math.round((((p.before - p.recent) * 28) / days) * 100) / 100;
        return {
          key: ctx.db.normaliseUrl(p.page),
          urls: [p.page],
          summary: `${p.page} earned ${p.recent} clicks in the ${days} days to ${recent.end}, down ${percent(1 - p.recent / p.before)} from ${p.before} in the ${days} days before.`,
          valueAtStake: {
            metric: 'clicks',
            amount: lost,
            basis: 'estimated',
            method: `${p.before - p.recent} clicks lost between two ${days}-day periods, scaled to 28 days`,
          },
          evidence: [
            pageTotals(ctx, p.page, before).evidence,
            pageTotals(ctx, p.page, recent).evidence,
          ],
          fix: {
            kind: 'text',
            body: `Compare ${p.page} with the pages now ranking for its main queries: refresh outdated content, check that the page still answers the query, and look for technical changes around when the decline started.`,
          },
        };
      });
  },
};
