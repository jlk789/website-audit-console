import { hostVariants } from '../../connectors/crawler/urls.js';
import { noValue, redirectChains } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const httpNotRedirected: CheckDefinition = {
  id: 'hosts-and-404s.http-not-redirected',
  version: 1,
  title: 'Plain http not redirected to https',
  category: 'hosts-and-404s',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.1, effortHours: 0.5, certainty: 0.95 },
  thresholds: {},
  description:
    'The site answers on plain http:// instead of redirecting to https://. Visitors get an insecure page, and search engines see two copies of the site. Redirect every http:// URL to its https:// version with a 301.',
  run(ctx) {
    const site = new URL(ctx.config.siteUrl);
    if (site.protocol !== 'https:') return [];
    const chains = new Map(redirectChains(ctx).map((c) => [c.url, c]));
    const findings: FindingDraft[] = [];

    for (const url of hostVariants(ctx.config.siteUrl).filter((u) => u.startsWith('http:'))) {
      const page = ctx.db.get<{ status: number | null }>(
        'SELECT status FROM pages WHERE crawl_id = ? AND url = ?',
        [ctx.snapshot.crawlId, url],
      );
      if (!page || page.status === null) continue;
      const chain = chains.get(url);
      const httpsUrl = `https://${site.host}/`;
      const fix = {
        kind: 'redirect-map' as const,
        rows: [{ from: url, to: httpsUrl, status: 301 as const }],
      };

      if (page.status >= 200 && page.status < 300) {
        findings.push({
          key: ctx.db.normaliseUrl(url),
          urls: [url],
          summary: `${url} returns ${page.status} over plain http instead of redirecting to https.`,
          valueAtStake: noValue,
          evidence: [ctx.evidence.page(url)],
          fix,
        });
      } else if (chain?.target?.startsWith('http:')) {
        findings.push({
          key: ctx.db.normaliseUrl(url),
          urls: [url, chain.target],
          summary: `${url} redirects to ${chain.target}, which is still plain http.`,
          valueAtStake: noValue,
          evidence: [ctx.evidence.redirect(url)],
          fix,
        });
      }
    }
    return findings;
  },
};
