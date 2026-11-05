import { clicksAtStake, clicksPhrase, redirectChains } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const loop: CheckDefinition = {
  id: 'redirects.loop',
  version: 1,
  title: 'Redirect loop',
  category: 'redirects',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.5, effortHours: 0.5, certainty: 1 },
  thresholds: {},
  description:
    'A URL redirects in a circle and never reaches a page, so neither visitors nor search engines can load it. Change one of the redirects to point at a page that answers.',
  run(ctx) {
    return redirectChains(ctx)
      .filter((c) => c.stopped === 'redirect loop')
      .map((c): FindingDraft => {
        const value = clicksAtStake(ctx, [c.url]);
        return {
          key: ctx.db.normaliseUrl(c.url),
          urls: [c.url],
          summary: `${c.url} redirects in a loop (after ${c.hops} hops it points back to ${c.target}) and never reaches a page.${clicksPhrase(value.valueAtStake)}`,
          valueAtStake: value.valueAtStake,
          evidence: [ctx.evidence.page(c.url), ctx.evidence.redirect(c.url), ...value.evidence],
          fix: {
            kind: 'text',
            body: `Change the redirects in this loop so that ${c.url} ends on a page that returns 200, or returns 404 or 410 if the content is gone.`,
          },
        };
      });
  },
};
