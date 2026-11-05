import { clicksAtStake, clicksPhrase, htmlPages } from '../helpers.js';
import type { CheckDefinition, EvidenceRef, FindingDraft } from '../types.js';

export const indexableNotInSitemap: CheckDefinition = {
  id: 'indexing.indexable-not-in-sitemap',
  version: 1,
  title: 'Indexable page missing from the sitemap',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.05, effortHours: 0.1, certainty: 0.8 },
  thresholds: {},
  description:
    'An indexable page is not listed in any sitemap, though the site has one. Sitemaps help search engines find and re-crawl pages. Either add the page, or, if it should not be in search, mark it noindex.',
  run(ctx) {
    const sitemapsSql = `SELECT url, status, url_count FROM sitemaps
      WHERE crawl_id = ? AND status = 200 AND url_count > 0`;
    const working = ctx.db.all(sitemapsSql, [ctx.snapshot.crawlId]);
    // Without a working sitemap, "missing from the sitemap" would flag every page.
    if (working.length === 0) return [];
    const sitemaps: EvidenceRef = ctx.evidence.custom(
      'sitemaps',
      sitemapsSql,
      [ctx.snapshot.crawlId],
      "The site's working sitemaps",
    );

    // Test requests (probes) are left out: a 200 slash twin is a trailing-slash finding.
    const probes = new Set(
      ctx.db
        .all<{ url: string }>(
          `SELECT url FROM crawl_queue WHERE crawl_id = ? AND source = 'probe'`,
          [ctx.snapshot.crawlId],
        )
        .map((r) => r.url),
    );
    return htmlPages(ctx)
      .filter((p) => p.indexable === 1 && p.inSitemap === 0 && !probes.has(p.url))
      .map((p): FindingDraft => {
        const value = clicksAtStake(ctx, [p.url]);
        return {
          key: ctx.db.normaliseUrl(p.url),
          urls: [p.url],
          summary: `${p.url} is indexable but not in any sitemap.${clicksPhrase(value.valueAtStake)}`,
          valueAtStake: value.valueAtStake,
          evidence: [ctx.evidence.page(p.url), sitemaps, ...value.evidence],
          fix: {
            kind: 'text',
            body: `Add ${p.url} to the sitemap, or mark it noindex if it should not appear in search.`,
          },
        };
      });
  },
};
