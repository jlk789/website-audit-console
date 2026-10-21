import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/cli/commands/init.js';
import { runSync } from '../src/cli/commands/sync.js';
import { readConfig, writeConfig } from '../src/config/load.js';
import { configPath, dbPath } from '../src/config/paths.js';
import { daysBetween, subtractMonths } from '../src/connectors/gsc/dates.js';
import { openDb } from '../src/db/open.js';
import { UserError } from '../src/errors.js';
import { fakeGsc } from './helpers/fake-gsc.js';
import { makeTempHome } from './helpers/temp-home.js';

const LATEST = '2026-10-18';
const WINDOW = daysBetween(subtractMonths(LATEST, 16), LATEST);
const now = () => new Date('2026-10-21T12:00:00Z');
const quiet = () => {};

describe('gsc sync', () => {
  let temp: ReturnType<typeof makeTempHome>;

  beforeEach(() => {
    temp = makeTempHome();
    runInit({ site: 'https://example.com/', home: temp.home });
    connect('sc-domain:example.com');
  });
  afterEach(() => temp.cleanup());

  function connect(property: string, credentialsFile = 'secrets/google-oauth-client.json') {
    const file = configPath(temp.home);
    writeConfig(file, { ...readConfig(file), gsc: { auth: 'oauth', credentialsFile, property } });
  }

  function query<T>(sql: string, ...params: unknown[]): T[] {
    const db = openDb(dbPath(temp.home));
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  }

  const count = (table: string) => query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0]!.n;
  const dayCalls = (api: ReturnType<typeof fakeGsc>) =>
    api.calls.filter((call) => call.dimensions.join() !== 'date');

  it('backfills 16 months on the first run', async () => {
    const api = fakeGsc({ latest: LATEST });
    await runSync({ home: temp.home, api, report: quiet, now });

    expect(WINDOW.length).toBeGreaterThan(480);
    expect(count('gsc_sync_state')).toBe(WINDOW.length);
    expect(count('gsc_page_daily')).toBe(WINDOW.length * 2);
    expect(count('gsc_query_page_daily')).toBe(WINDOW.length * 3);
    // Never asks for days after the latest final day.
    expect(dayCalls(api).every((call) => call.startDate <= LATEST)).toBe(true);
  });

  it('stores the anonymised-click share for each day', async () => {
    await runSync({ home: temp.home, api: fakeGsc({ latest: LATEST }), report: quiet, now });
    const [day] = query<{ anonymised_click_share: number; row_cap_hit: number }>(
      'SELECT anonymised_click_share, row_cap_hit FROM gsc_sync_state WHERE date = ?',
      LATEST,
    );
    // 80 clicks in page totals, 3 in query rows.
    expect(day).toEqual({ anonymised_click_share: 1 - 3 / 80, row_cap_hit: 0 });
  });

  it('fetches only new days on later runs', async () => {
    await runSync({ home: temp.home, api: fakeGsc({ latest: LATEST }), report: quiet, now });

    const unchanged = fakeGsc({ latest: LATEST });
    await runSync({ home: temp.home, api: unchanged, report: quiet, now });
    expect(dayCalls(unchanged)).toEqual([]);

    const oneMore = fakeGsc({ latest: '2026-10-19' });
    await runSync({ home: temp.home, api: oneMore, report: quiet, now });
    expect(dayCalls(oneMore).map((call) => call.startDate)).toEqual(['2026-10-19', '2026-10-19']);
  });

  it('flags a day that hits the row cap and stores the capped rows', async () => {
    const api = fakeGsc({ latest: LATEST, queryRows: (day) => (day === LATEST ? 60_000 : 3) });
    await runSync({ home: temp.home, api, report: quiet, now });

    const [day] = query<{ query_rows: number; row_cap_hit: number }>(
      'SELECT query_rows, row_cap_hit FROM gsc_sync_state WHERE date = ?',
      LATEST,
    );
    expect(day).toEqual({ query_rows: 50_000, row_cap_hit: 1 });
    // Two pages of 25,000, then it stops: the cap is reached.
    const capped = dayCalls(api).filter((c) => c.startDate === LATEST && c.dimensions.length === 2);
    expect(capped.map((c) => c.startRow)).toEqual([0, 25_000]);
  });

  it('resumes after Ctrl+C without repeating or skipping a day', async () => {
    const controller = new AbortController();
    let daysDone = 0;
    const first = fakeGsc({ latest: LATEST });
    await runSync({
      home: temp.home,
      api: first,
      now,
      signal: controller.signal,
      report: (line) => {
        if (/^\d{4}-\d{2}-\d{2} /.test(line) && ++daysDone === 10) controller.abort();
      },
    });
    expect(count('gsc_sync_state')).toBe(10);

    const second = fakeGsc({ latest: LATEST });
    await runSync({ home: temp.home, api: second, report: quiet, now });

    const firstDays = new Set(dayCalls(first).map((c) => c.startDate));
    const secondDays = new Set(dayCalls(second).map((c) => c.startDate));
    expect([...firstDays].filter((day) => secondDays.has(day))).toEqual([]);
    expect(firstDays.size + secondDays.size).toBe(WINDOW.length);
    expect(count('gsc_sync_state')).toBe(WINDOW.length);
  });

  it('stops at once with a clear message when the sign-in has expired', async () => {
    const api = fakeGsc({
      latest: LATEST,
      fail: new UserError('Your Google sign-in has expired.'),
    });
    await expect(runSync({ home: temp.home, api, report: quiet, now })).rejects.toThrow(
      'Your Google sign-in has expired.',
    );
    expect(query<{ state: string; attempts: number }>('SELECT state, attempts FROM jobs')).toEqual([
      { state: 'failed', attempts: 1 },
    ]);
  });

  it('says Search Console is not connected when it is switched off', async () => {
    connect('sc-domain:example.com', '');
    await expect(
      runSync({ home: temp.home, api: fakeGsc({ latest: LATEST }), report: quiet, now }),
    ).rejects.toThrow(/not connected/);
    expect(count('jobs')).toBe(0);
  });
});
