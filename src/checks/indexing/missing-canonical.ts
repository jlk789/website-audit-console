import { clicksAtStake, clicksPhrase, htmlPages } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const missingCanonical: CheckDefinition = {
  id: 'indexing.missing-canonical',
  version: 1,
  title: 'Indexable page without a canonical tag',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.05, effortHours: 0.1, certainty: 0.9 },
  thresholds: {},
  description:
    "An indexable page has no canonical tag. Without one, search engines guess which URL to index when the page is reachable more than one way (tracking parameters, trailing slashes, http and https). A canonical tag pointing at the page's own URL removes the guesswork.",
  run(ctx) {
    return htmlPages(ctx)
      .filter((p) => p.indexable === 1 && !p.canonical)
      .map((p): FindingDraft => {
        const value = clicksAtStake(ctx, [p.url]);
        return {
          key: ctx.db.normaliseUrl(p.url),
          urls: [p.url],
          summary: `${p.url} has no canonical tag.${clicksPhrase(value.valueAtStake)}`,
          valueAtStake: value.valueAtStake,
          evidence: [ctx.evidence.page(p.url), ...value.evidence],
          fix: {
            kind: 'text',
            body: `Add <link rel="canonical" href="${p.url}"> to the page's <head>.`,
          },
        };
      });
  },
};
