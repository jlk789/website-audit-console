import { addDays } from '../../connectors/gsc/dates.js';
import { noValue, threshold } from '../helpers.js';
import type { CheckDefinition } from '../types.js';

export const indexedPagesCollapse: CheckDefinition = {
  id: 'indexing.indexed-pages-collapse',
  version: 1,
  title: 'Sudden drop in pages appearing in search',
  category: 'indexing',
  label: 'deterministic',
  requires: ['gsc'],
  severityFloor: true,
  defaults: { expectedYield: 0.8, effortHours: 2, certainty: 0.7 },
  thresholds: { minDrop: 0.5, minBaselinePages: 10 },
  description:
    'Far fewer pages earned search impressions in the last 7 days than in the 3 weeks before. A stand-in for "indexed pages collapsed" until the console can read index counts from URL Inspection (after v0.1): it usually means pages were dropped from the index (a noindex, robots.txt or canonical change, or a site outage).',
  run(ctx) {
    const end = ctx.snapshot.gscRange!.end;
    // Pages with impressions per week: 0 is the last 7 days, 1–3 the weeks before.
    const sql = `SELECT CAST((julianday(?) - julianday(date)) / 7 AS INTEGER) AS weeksAgo,
                        COUNT(DISTINCT page) AS pages
                   FROM gsc_page_daily
                  WHERE property_id = ? AND search_type = 'web' AND impressions > 0
                    AND date BETWEEN ? AND ?
                  GROUP BY weeksAgo ORDER BY weeksAgo`;
    const params = [end, ctx.snapshot.propertyId, addDays(end, -27), end];
    const weeks = ctx.db.all<{ weeksAgo: number; pages: number }>(sql, params);
    const pagesIn = (week: number) => weeks.find((w) => w.weeksAgo === week)?.pages ?? 0;

    const recent = pagesIn(0);
    const baseline = (pagesIn(1) + pagesIn(2) + pagesIn(3)) / 3;
    if (baseline < threshold(ctx, 'minBaselinePages')) return [];
    const drop = 1 - recent / baseline;
    if (drop < threshold(ctx, 'minDrop')) return [];

    return [
      {
        key: 'site',
        urls: [ctx.config.siteUrl],
        summary: `Only ${recent} pages earned search impressions in the 7 days to ${end}, down ${Math.round(drop * 100)}% from an average of ${Math.round(baseline)} a week in the 3 weeks before.`,
        valueAtStake: noValue,
        evidence: [
          ctx.evidence.custom(
            'gsc_page_daily',
            sql,
            params,
            'Pages with impressions per week (0 = last 7 days)',
          ),
        ],
        fix: {
          kind: 'text',
          body: "Check what changed around the drop: noindex tags, robots.txt, canonical tags, redirects or server errors. Search Console's Pages report shows which pages left the index and why.",
        },
      },
    ];
  },
};
