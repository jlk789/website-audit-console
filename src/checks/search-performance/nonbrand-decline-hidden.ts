import { percent, queryCertainty, windows } from '../gsc-helpers.js';
import { threshold } from '../helpers.js';
import type { CheckContext, CheckDefinition, DateRange, EvidenceRef } from '../types.js';

export const nonbrandDeclineHidden: CheckDefinition = {
  id: 'search-performance.nonbrand-decline-hidden',
  version: 1,
  title: 'Non-brand decline hidden by brand traffic',
  category: 'search-performance',
  label: 'deterministic',
  requires: ['gsc', 'brand-terms'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 4, certainty: 0.7 },
  thresholds: {
    windowDays: 90,
    maxTotalDecline: 0.05,
    minNonbrandDrop: 0.2,
    minNonbrandClicks: 30,
    anonymisedPenalty: 0.5,
  },
  description:
    "Total search clicks look flat or rising, but clicks from searches that don't name your brand have fallen. People who already know you are masking a loss of new visitors. A query counts as brand if it contains one of the brand terms in your config.",
  run(ctx) {
    const days = threshold(ctx, 'windowDays');
    const { before, recent } = windows(ctx, days);
    const totalBefore = totalClicks(ctx, before);
    const totalNow = totalClicks(ctx, recent);
    const nonbrandBefore = nonbrandClicks(ctx, before);
    const nonbrandNow = nonbrandClicks(ctx, recent);

    if (totalBefore.clicks === 0 || nonbrandBefore.clicks < threshold(ctx, 'minNonbrandClicks'))
      return [];
    const totalChange = totalNow.clicks / totalBefore.clicks - 1;
    const nonbrandDrop = 1 - nonbrandNow.clicks / nonbrandBefore.clicks;
    if (totalChange < -threshold(ctx, 'maxTotalDecline')) return [];
    if (nonbrandDrop < threshold(ctx, 'minNonbrandDrop')) return [];

    // Anonymised clicks can't be sorted into brand and non-brand, so they lower certainty.
    const { certainty, evidence: quality } = queryCertainty(
      ctx,
      nonbrandDeclineHidden.defaults.certainty,
      recent,
    );
    const lost = nonbrandBefore.clicks - nonbrandNow.clicks;
    const direction =
      totalChange >= 0 ? `rose ${percent(totalChange)}` : `fell only ${percent(-totalChange)}`;
    return [
      {
        key: 'site',
        urls: [ctx.config.siteUrl],
        summary: `Total search clicks ${direction} (${totalBefore.clicks} → ${totalNow.clicks}) between the ${days} days to ${before.end} and the ${days} days to ${recent.end}, but non-brand clicks fell ${percent(nonbrandDrop)} (${nonbrandBefore.clicks} → ${nonbrandNow.clicks}).`,
        valueAtStake: {
          metric: 'clicks',
          amount: Math.round(((lost * 28) / days) * 100) / 100,
          basis: 'estimated',
          method: `${lost} non-brand clicks lost between two ${days}-day periods, scaled to 28 days`,
        },
        certainty,
        evidence: [
          totalBefore.evidence,
          totalNow.evidence,
          nonbrandBefore.evidence,
          nonbrandNow.evidence,
          quality,
        ],
        fix: {
          kind: 'text',
          body: 'Look at which non-brand queries and pages lost clicks (the traffic-decay and CTR-erosion findings help), and treat it as a loss of new visitors even though the total looks healthy.',
        },
      },
    ];
  },
};

/** All clicks in a range, including anonymised queries. */
function totalClicks(
  ctx: CheckContext,
  range: DateRange,
): { clicks: number; evidence: EvidenceRef } {
  const sql = `SELECT COALESCE(SUM(clicks), 0) AS clicks FROM gsc_page_daily
                WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?`;
  const params = [ctx.snapshot.propertyId, range.start, range.end];
  return {
    clicks: ctx.db.get<{ clicks: number }>(sql, params)!.clicks,
    evidence: ctx.evidence.custom(
      'gsc_page_daily',
      sql,
      params,
      `All clicks, ${range.start} to ${range.end}`,
    ),
  };
}

/** Clicks from queries that contain none of the brand terms (case-insensitive). */
function nonbrandClicks(
  ctx: CheckContext,
  range: DateRange,
): { clicks: number; evidence: EvidenceRef } {
  const terms = ctx.config.brandTerms.map((t) => `%${t.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
  const brand = terms.map(() => `lower(query) LIKE ? ESCAPE '\\'`).join(' OR ');
  const sql = `SELECT COALESCE(SUM(clicks), 0) AS clicks FROM gsc_query_page_daily
                WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?
                  AND NOT (${brand})`;
  const params = [ctx.snapshot.propertyId, range.start, range.end, ...terms];
  return {
    clicks: ctx.db.get<{ clicks: number }>(sql, params)!.clicks,
    evidence: ctx.evidence.custom(
      'gsc_query_page_daily',
      sql,
      params,
      `Non-brand clicks (queries without ${ctx.config.brandTerms.join(', ')}), ${range.start} to ${range.end}`,
    ),
  };
}
