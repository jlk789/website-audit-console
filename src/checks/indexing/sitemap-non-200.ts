import { noValue } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const sitemapNon200: CheckDefinition = {
  id: 'indexing.sitemap-non-200',
  version: 1,
  title: 'Sitemap lists a URL that redirects or errors',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.1, effortHours: 0.1, certainty: 0.95 },
  thresholds: {},
  description:
    'A sitemap lists a URL that redirects, returns an error or could not be loaded. Sitemaps should list only the final, working URLs you want indexed; stale entries waste crawling and make search engines trust the sitemap less.',
  run(ctx) {
    // URLs blocked by robots.txt have their own check (indexing.sitemap-url-robots-blocked).
    const rows = ctx.db.all<{ url: string; status: number | null; error: string | null }>(
      `SELECT DISTINCT s.url, p.status, p.fetch_error AS error
         FROM sitemap_urls s
         JOIN pages p ON p.crawl_id = s.crawl_id AND p.url = s.url
        WHERE s.crawl_id = ? AND p.robots_blocked = 0 AND (p.status IS NULL OR p.status <> 200)
        ORDER BY s.url`,
      [ctx.snapshot.crawlId],
    );
    return rows.map((r): FindingDraft => {
      const what =
        r.status === null
          ? `could not be loaded (${r.error})`
          : r.status >= 300 && r.status < 400
            ? `redirects (${r.status})`
            : `returns ${r.status}`;
      return {
        key: ctx.db.normaliseUrl(r.url),
        urls: [r.url],
        summary: `The sitemap lists ${r.url}, which ${what}.`,
        valueAtStake: noValue,
        evidence: [ctx.evidence.sitemapEntries(r.url), ctx.evidence.page(r.url)],
        fix: {
          kind: 'text',
          body: `Remove ${r.url} from the sitemap, or replace it with the URL it ends up at.`,
        },
      };
    });
  },
};
