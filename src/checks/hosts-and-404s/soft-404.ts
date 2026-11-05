import { MISSING_PAGE_PATH } from '../../connectors/crawler/urls.js';
import { clicksAtStake, clicksPhrase, noValue, threshold } from '../helpers.js';
import type { CheckDefinition, FindingDraft } from '../types.js';

/** Wording that says a page is missing. */
const NOT_FOUND =
  /\b(404|not found|page (?:does not|doesn['’]t) exist|no longer (?:available|exists))\b/i;

export const soft404: CheckDefinition = {
  id: 'hosts-and-404s.soft-404',
  version: 1,
  title: 'Soft 404: a missing page that answers 200',
  category: 'hosts-and-404s',
  label: 'judgement',
  requires: ['crawl'],
  severityFloor: false,
  defaults: { expectedYield: 0.3, effortHours: 0.5, certainty: 0.6 },
  thresholds: { siteWideCertainty: 0.9, sameAsMissingCertainty: 0.8 },
  description:
    'A page says it is missing but returns 200 OK. Search engines call this a soft 404: they waste crawling on it and may treat real pages that look like it as missing too. Missing pages should return 404 or 410.',
  run(ctx) {
    const origin = new URL(ctx.config.siteUrl).origin;
    const probe = ctx.db.get<{ url: string; status: number | null; bodyHash: string | null }>(
      `SELECT p.url, p.status, p.body_hash AS bodyHash
         FROM crawl_queue q JOIN pages p ON p.crawl_id = q.crawl_id AND p.url = q.url
        WHERE q.crawl_id = ? AND q.source = 'probe' AND q.url LIKE ?`,
      [ctx.snapshot.crawlId, `${origin}${MISSING_PAGE_PATH}%`],
    );
    const findings: FindingDraft[] = [];
    const missingAnswers200 = probe?.status === 200;

    if (probe && missingAnswers200) {
      findings.push({
        key: 'missing-pages-return-200',
        urls: [probe.url],
        summary: `Missing pages return 200: the made-up URL ${probe.url} answered 200 instead of 404.`,
        reasoning: `The crawler requested ${probe.url}, a URL that cannot exist on the site, and got status 200. So every mistyped or deleted URL looks like a real page to search engines.`,
        valueAtStake: noValue,
        certainty: threshold(ctx, 'siteWideCertainty'),
        evidence: [ctx.evidence.page(probe.url)],
        fix: {
          kind: 'text',
          body: 'Configure the server or CMS to return status 404 (or 410) for URLs that have no page.',
        },
      });
    }

    const pages = ctx.db.all<{
      url: string;
      title: string | null;
      h1: string | null;
      bodyHash: string | null;
    }>(
      `SELECT url, title, h1, body_hash AS bodyHash FROM pages
        WHERE crawl_id = ? AND status = 200 AND url LIKE ? AND url NOT LIKE ?
        ORDER BY url`,
      [ctx.snapshot.crawlId, `${origin}/%`, `${origin}${MISSING_PAGE_PATH}%`],
    );
    for (const page of pages) {
      const sameAsMissing =
        missingAnswers200 && page.bodyHash !== null && page.bodyHash === probe?.bodyHash;
      const wording = [page.title, page.h1].find((text) => text && NOT_FOUND.test(text));
      if (!sameAsMissing && !wording) continue;

      const reasons = [
        sameAsMissing
          ? `its content is byte-for-byte the same as the response to the made-up URL ${probe!.url}`
          : '',
        wording ? `its ${wording === page.title ? 'title' : 'H1'} says "${wording}"` : '',
      ].filter(Boolean);
      const value = clicksAtStake(ctx, [page.url]);
      findings.push({
        key: ctx.db.normaliseUrl(page.url),
        urls: [page.url],
        summary: `${page.url} looks like a missing page but returns 200.${clicksPhrase(value.valueAtStake)}`,
        reasoning: `The page returns 200, yet ${reasons.join(', and ')}.`,
        valueAtStake: value.valueAtStake,
        certainty: sameAsMissing ? threshold(ctx, 'sameAsMissingCertainty') : undefined,
        evidence: [
          ctx.evidence.page(page.url),
          ...(sameAsMissing ? [ctx.evidence.page(probe!.url)] : []),
          ...value.evidence,
        ],
        fix: {
          kind: 'text',
          body: `If ${page.url} has no real content, make it return 404 or 410. If it is a real page, change the wording that makes it look missing.`,
        },
      });
    }
    return findings;
  },
};
