import { addDays } from '../../connectors/gsc/dates.js';
import { percent, queryCertainty, queryKey, quoteQuery } from '../gsc-helpers.js';
import { threshold } from '../helpers.js';
import type { CheckContext, CheckDefinition, EvidenceRef, FindingDraft } from '../types.js';

export const strikingDistance: CheckDefinition = {
  id: 'search-performance.striking-distance',
  version: 1,
  title: 'Query ranking just off the top results',
  category: 'search-performance',
  label: 'deterministic',
  requires: ['gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.5, effortHours: 2, certainty: 0.5 },
  thresholds: {
    minPosition: 8,
    maxPosition: 20,
    minImpressions: 50,
    minCurveClicks: 100,
    defaultTopCtr: 0.15,
    anonymisedPenalty: 0.5,
  },
  description:
    'A page ranks on average between positions 8 and 20 for a query with real demand: close enough that improving the page could lift it into the top results, where most clicks go. The value is an estimate of the extra clicks at the click-through rate your own top-3 results earn.',
  run(ctx) {
    const range = ctx.snapshot.gscRange!;
    const rowsSql = `SELECT query, page, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
                            SUM(position * impressions) / SUM(impressions) AS position
                       FROM gsc_query_page_daily
                      WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?
                      GROUP BY query, page`;
    const rows = ctx.db.all<{
      query: string;
      page: string;
      clicks: number;
      impressions: number;
      position: number;
    }>(
      `${rowsSql} HAVING impressions >= ? AND position BETWEEN ? AND ? ORDER BY impressions DESC, query, page`,
      [
        ctx.snapshot.propertyId,
        range.start,
        range.end,
        threshold(ctx, 'minImpressions'),
        threshold(ctx, 'minPosition'),
        threshold(ctx, 'maxPosition'),
      ],
    );
    if (rows.length === 0) return [];

    const top = topThreeCtr(ctx);
    const { certainty, evidence: quality } = queryCertainty(
      ctx,
      strikingDistance.defaults.certainty,
      range,
    );
    return rows
      .map((r) => ({ ...r, gain: r.impressions * (top.ctr - r.clicks / r.impressions) }))
      .filter((r) => r.gain > 0)
      .map((r): FindingDraft => ({
        key: `${ctx.db.normaliseUrl(r.page)} | ${queryKey(r.query)}`,
        urls: [r.page],
        summary: `${r.page} ranks at position ${r.position.toFixed(1)} for ${quoteQuery(r.query)} (${r.impressions} impressions, ${r.clicks} clicks in the last 28 days).`,
        valueAtStake: {
          metric: 'clicks',
          amount: Math.round(r.gain * 100) / 100,
          basis: 'estimated',
          method: `${r.impressions} impressions × (${top.source} ${percent(top.ctr)} − current ${percent(r.clicks / r.impressions)})`,
        },
        certainty,
        evidence: [
          ctx.evidence.custom(
            'gsc_query_page_daily',
            `${rowsSql.replace('GROUP BY query, page', 'AND query = ? AND page = ? GROUP BY query, page')}`,
            [ctx.snapshot.propertyId, range.start, range.end, r.query, r.page],
            'This query on this page, last 28 days',
          ),
          top.evidence,
          quality,
        ],
        fix: {
          kind: 'text',
          body: `Strengthen ${r.page} for this query: cover what searchers want more fully, use the query's wording in the title and headings, and link to the page from related pages on your site.`,
        },
      }));
  },
};

/**
 * The click-through rate the site's own results earn at positions 1–3 over
 * the last 90 days; the defaultTopCtr threshold if there are too few clicks.
 */
function topThreeCtr(ctx: CheckContext): { ctr: number; source: string; evidence: EvidenceRef } {
  const end = ctx.snapshot.gscRange!.end;
  const sql = `SELECT COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions
                 FROM gsc_query_page_daily
                WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ? AND position <= 3`;
  const params = [ctx.snapshot.propertyId, addDays(end, -89), end];
  const row = ctx.db.get<{ clicks: number; impressions: number }>(sql, params)!;
  const evidence = ctx.evidence.custom(
    'gsc_query_page_daily',
    sql,
    params,
    'Clicks and impressions at positions 1–3, last 90 days',
  );
  if (row.clicks >= threshold(ctx, 'minCurveClicks')) {
    return { ctr: row.clicks / row.impressions, source: 'your top-3 click-through rate', evidence };
  }
  return {
    ctr: threshold(ctx, 'defaultTopCtr'),
    source: 'default top-3 click-through rate',
    evidence,
  };
}
