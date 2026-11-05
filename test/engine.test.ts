import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SkipCheck,
  type CheckContext,
  type CheckDefinition,
  type FindingDraft,
} from '../src/checks/types.js';
import { readConfig, writeConfig } from '../src/config/load.js';
import { configPath } from '../src/config/paths.js';
import { compareFindings, type Scored } from '../src/engine/rank.js';
import { UserError } from '../src/errors.js';
import { auditHome } from './helpers/audit-home.js';

/** A finding with evidence that always returns a row. */
const draft = (key: string, extra: Partial<FindingDraft> = {}): FindingDraft => ({
  key,
  urls: [`https://example.com/${key}`],
  summary: `Finding ${key}`,
  valueAtStake: { metric: 'none', amount: 0, basis: 'observed' },
  evidence: [{ table: 'none', sql: 'SELECT 1 AS one', params: [], label: 'always one row' }],
  ...extra,
});

/** A check that returns whatever `output()` says. */
const fakeCheck = (
  id: string,
  output: (ctx: CheckContext) => FindingDraft[],
  extra: Partial<CheckDefinition> = {},
): CheckDefinition => ({
  id,
  version: 1,
  title: id,
  category: 'redirects',
  label: 'deterministic',
  requires: [],
  severityFloor: false,
  defaults: { expectedYield: 0.5, effortHours: 1, certainty: 1 },
  thresholds: {},
  description: id,
  run: output,
  ...extra,
});

