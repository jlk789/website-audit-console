import { clicksAtStake, clicksPhrase, redirectChains } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const deepToHomepage: CheckDefinition = {
  id: 'redirects.deep-to-homepage',
  version: 1,
  title: 'Deep page redirected to the homepage',
  category: 'redirects',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 0.5, certainty: 0.9 },
  thresholds: {},
  description:
    'A page other than the homepage redirects to the homepage. Google usually treats this as a soft 404, so the old page passes on none of its value. Redirect to the closest matching page instead, or return 404 or 410 if there is none.',
  run(ctx) {
    const home = ctx.db.normaliseUrl(new URL('/', ctx.config.siteUrl).href);
    return redirectChains(ctx)
      .filter((c) => c.target && ctx.db.normaliseUrl(c.target) === home)
      .filter((c) => new URL(c.url).pathname !== '/')
      .map((c): FindingDraft => {
        const value = clicksAtStake(ctx, [c.url]);
        return {
          key: ctx.db.normaliseUrl(c.url),
          urls: [c.url, c.target!],
          summary: `${c.url} redirects to the homepage.${clicksPhrase(value.valueAtStake)}`,
          valueAtStake: value.valueAtStake,
          evidence: [ctx.evidence.redirect(c.url), ...value.evidence],
          fix: {
            kind: 'text',
            body: `Redirect ${c.url} to the page that best replaces it. If nothing does, let it return 404 or 410.`,
          },
        };
      });
  },
};
