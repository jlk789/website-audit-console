import type { JobHandler } from '../../jobs/runner.js';
import type { GscApi, GscQuery, GscRow } from './api.js';
import { addDays, daysBetween, subtractMonths, today } from './dates.js';
import { anonymisedClickShare, saveDay, syncedDays, type DayData } from './store.js';

export const GSC_SYNC_JOB = 'gsc-sync';

/** Search Console keeps at most this many rows per day per search type. */
export const ROW_CAP = 50_000;
/** Most rows one API request may return. */
export const PAGE_SIZE = 25_000;
/** How far back Search Console's data goes. */
export const HISTORY_MONTHS = 16;

export interface GscSyncPayload {
  propertyId: number;
  gscProperty: string;
  searchType: string;
}

export interface SyncOptions {
  /** Prints one line of progress. */
  report: (line: string) => void;
  now?: () => Date;
}

/**
 * The gsc-sync job. Finds the latest day with final data, then fetches every
 * day in the 16 months before it that has no sync-state row yet, newest first.
 * Each day is saved in one step, so an interrupted sync resumes at the next
 * missing day, and a later sync fetches only new days. Stored days are never
 * deleted, so history outlives Search Console's 16-month window.
 */
export function gscSyncHandler(api: GscApi, options: SyncOptions): JobHandler {
  const now = options.now ?? (() => new Date());

  return async (ctx) => {
    const { propertyId, gscProperty, searchType } = ctx.payload as GscSyncPayload;

    const latest = await latestFinalDay(api, gscProperty, searchType, today(now()));
    if (!latest) {
      options.report('Search Console has no finalised data for the last 30 days yet.');
      return;
    }

    const start = subtractMonths(latest, HISTORY_MONTHS);
    const done = syncedDays(ctx.db, propertyId, searchType, start, latest);
    const missing = daysBetween(start, latest)
      .filter((day) => !done.has(day))
      .reverse();
    options.report(
      missing.length === 0
        ? `Up to date: every day from ${start} to ${latest} is stored.`
        : `${missing.length} day(s) to fetch, ${start} to ${latest}.`,
    );

    for (const day of missing) {
      if (ctx.signal.aborted) return;
      const data = await fetchDay(api, gscProperty, searchType, day);
      ctx.step(() => saveDay(ctx.db, propertyId, searchType, day, data, now().toISOString()), {
        lastDay: day,
      });
      options.report(describeDay(day, data));
    }
  };
}

/** The most recent day with final (not still-changing) data, within the last 30 days. */
async function latestFinalDay(
  api: GscApi,
  gscProperty: string,
  searchType: string,
  todayDate: string,
): Promise<string | undefined> {
  const rows = await api.query(gscProperty, {
    startDate: addDays(todayDate, -30),
    endDate: todayDate,
    dimensions: ['date'],
    type: searchType,
    dataState: 'final',
    rowLimit: 100,
    startRow: 0,
  });
  return rows
    .map((row) => row.keys[0])
    .filter((day): day is string => day !== undefined)
    .sort()
    .at(-1);
}

export async function fetchDay(
  api: GscApi,
  gscProperty: string,
  searchType: string,
  day: string,
): Promise<DayData> {
  const base = {
    startDate: day,
    endDate: day,
    type: searchType,
    aggregationType: 'byPage' as const,
  };
  const pages = await fetchAll(api, gscProperty, { ...base, dimensions: ['page'] });
  const queries = await fetchAll(api, gscProperty, { ...base, dimensions: ['query', 'page'] });
  return { pages, queries, rowCapHit: pages.length >= ROW_CAP || queries.length >= ROW_CAP };
}

/** Pages through one request until the rows run out or the daily cap is reached. */
async function fetchAll(
  api: GscApi,
  gscProperty: string,
  query: Omit<GscQuery, 'rowLimit' | 'startRow'>,
): Promise<GscRow[]> {
  const rows: GscRow[] = [];
  while (rows.length < ROW_CAP) {
    const page = await api.query(gscProperty, {
      ...query,
      rowLimit: PAGE_SIZE,
      startRow: rows.length,
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function describeDay(day: string, data: DayData): string {
  const share = anonymisedClickShare(data);
  const parts = [
    day,
    `${data.queries.length.toLocaleString('en')} query rows`,
    share === null ? 'no clicks' : `anonymised ${Math.round(share * 100)}%`,
  ];
  if (data.rowCapHit) parts.push('row cap reached');
  return parts.join('  ');
}
