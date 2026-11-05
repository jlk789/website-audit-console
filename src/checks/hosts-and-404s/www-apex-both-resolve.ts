import { hostVariants } from '../../connectors/crawler/urls.js';
import { noValue } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const wwwApexBothResolve: CheckDefinition = {
  id: 'hosts-and-404s.www-apex-both-resolve',
  version: 1,
  title: 'Both www and non-www hosts serve the site',
  category: 'hosts-and-404s',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.1, effortHours: 0.5, certainty: 0.9 },
  thresholds: {},
  description:
    'The site answers on both www and non-www (for example example.com and www.example.com) without one redirecting to the other, so search engines see two copies. Redirect the other host to the one you use with a 301.',
  run(ctx) {
    const site = new URL(ctx.config.siteUrl);
    const home = `${site.origin}/`;
    // The homepage on the other host, same scheme.
    const other = hostVariants(ctx.config.siteUrl).find(
      (url) => url.startsWith(site.protocol) && new URL(url).host !== site.host,
    );
    if (!other) return [];

    const page = ctx.db.get<{ status: number | null }>(
      'SELECT status FROM pages WHERE crawl_id = ? AND url = ?',
      [ctx.snapshot.crawlId, other],
    );
    if (!page?.status || page.status < 200 || page.status >= 300) return [];
    const finding: FindingDraft = {
      key: ctx.db.normaliseUrl(other),
      urls: [other, home],
      summary: `${other} returns ${page.status} instead of redirecting to ${home}.`,
      valueAtStake: noValue,
      evidence: [ctx.evidence.page(other)],
      fix: { kind: 'redirect-map', rows: [{ from: other, to: home, status: 301 }] },
    };
    return [finding];
  },
};
