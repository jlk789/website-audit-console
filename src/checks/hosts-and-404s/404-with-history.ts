import { daysBetween } from '../../connectors/gsc/dates.js';
import { threshold } from '../helpers.js';
import type { CheckContext, CheckDefinition, EvidenceRef, FindingDraft } from '../types.js';

export const notFoundWithHistory: CheckDefinition = {
  id: 'hosts-and-404s.404-with-history',
  version: 1,
  title: 'Missing page that had search traffic',
  category: 'hosts-and-404s',
  label: 'deterministic',
  requires: ['crawl', 'gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.5, effortHours: 0.25, certainty: 0.9 },
  thresholds: { minImpressions: 1 },
  description:
    'A URL that appeared in search results now returns 404 or 410. Its rankings and any links to it are being lost. Redirect it with a 301 to the page that best replaces it; the suggested target is the live page that wins the same searches, or else its closest parent page.',
  run(ctx) {
    const end = ctx.snapshot.gscRange!.end;
    const dead = ctx.db.all<{
      url: string;
      status: number;
      firstDay: string;
      clicks: number;
      impressions: number;
    }>(
      `SELECT p.url, p.status, MIN(g.date) AS firstDay,
              SUM(g.clicks) AS clicks, SUM(g.impressions) AS impressions
         FROM pages p
         JOIN gsc_page_daily g
           ON g.property_id = ? AND g.search_type = 'web' AND g.page = p.url
        WHERE p.crawl_id = ? AND p.status IN (404, 410)
        GROUP BY p.url, p.status
       HAVING SUM(g.impressions) >= ?
        ORDER BY p.url`,
      [ctx.snapshot.propertyId, ctx.snapshot.crawlId, threshold(ctx, 'minImpressions')],
    );

    return dead.map((d): FindingDraft => {
      const days = daysBetween(d.firstDay, end).length;
      const perPeriod = Math.round(((d.clicks * 28) / days) * 100) / 100;
      const target = replacement(ctx, d.url);
      return {
        key: ctx.db.normaliseUrl(d.url),
        urls: [d.url, ...(target ? [target.url] : [])],
        summary: `${d.url} returns ${d.status} but has search history: ${d.impressions} impressions and ${d.clicks} clicks since ${d.firstDay}.`,
        detail: target
          ? `Suggested redirect target: ${target.url} (${target.why}).`
          : 'No live page wins the same searches and no parent page is indexable, so there is no suggested target.',
        valueAtStake: {
          metric: 'clicks',
          amount: perPeriod,
          basis: 'estimated',
          method: `${d.clicks} clicks from ${d.firstDay} to ${end} (${days} days), scaled to 28 days`,
        },
        evidence: [
          ctx.evidence.page(d.url),
          ctx.evidence.gscHistory(d.url),
          ...(target ? [target.evidence] : []),
        ],
        fix: target
          ? { kind: 'redirect-map', rows: [{ from: d.url, to: target.url, status: 301 }] }
          : {
              kind: 'text',
              body: `Restore ${d.url}, or redirect it to the page that best replaces it.`,
            },
      };
    });
  },
};

/**
 * The best redirect target for a dead page: the live, indexable page that
 * earned the most clicks on the dead page's queries; otherwise its closest
 * indexable parent page. Never the homepage (see redirects.deep-to-homepage).
 */
function replacement(
  ctx: CheckContext,
  url: string,
): { url: string; why: string; evidence: EvidenceRef } | undefined {
  const sql = `SELECT q2.page AS url, SUM(q2.clicks) AS clicks
      FROM gsc_query_page_daily q1
      JOIN gsc_query_page_daily q2
        ON q2.property_id = q1.property_id AND q2.search_type = q1.search_type
       AND q2.query = q1.query AND q2.page <> q1.page
      JOIN pages t ON t.crawl_id = ? AND t.url = q2.page AND t.status = 200 AND t.indexable = 1
     WHERE q1.property_id = ? AND q1.search_type = 'web' AND q1.page = ?
     GROUP BY q2.page HAVING SUM(q2.clicks) > 0
     ORDER BY clicks DESC, q2.page LIMIT 1`;
  const params = [ctx.snapshot.crawlId, ctx.snapshot.propertyId, url];
  const shared = ctx.db.get<{ url: string; clicks: number }>(sql, params);
  if (shared) {
    return {
      url: shared.url,
      why: `it earned ${shared.clicks} clicks on the same searches`,
      evidence: ctx.evidence.custom(
        'gsc_query_page_daily',
        sql,
        params,
        `Live page winning the searches ${url} had`,
      ),
    };
  }

  const home = new URL('/', url).href;
  for (const parent of parents(url)) {
    if (parent === home) break;
    const page = ctx.db.get<{ url: string }>(
      'SELECT url FROM pages WHERE crawl_id = ? AND url = ? AND status = 200 AND indexable = 1',
      [ctx.snapshot.crawlId, parent],
    );
    if (page)
      return { url: parent, why: 'its closest parent page', evidence: ctx.evidence.page(parent) };
  }
  return undefined;
}

/** /a/b/c/ → /a/b/, /a/b, /a/, /a, / (each with and without the slash). */
function parents(url: string): string[] {
  const { origin, pathname } = new URL(url);
  const segments = pathname.split('/').filter(Boolean);
  const result: string[] = [];
  for (let n = segments.length - 1; n >= 0; n--) {
    const path = segments.slice(0, n).join('/');
    if (n === 0) result.push(`${origin}/`);
    else result.push(`${origin}/${path}/`, `${origin}/${path}`);
  }
  return result;
}
