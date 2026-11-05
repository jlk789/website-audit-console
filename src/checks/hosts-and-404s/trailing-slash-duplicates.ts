import { clicksAtStake, clicksPhrase } from '../helpers.js';
import type { CheckContext, CheckDefinition, EvidenceRef, FindingDraft } from '../types.js';

export const trailingSlashDuplicates: CheckDefinition = {
  id: 'hosts-and-404s.trailing-slash-duplicates',
  version: 1,
  title: 'Same page with and without a trailing slash',
  category: 'hosts-and-404s',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.1, effortHours: 0.5, certainty: 0.9 },
  thresholds: {},
  description:
    'A page answers 200 both with and without a trailing slash, and neither version points its canonical at the other, so search engines see two copies. Pick one form and 301-redirect the other to it.',
  run(ctx) {
    const pairs = ctx.db.all<{
      bare: string;
      slashed: string;
      bareLinks: number;
      slashedLinks: number;
    }>(
      `SELECT a.url AS bare, b.url AS slashed,
              (SELECT COUNT(*) FROM links l WHERE l.crawl_id = a.crawl_id AND l.to_url = a.url) AS bareLinks,
              (SELECT COUNT(*) FROM links l WHERE l.crawl_id = b.crawl_id AND l.to_url = b.url) AS slashedLinks
         FROM pages a
         JOIN pages b ON b.crawl_id = a.crawl_id AND b.url = a.url || '/'
        WHERE a.crawl_id = ? AND a.status = 200 AND b.status = 200 AND a.url NOT LIKE '%?%'
          AND (a.canonical IS NULL OR a.canonical <> b.url)
          AND (b.canonical IS NULL OR b.canonical <> a.url)
        ORDER BY a.url`,
      [ctx.snapshot.crawlId],
    );

    return pairs.map((p): FindingDraft => {
      // Keep the form the site links to more; on a tie, the slashed one.
      const [keep, drop] = p.bareLinks > p.slashedLinks ? [p.bare, p.slashed] : [p.slashed, p.bare];
      const value = clicksAtStake(ctx, [p.bare, p.slashed]);
      return {
        key: `${ctx.db.normaliseUrl(p.bare)} | ${ctx.db.normaliseUrl(p.slashed)}`,
        urls: [p.bare, p.slashed],
        summary: `${p.bare} and ${p.slashed} both return 200 as separate pages (linked ${p.bareLinks} and ${p.slashedLinks} times).${clicksPhrase(value.valueAtStake).replace('It earned', 'Together they earned')}`,
        valueAtStake: value.valueAtStake,
        evidence: [
          ctx.evidence.page(p.bare),
          ctx.evidence.page(p.slashed),
          linkCount(ctx, p.bare),
          linkCount(ctx, p.slashed),
          ...value.evidence,
        ],
        fix: { kind: 'redirect-map', rows: [{ from: drop, to: keep, status: 301 }] },
      };
    });
  },
};

/** How many internal links point at `url`: one row, even when the answer is 0. */
function linkCount(ctx: CheckContext, url: string): EvidenceRef {
  return ctx.evidence.custom(
    'links',
    'SELECT ? AS url, COUNT(*) AS links FROM links WHERE crawl_id = ? AND to_url = ?',
    [url, ctx.snapshot.crawlId, url],
    `Number of internal links to ${url}`,
  );
}
