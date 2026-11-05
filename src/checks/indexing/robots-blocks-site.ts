import { isAllowed, parseRobots } from '../../connectors/crawler/robots.js';
import { siteClicksAtStake, threshold } from '../helpers.js';
import type { CheckDefinition } from '../types.js';

export const robotsBlocksSite: CheckDefinition = {
  id: 'indexing.robots-blocks-site',
  version: 1,
  title: 'robots.txt blocks the site',
  category: 'indexing',
  label: 'deterministic',
  requires: ['crawl'],
  severityFloor: true,
  defaults: { expectedYield: 0.9, effortHours: 0.5, certainty: 1 },
  thresholds: { serverErrorCertainty: 0.8 },
  description:
    "robots.txt stops Googlebot from crawling the homepage, or robots.txt itself answers with a server error, which makes Google treat the whole site as blocked. Pages Google can't crawl fall out of search over time.",
  run(ctx) {
    const origin = new URL(ctx.config.siteUrl).origin;
    const file = ctx.db.get<{ status: number | null; body: string | null; error: string | null }>(
      'SELECT status, body, fetch_error AS error FROM robots_files WHERE crawl_id = ? AND origin = ?',
      [ctx.snapshot.crawlId, origin],
    );
    if (!file) return [];

    // RFC 9309: a 5xx, a 429 or no answer means "disallow everything".
    const unavailable = file.status === null || file.status === 429 || file.status >= 500;
    const disallowed =
      !unavailable && file.body !== null && !isAllowed(parseRobots(file.body), '/', 'googlebot');
    if (!unavailable && !disallowed) return [];

    const value = siteClicksAtStake(ctx);
    const robotsUrl = `${origin}/robots.txt`;
    return [
      {
        key: 'site',
        urls: [robotsUrl],
        summary: unavailable
          ? `${robotsUrl} ${file.status === null ? `could not be fetched (${file.error})` : `returns ${file.status}`}, so Google treats the whole site as blocked.`
          : `${robotsUrl} blocks Googlebot from the homepage.`,
        valueAtStake: value.valueAtStake,
        certainty: unavailable ? threshold(ctx, 'serverErrorCertainty') : undefined,
        evidence: [ctx.evidence.robots(origin), ...value.evidence],
        fix: {
          kind: 'text',
          body: unavailable
            ? 'Make robots.txt return 200 (or 404 if you have no rules). A server error on robots.txt stops Google crawling the whole site.'
            : 'Remove or narrow the Disallow rule that matches "/" for Googlebot (often "Disallow: /" left over from a staging site).',
        },
      },
    ];
  },
};
