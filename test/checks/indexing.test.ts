import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checks } from '../../src/checks/index.js';
import { readConfig, writeConfig } from '../../src/config/load.js';
import { configPath } from '../../src/config/paths.js';
import type { AuditResult } from '../../src/engine/store.js';
import { auditHome, type GscRow } from '../helpers/audit-home.js';
import type { WebRoutes } from '../helpers/fake-web.js';
import {
  allToOneSite,
  brokenGsc,
  brokenSite,
  cleanGsc,
  cleanSite,
  collapseGsc,
  disallowAllSite,
  LATEST,
  noindexSite,
  robotsErrorSite,
  S,
  SITE,
} from '../fixtures/sites/indexing.js';

// Small fixture sites: index-bloat-ratio needs only 5 indexable pages and a 3-to-1 ratio here.
const bloatOverride = { 'indexing.index-bloat-ratio': { minIndexablePages: 5, maxRatio: 3 } };

/** Sets up a site, seeds Search Console, crawls it (if routes are given) and audits it. */
async function audited(routes: WebRoutes | undefined, gsc: GscRow[]) {
  const site = auditHome(SITE);
  const file = configPath(site.home);
  writeConfig(file, { ...readConfig(file), checks: bloatOverride });
  site.seedGsc(gsc, LATEST);
  if (routes) await site.crawl(routes);
  return { site, result: await site.audit() };
}

type Fixture =
  'broken' | 'clean' | 'noindex' | 'disallow' | 'robotsError' | 'allToOne' | 'collapse' | 'steady';

/** Each check, the fixture that must trigger it, and the keys it must find there. */
const expected: Record<string, { on: Fixture[]; keys: string[] }> = {
  'indexing.sitewide-noindex': { on: ['noindex'], keys: ['site'] },
  'indexing.robots-blocks-site': { on: ['disallow', 'robotsError'], keys: ['site'] },
  'indexing.canonical-all-to-one': { on: ['allToOne'], keys: ['site'] },
  'indexing.indexed-pages-collapse': { on: ['collapse'], keys: ['site'] },
  'indexing.noindex-with-clicks': { on: ['broken'], keys: [`${S}/noindexed`] },
  'indexing.canonical-to-non-200': { on: ['broken'], keys: [`${S}/canon-broken`] },
  'indexing.canonicalised-away-with-clicks': { on: ['broken'], keys: [`${S}/canon-away`] },
  'indexing.canonical-chain': { on: ['broken'], keys: [`${S}/chain-a`] },
  'indexing.missing-canonical': { on: ['broken'], keys: [`${S}/no-canonical`] },
  'indexing.sitemap-non-200': { on: ['broken'], keys: [`${S}/redirected`, `${S}/gone`] },
  'indexing.sitemap-non-indexable': { on: ['broken'], keys: [`${S}/noindexed`, `${S}/canon-away`] },
  'indexing.indexable-not-in-sitemap': {
    on: ['broken'],
    keys: [`${S}/not-in-sitemap`, `${S}/tags/`, `${S}/tags/a/`],
  },
  'indexing.sitemap-url-robots-blocked': { on: ['broken'], keys: [`${S}/private/page`] },
  'indexing.index-bloat-ratio': { on: ['broken'], keys: ['site'] },
};

describe('indexing checks', () => {
  const runs = {} as Record<Fixture, Awaited<ReturnType<typeof audited>>>;
  const results = (fixture: Fixture): AuditResult => runs[fixture].result;

  beforeAll(async () => {
    runs.broken = await audited(brokenSite, brokenGsc);
    runs.clean = await audited(cleanSite, cleanGsc);
    runs.noindex = await audited(noindexSite, []);
    runs.disallow = await audited(disallowAllSite, []);
    runs.robotsError = await audited(robotsErrorSite, []);
    runs.allToOne = await audited(allToOneSite, []);
    runs.collapse = await audited(undefined, collapseGsc(false));
    runs.steady = await audited(undefined, collapseGsc(true));
  });
  afterAll(() => {
    for (const run of Object.values(runs)) run.site.cleanup();
  });

  it('covers every registered indexing check', () => {
    const ids = checks.map((c) => c.id).filter((id) => id.startsWith('indexing.'));
    expect(Object.keys(expected).sort()).toEqual(ids.sort());
  });

  it('has no failing checks on any fixture', () => {
    for (const [fixture, run] of Object.entries(runs)) {
      expect(run.result.errors, fixture).toEqual([]);
    }
  });

  for (const [checkId, { on, keys }] of Object.entries(expected)) {
    describe(checkId, () => {
      it('fires on its broken fixture', () => {
        for (const fixture of on) {
          const found = results(fixture).findings.filter((f) => f.checkId === checkId);
          expect(
            found.map((f) => f.key),
            fixture,
          ).toEqual(expect.arrayContaining(keys));
        }
      });

      it('stays quiet on the clean site', () => {
        expect(results('clean').findings.filter((f) => f.checkId === checkId)).toEqual([]);
        expect(results('steady').findings.filter((f) => f.checkId === checkId)).toEqual([]);
      });

      it('backs every finding with evidence that returns rows', () => {
        for (const fixture of on) {
          for (const f of results(fixture).findings.filter((f) => f.checkId === checkId)) {
            expect(
              runs[fixture].site.evidenceRows(f).every((rows) => rows > 0),
              f.key,
            ).toBe(true);
          }
        }
      });
    });
  }

  it('lists severity-floor findings first', () => {
    const findings = results('noindex').findings;
    expect(findings[0]).toMatchObject({
      checkId: 'indexing.sitewide-noindex',
      severityFloor: true,
    });
    expect(findings[0]?.summary).toContain('including the homepage');
  });

  it('judges robots.txt as Googlebot would, and explains a server error', () => {
    const blocked = results('disallow').findings.find(
      (f) => f.checkId === 'indexing.robots-blocks-site',
    );
    expect(blocked?.summary).toMatch(/blocks Googlebot from the homepage/);
    const error = results('robotsError').findings.find(
      (f) => f.checkId === 'indexing.robots-blocks-site',
    );
    expect(error?.summary).toMatch(/returns 503, so Google treats the whole site as blocked/);
    expect(error?.certainty).toBe(0.8);
  });

  it('measures the collapse from weekly page counts', () => {
    const collapse = results('collapse').findings.find(
      (f) => f.checkId === 'indexing.indexed-pages-collapse',
    );
    expect(collapse?.summary).toMatch(
      /^Only 3 pages earned search impressions .* down 85% from an average of 20/,
    );
  });

  it('groups pages missing from one sitemap section into one shared fix', () => {
    const groups = Object.fromEntries(
      results('broken')
        .findings.filter((f) => f.checkId === 'indexing.indexable-not-in-sitemap')
        .map((f) => [f.key, f.fixGroup]),
    );
    expect(groups[`${S}/tags/`]).toBe('Add the /tags/ section to the sitemap');
    expect(groups[`${S}/tags/a/`]).toBe('Add the /tags/ section to the sitemap');
    // Alone in its section: fixed on its own.
    expect(groups[`${S}/not-in-sitemap`]).toBeNull();
  });

  it('applies the config override to index-bloat-ratio', () => {
    const bloat = results('broken').findings.find(
      (f) => f.checkId === 'indexing.index-bloat-ratio',
    );
    expect(bloat?.summary).toMatch(
      /^9 pages are indexable, but only 2 earned a click .* \(4\.5 to 1\)\.$/,
    );
  });
});
