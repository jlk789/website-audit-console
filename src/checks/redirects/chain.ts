import { clicksAtStake, clicksPhrase, redirectChains, threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const chain: CheckDefinition = {
  id: 'redirects.chain',
  version: 1,
  title: 'Redirect chain',
  category: 'redirects',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.05, effortHours: 0.25, certainty: 0.95 },
  thresholds: { minHops: 2 },
  description:
    'A URL redirects more than once before reaching a page. Each hop slows visitors and crawlers, and search engines may stop following long chains. Point the first URL straight at the final one.',
  run(ctx) {
    const minHops = threshold(ctx, 'minHops');
    return redirectChains(ctx)
      .filter((c) => c.hops >= minHops && c.stopped !== 'redirect loop' && c.target)
      .map((c): FindingDraft => {
        const value = clicksAtStake(ctx, [c.url]);
        return {
          key: ctx.db.normaliseUrl(c.url),
          urls: [c.url, c.target!],
          summary: `${c.url} redirects ${c.hops} times before reaching ${c.target}.${clicksPhrase(value.valueAtStake)}`,
          valueAtStake: value.valueAtStake,
          evidence: [ctx.evidence.redirect(c.url), ...value.evidence],
          // Only suggest a redirect to a target that answers.
          fix:
            c.finalStatus === 200
              ? { kind: 'redirect-map', rows: [{ from: c.url, to: c.target!, status: 301 }] }
              : undefined,
        };
      });
  },
};
