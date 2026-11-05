import { pageTotals, percent, windows } from '../gsc-helpers.js';
import { threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const ctrErosion: CheckDefinition = {
  id: 'search-performance.ctr-erosion',
  version: 1,
  title: 'Fewer clicks at the same ranking',
  category: 'search-performance',
  label: 'deterministic',
  requires: ['gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 1, certainty: 0.6 },
  thresholds: {
    windowDays: 28,
    minDrop: 0.3,
    minBaselineClicks: 10,
    minImpressionsKept: 0.7,
    maxPositionChange: 1,
  },
  description:
    "A page kept its impressions and its average position, yet its click-through rate fell sharply. Something on the results page now draws the clicks: a weaker title or snippet, a competitor's richer result, or a new search feature such as an AI answer. Review how the page appears in results.",
  run(ctx) {
    const days = threshold(ctx, 'windowDays');
    const { before, recent } = windows(ctx, days);
    const pages = ctx.db.all<{ page: string }>(
      `SELECT page FROM gsc_page_daily
        WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?
        GROUP BY page HAVING SUM(clicks) >= ? ORDER BY page`,
      [ctx.snapshot.propertyId, before.start, before.end, threshold(ctx, 'minBaselineClicks')],
    );

    const findings: FindingDraft[] = [];
    for (const { page } of pages) {
      const was = pageTotals(ctx, page, before);
      const now = pageTotals(ctx, page, recent);
      if (was.impressions === 0 || now.impressions === 0) continue;
      if (now.impressions < was.impressions * threshold(ctx, 'minImpressionsKept')) continue;
      if (
        Math.abs((now.position ?? 0) - (was.position ?? 0)) > threshold(ctx, 'maxPositionChange')
      ) {
        continue;
      }
      const ctrWas = was.clicks / was.impressions;
      const ctrNow = now.clicks / now.impressions;
      if (ctrNow > ctrWas * (1 - threshold(ctx, 'minDrop'))) continue;

      const lost = Math.round(now.impressions * (ctrWas - ctrNow) * 100) / 100;
      findings.push({
        key: ctx.db.normaliseUrl(page),
        urls: [page],
        summary: `${page}'s click-through rate fell from ${percent(ctrWas)} to ${percent(ctrNow)} while its average position held (${was.position!.toFixed(1)} → ${now.position!.toFixed(1)}).`,
        valueAtStake: {
          metric: 'clicks',
          amount: lost,
          basis: 'estimated',
          method: `${now.impressions} impressions in the ${days} days to ${recent.end} × the drop in click-through rate (${percent(ctrWas)} → ${percent(ctrNow)})`,
        },
        evidence: [was.evidence, now.evidence],
        fix: {
          kind: 'text',
          body: `Search for the page's main queries and look at the results page. Rewrite the title and meta description of ${page} if they are weaker than competitors', and check whether structured data could earn a richer result.`,
        },
      });
    }
    return findings;
  },
};