describe('audit engine', () => {
  let site: ReturnType<typeof auditHome>;
  beforeEach(() => {
    site = auditHome('https://example.com/');
  });
  afterEach(() => site.cleanup());

  it('skips a check whose data is missing, saying why', async () => {
    const result = await site.audit([
      fakeCheck('redirects.needs-crawl', () => [draft('a')], { requires: ['crawl'] }),
      fakeCheck('redirects.needs-nothing', () => [draft('b')]),
    ]);
    expect(result.skipped).toEqual([
      {
        checkId: 'redirects.needs-crawl',
        reason: expect.stringMatching(/^crawl: no finished crawl/),
      },
    ]);
    expect(result.findings.map((f) => f.key)).toEqual(['b']);
  });

  it('reports a failing check and still runs the others', async () => {
    const result = await site.audit([
      fakeCheck('redirects.throws', () => {
        throw new Error('boom');
      }),
      fakeCheck('redirects.fine', () => [draft('ok')]),
    ]);
    expect(result.errors).toEqual([{ checkId: 'redirects.throws', reason: 'boom' }]);
    expect(result.findings).toHaveLength(1);
  });

  it('gives checks a database they cannot write to', async () => {
    const result = await site.audit([
      fakeCheck('redirects.writer', (ctx) => {
        ctx.db.all(`UPDATE properties SET site_url = 'https://evil.example/'`);
        return [];
      }),
    ]);
    expect(result.errors[0]?.reason).toMatch(/readonly|does not return data/i);
    expect(site.withDb((db) => db.prepare('SELECT site_url FROM properties').get())).toEqual({
      site_url: 'https://example.com/',
    });
  });

  it.each([
    ['no evidence', draft('x', { evidence: [] }), /has no evidence/],
    [
      'evidence that writes',
      draft('x', {
        evidence: [{ table: 'jobs', sql: 'DELETE FROM jobs', params: [], label: 'bad' }],
      }),
      /not a read-only query|readonly/i,
    ],
    [
      'evidence with no rows',
      draft('x', {
        evidence: [
          { table: 'jobs', sql: 'SELECT * FROM jobs WHERE 0', params: [], label: 'empty' },
        ],
      }),
      /none of its evidence/,
    ],
    [
      'an estimate with no method',
      draft('x', { valueAtStake: { metric: 'clicks', amount: 3, basis: 'estimated' } }),
      /must say how/,
    ],
  ])('rejects a finding with %s', async (_, bad, message) => {
    const result = await site.audit([fakeCheck('redirects.bad', () => [bad])]);
    expect(result.errors[0]?.reason).toMatch(message);
    expect(result.findings).toEqual([]);
  });

  it('requires reasoning from a judgement check', async () => {
    const result = await site.audit([
      fakeCheck('redirects.opinion', () => [draft('x')], { label: 'judgement' }),
    ]);
    expect(result.errors[0]?.reason).toMatch(/reasoning/);
  });

  it('ranks: severity floor first, then priority, then the easier fix', async () => {
    const clicks = (amount: number) => ({
      metric: 'clicks' as const,
      amount,
      basis: 'observed' as const,
    });
    const result = await site.audit([
      fakeCheck('redirects.big', () => [draft('big', { valueAtStake: clicks(100) })]),
      fakeCheck('redirects.small', () => [draft('small', { valueAtStake: clicks(10) })]),
      fakeCheck('redirects.zero-hard', () => [draft('zero-hard', { effortHours: 4 })]),
      fakeCheck('redirects.zero-easy', () => [draft('zero-easy', { effortHours: 0.5 })]),
      fakeCheck('redirects.floor', () => [draft('floor')], { severityFloor: true }),
    ]);
    expect(result.findings.map((f) => f.key)).toEqual([
      'floor',
      'big',
      'small',
      'zero-easy',
      'zero-hard',
    ]);
    // 100 clicks × 0.5 yield × 1 certainty ÷ 1 hour
    expect(result.findings[1]?.priority).toBe(50);
  });

  it('marks findings new, persisting and resolved across runs', async () => {
    let keys = ['a', 'b'];
    const check = fakeCheck('redirects.changing', () => keys.map((k) => draft(k)));

    const first = await site.audit([check]);
    expect(first.findings.map((f) => [f.key, f.status])).toEqual([
      ['a', 'new'],
      ['b', 'new'],
    ]);

    keys = ['b', 'c'];
    const second = await site.audit([check]);
    expect(second.findings.map((f) => [f.key, f.status])).toEqual([
      ['b', 'persisting'],
      ['c', 'new'],
    ]);
    expect(second.resolved.map((f) => [f.key, f.status])).toEqual([['a', 'resolved']]);

    // Resolved findings are saved with the run, keeping their evidence.
    expect(
      site.withDb((db) =>
        db
          .prepare(
            `SELECT f.key, COUNT(e.ordinal) AS evidence FROM findings f
               JOIN finding_evidence e ON e.finding_id = f.id
              WHERE f.status = 'resolved' GROUP BY f.key`,
          )
          .all(),
      ),
    ).toEqual([{ key: 'a', evidence: 1 }]);
  });

  it('never resolves the findings of a check that was skipped', async () => {
    const check = fakeCheck('redirects.brand', () => [draft('a')], { requires: ['brand-terms'] });
    const setBrand = (terms: string[]) => {
      const file = configPath(site.home);
      const config = readConfig(file);
      writeConfig(file, { ...config, site: { ...config.site, brandTerms: terms } });
    };

    setBrand(['example']);
    await site.audit([check]);
    setBrand([]);
    const skipped = await site.audit([check]);
    expect(skipped.skipped).toHaveLength(1);
    expect(skipped.resolved).toEqual([]);

    setBrand(['example']);
    const back = await site.audit([check]);
    expect(back.findings.map((f) => f.status)).toEqual(['persisting']);
  });

  it('lists a check that throws SkipCheck as skipped, resolving nothing', async () => {
    let enoughData = true;
    const check = fakeCheck('redirects.data-hungry', () => {
      if (!enoughData) throw new SkipCheck('needs 180 days of data; you have 108');
      return [draft('a')];
    });

    await site.audit([check]);
    enoughData = false;
    const thin = await site.audit([check]);
    expect(thin.skipped).toEqual([
      { checkId: 'redirects.data-hungry', reason: 'needs 180 days of data; you have 108' },
    ]);
    expect(thin.errors).toEqual([]);
    expect(thin.resolved).toEqual([]);

    enoughData = true;
    expect((await site.audit([check])).findings.map((f) => f.status)).toEqual(['persisting']);
  });

  it('tracks the lifecycle: open, fixed, and open again', async () => {
    let keys = ['a'];
    const check = fakeCheck('redirects.flaky', () => keys.map((k) => draft(k)));
    const lifecycle = () =>
      site.withDb((db) =>
        db
          .prepare(
            `SELECT state, fixed_at IS NOT NULL AS fixed, regressed_at IS NOT NULL AS regressed
               FROM finding_lifecycle WHERE key = 'a'`,
          )
          .get(),
      );

    await site.audit([check]);
    expect(lifecycle()).toEqual({ state: 'open', fixed: 0, regressed: 0 });
    keys = [];
    await site.audit([check]);
    expect(lifecycle()).toEqual({ state: 'fixed', fixed: 1, regressed: 0 });
    keys = ['a'];
    await site.audit([check]);
    expect(lifecycle()).toEqual({ state: 'open', fixed: 1, regressed: 1 });
  });

  it('uses an effort override from the lifecycle table', async () => {
    const check = fakeCheck('redirects.effort', () => [
      draft('a', { valueAtStake: { metric: 'clicks', amount: 8, basis: 'observed' } }),
    ]);
    await site.audit([check]);
    site.withDb((db) => db.prepare('UPDATE finding_lifecycle SET effort_hours_override = 4').run());
    const result = await site.audit([check]);
    expect(result.findings[0]).toMatchObject({ effortHours: 4, priority: 1 });
  });

  it('applies threshold overrides from the config, and rejects unknown ones', async () => {
    const check = fakeCheck(
      'redirects.tunable',
      (ctx) => [draft(`limit-${ctx.config.thresholds.limit}`)],
      { thresholds: { limit: 2 } },
    );
    const setChecks = (checks: Record<string, Record<string, number>>) => {
      const file = configPath(site.home);
      writeConfig(file, { ...readConfig(file), checks });
    };

    setChecks({ 'redirects.tunable': { limit: 5 } });
    expect((await site.audit([check])).findings[0]?.key).toBe('limit-5');

    setChecks({ 'redirects.tunable': { limt: 5 } });
    await expect(site.audit([check])).rejects.toThrow(UserError);
    await expect(site.audit([check])).rejects.toThrow(/no threshold "limt"/);
  });
});

describe('compareFindings', () => {
  const base: Scored = {
    checkId: 'x',
    key: 'k',
    urls: ['u'],
    severityFloor: false,
    valueAmount: 0,
    expectedYield: 0.5,
    certainty: 1,
    effortHours: 1,
  };

  it('breaks a tie of equal ease by the number of URLs affected', () => {
    const many = { ...base, key: 'many', urls: ['a', 'b', 'c'] };
    const one = { ...base, key: 'one' };
    expect([one, many].sort(compareFindings).map((f) => f.key)).toEqual(['many', 'one']);
  });
});
