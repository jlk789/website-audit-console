import { saysNoindex } from '../../connectors/crawler/parse.js';
import { clicksAtStake, htmlPages, threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const noindexWithClicks: CheckDefinition = {
  id: 'indexing.noindex-with-clicks',
  version: 1,
  title: 'Noindex page that still earns clicks',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl', 'gsc'],
  severityFloor: false,
  defaults: { expectedYield: 0.8, effortHours: 0.25, certainty: 0.85 },
  thresholds: { minClicks: 1 },
  description:
    'A page marked noindex still earned search clicks recently, so the noindex is new or Google has not yet acted on it. Once it does, those clicks stop. If the page should be found in search, remove the noindex.',
  run(ctx) {
    const minClicks = threshold(ctx, 'minClicks');
    return htmlPages(ctx)
      .filter((p) => saysNoindex(p.metaRobots, p.xRobotsTag))
      .map((p) => ({ page: p, value: clicksAtStake(ctx, [p.url]) }))
      .filter(({ value }) => value.valueAtStake.amount >= minClicks)
      .map(({ page, value }): FindingDraft => ({
        key: ctx.db.normaliseUrl(page.url),
        urls: [page.url],
        summary: `${page.url} is marked noindex but earned ${value.valueAtStake.amount} clicks in the last 28 days.`,
        valueAtStake: value.valueAtStake,
        evidence: [ctx.evidence.page(page.url), ...value.evidence],
        fix: {
          kind: 'text',
          body: `If ${page.url} should appear in search, remove its noindex (robots meta tag: "${page.metaRobots ?? ''}", X-Robots-Tag: "${page.xRobotsTag ?? ''}").`,
        },
      }));
  },
};
