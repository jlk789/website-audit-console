import { addDays } from '../../connectors/gsc/dates.js';
import { HTML_200, html200Params, noValue, threshold } from '../helpers.js';
import type { CheckDefinition } from '../types.js';

export const indexBloatRatio: CheckDefinition = {
  id: 'indexing.index-bloat-ratio',
  version: 1,
  title: 'Many indexable pages, few earning clicks',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl', 'gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.1, effortHours: 4, certainty: 0.5 },
  thresholds: { maxRatio: 5, minIndexablePages: 50, windowDays: 90 },
  description:
    'The site offers search engines many more indexable pages than ever earn a click. Thin or near-duplicate pages (tags, filters, archives) can dilute how search engines rate the site. A stand-in for "indexed pages vs pages earning clicks" until the console can read index counts from URL Inspection (after v0.1). Consider noindexing or consolidating pages that never earn clicks.',
  run(ctx) {
    const origin = new URL(ctx.config.siteUrl).origin;
    const end = ctx.snapshot.gscRange!.end;
    const start = addDays(end, 1 - threshold(ctx, 'windowDays'));

    const indexableSql = `SELECT COUNT(*) AS pages FROM pages WHERE ${HTML_200} AND indexable = 1`;
    const indexable = ctx.db.get<{ pages: number }>(indexableSql, html200Params(ctx))?.pages ?? 0;
    if (indexable < threshold(ctx, 'minIndexablePages')) return [];

    const earningSql = `SELECT COUNT(*) AS pages FROM (
        SELECT page FROM gsc_page_daily
         WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ? AND page LIKE ?
         GROUP BY page HAVING SUM(clicks) > 0)`;
    const earningParams = [ctx.snapshot.propertyId, start, end, `${origin}/%`];
    const earning = ctx.db.get<{ pages: number }>(earningSql, earningParams)?.pages ?? 0;
    const ratio = earning === 0 ? Infinity : indexable / earning;
    if (ratio < threshold(ctx, 'maxRatio')) return [];

    return [
      {
        key: 'site',
        urls: [ctx.config.siteUrl],
        summary:
          earning === 0
            ? `${indexable} pages are indexable, but none earned a click from ${start} to ${end}.`
            : `${indexable} pages are indexable, but only ${earning} earned a click from ${start} to ${end} (${ratio.toFixed(1)} to 1).`,
        valueAtStake: noValue,
        evidence: [
          ctx.evidence.custom('pages', indexableSql, html200Params(ctx), 'Indexable crawled pages'),
          ctx.evidence.custom(
            'gsc_page_daily',
            earningSql,
            earningParams,
            `Pages earning clicks, ${start} to ${end}`,
          ),
        ],
        fix: {
          kind: 'text',
          body: 'List the indexable pages that have earned no clicks. Noindex or consolidate the thin ones (tag, filter and archive pages are common culprits), and improve the ones worth keeping.',
        },
      },
    ];
  },
};
