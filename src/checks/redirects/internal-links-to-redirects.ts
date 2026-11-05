import { clicksAtStake, redirectChains, threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

export const internalLinksToRedirects: CheckDefinition = {
  id: 'redirects.internal-links-to-redirects',
  version: 1,
  title: 'Internal links pointing at a redirect',
  category: 'redirects',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.05, effortHours: 0.25, certainty: 0.95 },
  thresholds: { minLinkingPages: 1 },
  description:
    'Your own pages link to a URL that redirects. Every click and every crawl takes an extra hop. Update the links to point straight at the final URL.',
  run(ctx) {
    const crawlId = ctx.snapshot.crawlId;
    const chains = new Map(redirectChains(ctx).map((c) => [c.url, c]));
    const targets = ctx.db.all<{ url: string; status: number; pages: number }>(
      `SELECT l.to_url AS url, s.status, COUNT(DISTINCT l.from_url) AS pages
         FROM links l
         JOIN pages s ON s.crawl_id = l.crawl_id AND s.url = l.to_url
        WHERE l.crawl_id = ? AND s.status BETWEEN 300 AND 399
        GROUP BY l.to_url, s.status
       HAVING pages >= ?
        ORDER BY l.to_url`,
      [crawlId, threshold(ctx, 'minLinkingPages')],
    );

    return targets.map((t): FindingDraft => {
      const final = chains.get(t.url)?.target ?? null;
      const links = ctx.db.all<{ from_url: string; anchor: string | null }>(
        `SELECT DISTINCT from_url, anchor FROM links WHERE crawl_id = ? AND to_url = ? ORDER BY from_url`,
        [crawlId, t.url],
      );
      const value = clicksAtStake(ctx, [t.url]);
      const where = final ? `, which redirects (${t.status}) to ${final}` : ` (${t.status})`;
      return {
        key: ctx.db.normaliseUrl(t.url),
        urls: [t.url, ...(final ? [final] : [])],
        summary: `${t.pages} page${t.pages === 1 ? '' : 's'} on the site link${t.pages === 1 ? 's' : ''} to ${t.url}${where}.`,
        valueAtStake: value.valueAtStake,
        evidence: [ctx.evidence.linksTo(t.url), ctx.evidence.redirect(t.url), ...value.evidence],
        fix: final
          ? {
              kind: 'link-suggestions',
              rows: links.map((l) => ({ from: l.from_url, to: final, anchor: l.anchor ?? '' })),
            }
          : undefined,
      };
    });
  },
};
