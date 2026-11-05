import { clicksAtStake, clicksPhrase } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const sitemapUrlRobotsBlocked: CheckDefinition = {
  id: 'indexing.sitemap-url-robots-blocked',
  version: 1,
  title: 'Sitemap lists a URL blocked by robots.txt',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 0.25, certainty: 0.95 },
  thresholds: {},
  description:
    'A sitemap asks search engines to index a URL that robots.txt forbids them to crawl. They cannot read the page, so it is indexed poorly or not at all. Either allow the URL in robots.txt or take it out of the sitemap.',
  run(ctx) {
    const origin = new URL(ctx.config.siteUrl).origin;
    const rows = ctx.db.all<{ url: string }>(
      `SELECT DISTINCT s.url FROM sitemap_urls s
         JOIN pages p ON p.crawl_id = s.crawl_id AND p.url = s.url
        WHERE s.crawl_id = ? AND p.robots_blocked = 1
        ORDER BY s.url`,
      [ctx.snapshot.crawlId],
    );
    return rows.map((r): FindingDraft => {
      const value = clicksAtStake(ctx, [r.url]);
      return {
        key: ctx.db.normaliseUrl(r.url),
        urls: [r.url],
        summary: `The sitemap lists ${r.url}, but robots.txt blocks crawlers from it.${clicksPhrase(value.valueAtStake)}`,
        valueAtStake: value.valueAtStake,
        evidence: [
          ctx.evidence.sitemapEntries(r.url),
          ctx.evidence.page(r.url),
          ctx.evidence.robots(origin),
          ...value.evidence,
        ],
        fix: {
          kind: 'text',
          body: `Allow ${r.url} in robots.txt if it should be indexed; otherwise remove it from the sitemap.`,
        },
      };
    });
  },
};
