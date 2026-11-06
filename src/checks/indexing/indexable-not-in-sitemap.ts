import { clicksAtStake, clicksPhrase, htmlPages, threshold } from '../helpers.js';
import type { CheckDefinition, EvidenceRef, FindingDraft } from '../types.js';

export const indexableNotInSitemap: CheckDefinition = {
  id: 'indexing.indexable-not-in-sitemap',
  version: 2,
  title: 'Indexable page missing from the sitemap',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.05, effortHours: 0.1, certainty: 0.8 },
  // Pages missing from one section that make it one shared fix.
  thresholds: { minGroupSize: 2 },
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
    const missing = htmlPages(ctx).filter(
      (p) => p.indexable === 1 && p.inSitemap === 0 && !probes.has(p.url),
    );

    // Pages missing from one section (/tags/, /tags/aeo/ …) are usually left
    // out by one sitemap setting, so they share one fix.
    const perSection = new Map<string, number>();
    for (const p of missing) {
      const s = section(p.url);
      if (s) perSection.set(s, (perSection.get(s) ?? 0) + 1);
    }
    const minGroupSize = threshold(ctx, 'minGroupSize');
    const groupOf = (url: string) => {
      const s = section(url);
      return s && (perSection.get(s) ?? 0) >= minGroupSize
        ? `Add the ${s} section to the sitemap`
        : undefined;
    };

    return missing.map((p): FindingDraft => {
      const value = clicksAtStake(ctx, [p.url]);
      const fixGroup = groupOf(p.url);
      return {
        ...(fixGroup ? { fixGroup } : {}),
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

/** The first folder of a URL's path, as "/tags/"; undefined for the homepage. */
function section(url: string): string | undefined {
  const first = new URL(url).pathname.split('/').find(Boolean);
  return first ? `/${first}/` : undefined;
}
