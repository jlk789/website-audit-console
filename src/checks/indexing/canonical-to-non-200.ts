import { clicksAtStake, clicksPhrase, htmlPages } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const canonicalToNon200: CheckDefinition = {
  id: 'indexing.canonical-to-non-200',
  version: 1,
  title: 'Canonical points at a redirect, error or blocked page',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 0.25, certainty: 0.9 },
  thresholds: {},
  description:
    "A page's canonical tag points at a URL that redirects, returns an error or is blocked by robots.txt. Search engines ignore a canonical like that and pick a version themselves. Point the canonical at the final, working URL.",
  run(ctx) {
    const findings: FindingDraft[] = [];
    for (const page of htmlPages(ctx)) {
      if (!page.canonical || page.canonical === page.url) continue;
      // Canonical targets on the site are crawled; one off the site has no row and is skipped.
      const target = ctx.db.get<{
        status: number | null;
        blocked: number | null;
        error: string | null;
      }>(
        `SELECT status, robots_blocked AS blocked, fetch_error AS error FROM pages
          WHERE crawl_id = ? AND url = ?`,
        [ctx.snapshot.crawlId, page.canonical],
      );
      if (!target || target.status === 200) continue;

      const redirects = target.status !== null && target.status >= 300 && target.status < 400;
      const what = target.blocked
        ? 'is blocked by robots.txt'
        : target.status === null
          ? `could not be loaded (${target.error})`
          : redirects
            ? `redirects (${target.status})`
            : `returns ${target.status}`;
      const value = clicksAtStake(ctx, [page.url]);
      findings.push({
        key: ctx.db.normaliseUrl(page.url),
        urls: [page.url, page.canonical],
        summary: `${page.url} has a canonical pointing at ${page.canonical}, which ${what}.${clicksPhrase(value.valueAtStake)}`,
        valueAtStake: value.valueAtStake,
        evidence: [
          ctx.evidence.page(page.url),
          ctx.evidence.page(page.canonical),
          ...(redirects ? [ctx.evidence.redirect(page.canonical)] : []),
          ...value.evidence,
        ],
        fix: {
          kind: 'text',
          body: `Change the canonical on ${page.url} to the final URL that returns 200 (often ${page.url} itself).`,
        },
      });
    }
    return findings;
  },
};
