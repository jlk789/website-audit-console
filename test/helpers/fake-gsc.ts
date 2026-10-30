import type { GscApi, GscQuery, GscRow } from '../../src/connectors/gsc/api.js';

export interface FakeGscOptions {
  sites?: string[];
  /** Latest day with final data. Days after it return nothing. */
  latest: string;
  /** Query rows per day; defaults to 3. */
  queryRows?: (day: string) => number;
  /** Throws this instead of answering. */
  fail?: Error;
}

/**
 * A pretend Search Console. Each day has two pages with 40 clicks each (80 in
 * total) and `queryRows` query rows of one click each, so with the default of
 * 3 query rows a day's anonymised share is 1 − 3/80.
 */
export function fakeGsc(options: FakeGscOptions): GscApi & { calls: GscQuery[] } {
  const calls: GscQuery[] = [];
  const queryRows = options.queryRows ?? (() => 3);

  const rowsFor = (body: GscQuery): GscRow[] => {
    const day = body.startDate;
    if (body.dimensions.join() === 'date') {
      return ['2000-01-01', options.latest]
        .filter((d) => d >= body.startDate && d <= body.endDate)
        .map((d) => ({ keys: [d], clicks: 1, impressions: 1, position: 1 }));
    }
    if (day > options.latest) return [];
    if (body.dimensions.join() === 'page') {
      return ['https://example.com/', 'https://example.com/about'].map((page) => ({
        keys: [page],
        clicks: 40,
        impressions: 100,
        position: 3.5,
      }));
    }
    return Array.from({ length: queryRows(day) }, (_, i) => ({
      keys: [`query ${i}`, 'https://example.com/'],
      clicks: 1,
      impressions: 10,
      position: 7.25,
    }));
  };

  return {
    calls,
    async listSites() {
      if (options.fail) throw options.fail;
      return (options.sites ?? ['sc-domain:example.com']).map((siteUrl) => ({
        siteUrl,
        permissionLevel: 'siteOwner',
      }));
    },
    async query(_siteUrl, body) {
      calls.push(body);
      if (options.fail) throw options.fail;
      // Mimic paging: return the slice the request asks for.
      return rowsFor(body).slice(body.startRow, body.startRow + body.rowLimit);
    },
  };
}
