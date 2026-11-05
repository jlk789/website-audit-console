import {
  clicksAtStake,
  html200CountEvidence,
  htmlPages,
  pagesEvidence,
  threshold,
} from '../helpers.js';
import type { CheckDefinition } from '../types.js';

export const canonicalAllToOne: CheckDefinition = {
  id: 'indexing.canonical-all-to-one',
  version: 1,
  title: 'Every page canonicalised to one URL',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: true,
  defaults: { expectedYield: 0.9, effortHours: 1, certainty: 0.95 },
  thresholds: { minShare: 0.8, minPages: 5 },
  description:
    'Most pages point their canonical tag at the same single URL, usually the homepage, often because a template hard-codes it. Search engines then treat every page as a copy of that one and drop the rest from results.',
  run(ctx) {
    const pages = htmlPages(ctx);
    const away = pages.filter((p) => p.canonical && p.canonical !== p.url);
    const byTarget = new Map<string, string[]>();
    for (const p of away)
      byTarget.set(p.canonical!, [...(byTarget.get(p.canonical!) ?? []), p.url]);
    const [target, urls] = [...byTarget].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
    if (!target || !urls) return [];

    const share = urls.length / pages.length;
    if (pages.length < threshold(ctx, 'minPages') || share < threshold(ctx, 'minShare')) return [];
    const value = clicksAtStake(ctx, urls);
    return [
      {
        key: 'site',
        urls: [target, ...urls],
        summary: `${urls.length} of ${pages.length} crawled pages (${Math.round(share * 100)}%) point their canonical at ${target}.`,
        valueAtStake: value.valueAtStake,
        evidence: [
          pagesEvidence(ctx, urls, `Crawled pages with canonical ${target}`),
          html200CountEvidence(ctx),
          ...value.evidence,
        ],
        fix: {
          kind: 'text',
          body: "Make each page's canonical tag point at its own URL (or remove it). Look for a hard-coded canonical in the page template.",
        },
      },
    ];
  },
};
