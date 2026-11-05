import { clicksAtStake, htmlPages, threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const canonicalisedAwayWithClicks: CheckDefinition = {
  id: 'indexing.canonicalised-away-with-clicks',
  version: 1,
  title: 'Page canonicalised elsewhere still earns clicks',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl', 'gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.2, effortHours: 0.5, certainty: 0.7 },
  thresholds: { minClicks: 1 },
  description:
    'A page points its canonical at another URL, yet Search Console still credits it with clicks. Either Google is ignoring the canonical (the pages may not be true duplicates), or the canonical is new. Check that the canonical is intended; if this page is the better one, make it canonical to itself.',
  run(ctx) {
    const minClicks = threshold(ctx, 'minClicks');
    return htmlPages(ctx)
      .filter((p) => p.canonical && p.canonical !== p.url)
      .map((p) => ({ page: p, value: clicksAtStake(ctx, [p.url]) }))
      .filter(({ value }) => value.valueAtStake.amount >= minClicks)
      .map(({ page, value }): FindingDraft => ({
        key: ctx.db.normaliseUrl(page.url),
        urls: [page.url, page.canonical!],
        summary: `${page.url} points its canonical at ${page.canonical} but earned ${value.valueAtStake.amount} clicks in the last 28 days.`,
        valueAtStake: value.valueAtStake,
        evidence: [ctx.evidence.page(page.url), ...value.evidence],
        fix: {
          kind: 'text',
          body: `Confirm ${page.url} really duplicates ${page.canonical}. If it doesn't, make its canonical point at itself.`,
        },
      }));
  },
};
