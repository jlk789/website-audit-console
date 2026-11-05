import { clicksAtStake, clicksPhrase, redirectChains } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const toError: CheckDefinition = {
  id: 'redirects.to-error',
  version: 1,
  title: 'Redirect to an error page',
  category: 'redirects',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.5, effortHours: 0.25, certainty: 0.95 },
  thresholds: {},
  description:
    'A URL redirects to a page that returns an error (4xx or 5xx), so the redirect leads nowhere. Point it at a page that works.',
  run(ctx) {
    return redirectChains(ctx)
      .filter((c) => c.target && c.finalStatus !== null && c.finalStatus >= 400)
      .map((c): FindingDraft => {
        const value = clicksAtStake(ctx, [c.url]);
        return {
          key: ctx.db.normaliseUrl(c.url),
          urls: [c.url, c.target!],
          summary: `${c.url} redirects to ${c.target}, which returns ${c.finalStatus}.${clicksPhrase(value.valueAtStake)}`,
          valueAtStake: value.valueAtStake,
          evidence: [ctx.evidence.redirect(c.url), ctx.evidence.page(c.target!), ...value.evidence],
          fix: {
            kind: 'text',
            body: `Redirect ${c.url} to a page that returns 200, or remove the redirect and let it return 404 or 410.`,
          },
        };
      });
  },
};
