import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checks } from '../../src/checks/index.js';
import type { AuditResult } from '../../src/engine/store.js';
import { auditHome } from '../helpers/audit-home.js';
import {
  brokenGsc,
  brokenSite,
  cleanGsc,
  cleanSite,
  LATEST,
  SITE,
} from '../fixtures/sites/redirects-and-hosts.js';

const S = SITE.slice(0, -1);

/** Each check, and keys it must find on the broken site. */
const expected: Record<string, string[]> = {
  'redirects.chain': [`${S}/chain-1`],
  'redirects.loop': [`${S}/loop-a`],
  'redirects.deep-to-homepage': [`${S}/old-product`],
  'redirects.temporary-with-traffic': [`${S}/moved`],
  'redirects.internal-links-to-redirects': [`${S}/chain-1`, `${S}/moved`],
  'redirects.to-error': [`${S}/dead-redirect`],
  'hosts-and-404s.http-not-redirected': ['http://www.example.test/', 'http://example.test/'],
  'hosts-and-404s.www-apex-both-resolve': ['https://example.test/'],
  'hosts-and-404s.trailing-slash-duplicates': [`${S}/dup | ${S}/dup/`],
  'hosts-and-404s.404-with-history': [`${S}/removed/`],
  'hosts-and-404s.soft-404': ['missing-pages-return-200', `${S}/oops`],
  'hosts-and-404s.server-errors': [`${S}/broken`],
};

describe('redirects and hosts-and-404s checks', () => {
  const broken = auditHome(SITE);
  const clean = auditHome(SITE);
  let brokenResult: AuditResult;
  let cleanResult: AuditResult;

  beforeAll(async () => {
    // Search Console first: its pages are among the crawl's starting URLs.
    broken.seedGsc(brokenGsc, LATEST);
    await broken.crawl(brokenSite);
    brokenResult = await broken.audit();
    clean.seedGsc(cleanGsc, LATEST);
    await clean.crawl(cleanSite);
    cleanResult = await clean.audit();
  });
  afterAll(() => {
    broken.cleanup();
    clean.cleanup();
  });

  it('covers every registered check in this group', () => {
    const ids = checks.map((c) => c.id).filter((id) => /^(redirects|hosts-and-404s)\./.test(id));
    expect(Object.keys(expected).sort()).toEqual(ids.sort());
  });

  it('runs every check in this group without skipping or failing', () => {
    expect(brokenResult.errors).toEqual([]);
    expect(cleanResult.errors).toEqual([]);
    const ours = Object.keys(expected);
    expect(brokenResult.skipped.filter((s) => ours.includes(s.checkId))).toEqual([]);
  });

  for (const [checkId, keys] of Object.entries(expected)) {
    describe(checkId, () => {
      it('fires on the broken site', () => {
        const found = brokenResult.findings.filter((f) => f.checkId === checkId).map((f) => f.key);
        expect(found).toEqual(expect.arrayContaining(keys));
      });

      it('stays quiet on the clean site', () => {
        expect(cleanResult.findings.filter((f) => f.checkId === checkId)).toEqual([]);
      });

      it('backs every finding with evidence that returns rows', () => {
        for (const finding of brokenResult.findings.filter((f) => f.checkId === checkId)) {
          expect(
            broken.evidenceRows(finding).every((rows) => rows > 0),
            finding.key,
          ).toBe(true);
        }
      });
    });
  }

  it('suggests the live page that wins the same searches as the redirect target', () => {
    const finding = brokenResult.findings.find(
      (f) => f.checkId === 'hosts-and-404s.404-with-history',
    )!;
    expect(finding.fix).toEqual({
      kind: 'redirect-map',
      rows: [{ from: `${S}/removed/`, to: `${S}/page`, status: 301 }],
    });
    expect(finding.valueBasis).toBe('estimated');
    expect(finding.valueMethod).toMatch(/^9 clicks from 2026-09-01 to 2026-10-28 \(58 days\)/);
  });

  it('reports clicks for the temporary redirect from Search Console', () => {
    const finding = brokenResult.findings.find(
      (f) => f.checkId === 'redirects.temporary-with-traffic',
    )!;
    expect(finding).toMatchObject({ valueMetric: 'clicks', valueAmount: 12 });
    expect(finding.summary).toContain('earned 12 clicks');
  });

  it('explains its reasoning for judgement findings', () => {
    for (const f of brokenResult.findings.filter((f) => f.checkId === 'hosts-and-404s.soft-404')) {
      expect(f.reasoning).toBeTruthy();
    }
  });
});
