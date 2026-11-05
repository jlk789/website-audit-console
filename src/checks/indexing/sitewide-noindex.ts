import { saysNoindex } from '../../connectors/crawler/parse.js';
import {
  clicksAtStake,
  html200CountEvidence,
  htmlPages,
  pagesEvidence,
  threshold,
} from '../helpers.js';
import type { CheckDefinition } from '../types.js';

export const sitewideNoindex: CheckDefinition = {
  id: 'indexing.sitewide-noindex',
  version: 1,
  title: 'Site-wide noindex',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: true,
  defaults: { expectedYield: 0.9, effortHours: 1, certainty: 0.95 },
  thresholds: { minShare: 0.5, minPages: 3 },
  description:
    'The homepage, or most of the site, tells search engines not to index it (a robots meta tag or X-Robots-Tag header saying noindex). This often happens when a staging setting reaches the live site. Pages marked noindex drop out of search results.',
  run(ctx) {
    const pages = htmlPages(ctx);
    const noindexed = pages
      .filter((p) => saysNoindex(p.metaRobots, p.xRobotsTag))
      .map((p) => p.url);
    const home = new URL('/', ctx.config.siteUrl).href;
    const homeNoindex = noindexed.includes(home);
    const share = pages.length > 0 ? noindexed.length / pages.length : 0;
    const widespread =
      pages.length >= threshold(ctx, 'minPages') && share >= threshold(ctx, 'minShare');
    if (!homeNoindex && !widespread) return [];

    const value = clicksAtStake(ctx, noindexed);
    return [
      {
        key: 'site',
        urls: noindexed,
        summary:
          `${noindexed.length} of ${pages.length} crawled pages (${Math.round(share * 100)}%) are marked noindex` +
          `${homeNoindex ? ', including the homepage' : ''}.`,
        valueAtStake: value.valueAtStake,
        evidence: [
          pagesEvidence(ctx, noindexed, 'Crawled pages marked noindex'),
          html200CountEvidence(ctx),
          ...value.evidence,
        ],
        fix: {
          kind: 'text',
          body: 'Remove the noindex robots meta tag or X-Robots-Tag header from pages that should appear in search. Check for a "discourage search engines" or staging setting in your CMS or hosting.',
        },
      },
    ];
  },
};
