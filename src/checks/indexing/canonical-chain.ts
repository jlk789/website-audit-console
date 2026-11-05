import { clicksAtStake, clicksPhrase, htmlPages } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const canonicalChain: CheckDefinition = {
  id: 'indexing.canonical-chain',
  version: 1,
  title: 'Canonical chain',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.2, effortHours: 0.25, certainty: 0.9 },
  thresholds: {},
  description:
    "Page A's canonical points at B, but B's canonical points somewhere else again. Search engines may not follow the chain and can pick the wrong version. Point A straight at the final URL.",
  run(ctx) {
    const pages = htmlPages(ctx);
    const canonicalOf = new Map(pages.map((p) => [p.url, p.canonical]));
    const findings: FindingDraft[] = [];

    for (const page of pages) {
      const middle = page.canonical;
      if (!middle || middle === page.url) continue;
      const end = canonicalOf.get(middle);
      if (!end || end === middle) continue;

      const value = clicksAtStake(ctx, [page.url]);
      findings.push({
        key: ctx.db.normaliseUrl(page.url),
        urls: [page.url, middle, end],
        summary: `${page.url} has a canonical pointing at ${middle}, whose own canonical points at ${end}.${clicksPhrase(value.valueAtStake)}`,
        valueAtStake: value.valueAtStake,
        evidence: [ctx.evidence.page(page.url), ctx.evidence.page(middle), ...value.evidence],
        fix: {
          kind: 'text',
          body: `Point the canonical on ${page.url} directly at the URL you want indexed${end === page.url ? ' (the two pages currently point at each other)' : `, probably ${end}`}.`,
        },
      });
    }
    return findings;
  },
};
