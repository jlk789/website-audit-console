import { percent, queryCertainty, queryKey, quoteQuery } from '../gsc-helpers.js';
import { threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const cannibalisation: CheckDefinition = {
  id: 'search-performance.cannibalisation',
  version: 1,
  title: 'Several pages competing for one query',
  category: 'search-performance',
  label: 'judgement',
  requires: ['gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 2, certainty: 0.5 },
  thresholds: { minImpressions: 100, minShare: 0.2, anonymisedPenalty: 0.5 },
  description:
    'Two or more of your pages each take a real share of the impressions for the same query, so search engines keep switching between them and none ranks as well as one strong page would. Sometimes intended (different intents); often worth merging or making one page clearly the best answer.',
  run(ctx) {
    const range = ctx.snapshot.gscRange!;
    const rowsSql = `SELECT query, page, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
                            SUM(position * impressions) / SUM(impressions) AS position
                       FROM gsc_query_page_daily
                      WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?`;
    const params = [ctx.snapshot.propertyId, range.start, range.end];
    const rows = ctx.db.all<{
      query: string;
      page: string;
      clicks: number;
      impressions: number;
      position: number;
    }>(`${rowsSql} GROUP BY query, page ORDER BY query, impressions DESC, page`, params);

    const byQuery = new Map<string, typeof rows>();
    for (const r of rows) byQuery.set(r.query, [...(byQuery.get(r.query) ?? []), r]);

    const minShare = threshold(ctx, 'minShare');
    const findings: FindingDraft[] = [];
    for (const [query, pages] of byQuery) {
      const total = pages.reduce((sum, p) => sum + p.impressions, 0);
      if (total < threshold(ctx, 'minImpressions')) continue;
      const competing = pages.filter((p) => p.impressions / total >= minShare);
      if (competing.length < 2) continue;

      const clicks = pages.reduce((sum, p) => sum + p.clicks, 0);
      const { certainty, evidence: quality } = queryCertainty(
        ctx,
        cannibalisation.defaults.certainty,
        range,
      );
      const shares = competing
        .map(
          (p) =>
            `${p.page} took ${percent(p.impressions / total)} at average position ${p.position.toFixed(1)}`,
        )
        .join('; ');
      findings.push({
        key: queryKey(query),
        urls: competing.map((p) => p.page),
        summary: `${competing.length} pages compete for ${quoteQuery(query)} (${total} impressions, ${clicks} clicks in the last 28 days).`,
        reasoning: `In the last 28 days Search Console showed ${pages.length} of your pages for this query, and ${competing.length} each took at least ${percent(minShare)} of its ${total} impressions: ${shares}. When impressions split like this, no single page builds a strong ranking.`,
        valueAtStake: { metric: 'clicks', amount: clicks, basis: 'observed' },
        certainty,
        evidence: [
          ctx.evidence.custom(
            'gsc_query_page_daily',
            `${rowsSql} AND query = ? GROUP BY query, page ORDER BY impressions DESC`,
            [...params, query],
            'Pages shown for this query, last 28 days',
          ),
          quality,
        ],
        fix: {
          kind: 'text',
          body: `Decide which page should rank for this query. Merge the others into it (with 301 redirects) or make their focus clearly different, and point internal links for this topic at the chosen page.`,
        },
      });
    }
    return findings;
  },
};
