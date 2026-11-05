import { saysNoindex } from '../../connectors/crawler/parse.js';
import { noValue } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const sitemapNonIndexable: CheckDefinition = {
  id: 'indexing.sitemap-non-indexable',
  version: 1,
  title: 'Sitemap lists a page that is not indexable',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.1, effortHours: 0.1, certainty: 0.9 },
  thresholds: {},
  description:
    'A sitemap lists a page that returns 200 but asks not to be indexed: it is marked noindex, or its canonical points at another URL. The sitemap and the page contradict each other. List only pages you want indexed, or fix the page.',
  run(ctx) {
    const rows = ctx.db.all<{
      url: string;
      metaRobots: string | null;
      xRobotsTag: string | null;
      canonical: string | null;
    }>(
      `SELECT DISTINCT s.url, p.meta_robots AS metaRobots, p.x_robots_tag AS xRobotsTag, p.canonical
         FROM sitemap_urls s
         JOIN pages p ON p.crawl_id = s.crawl_id AND p.url = s.url
        WHERE s.crawl_id = ? AND p.status = 200 AND p.indexable = 0
        ORDER BY s.url`,
      [ctx.snapshot.crawlId],
    );
    return rows.map((r): FindingDraft => {
      const why = saysNoindex(r.metaRobots, r.xRobotsTag)
        ? 'it is marked noindex'
        : r.canonical && r.canonical !== r.url
          ? `its canonical points at ${r.canonical}`
          : 'it is not an HTML page';
      return {
        key: ctx.db.normaliseUrl(r.url),
        urls: [r.url],
        summary: `The sitemap lists ${r.url}, but ${why}.`,
        valueAtStake: noValue,
        evidence: [ctx.evidence.sitemapEntries(r.url), ctx.evidence.page(r.url)],
        fix: {
          kind: 'text',
          body: `Either remove ${r.url} from the sitemap, or make it indexable if it should be found in search.`,
        },
      };
    });
  },
};
