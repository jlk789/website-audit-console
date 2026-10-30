import type { Db } from '../../db/open.js';
import type { GscRow } from './api.js';

export interface DayData {
  /** Rows with dimensions [page]: totals per page, including anonymised queries. */
  pages: GscRow[];
  /** Rows with dimensions [query, page]. */
  queries: GscRow[];
  rowCapHit: boolean;
}

const sum = (rows: GscRow[]) => rows.reduce((total, row) => total + row.clicks, 0);

/**
 * Share of a day's clicks that Search Console hides by anonymising queries:
 * 1 − (clicks in query rows ÷ clicks in page totals). Null on a day with no clicks.
 */
export function anonymisedClickShare(data: DayData): number | null {
  const pageClicks = sum(data.pages);
  if (pageClicks === 0) return null;
  return Math.max(0, 1 - sum(data.queries) / pageClicks);
}

/** Saves one day's rows and its sync-state row. Call inside a job step (one transaction). */
export function saveDay(
  db: Db,
  propertyId: number,
  searchType: string,
  date: string,
  data: DayData,
  fetchedAt: string,
): void {
  const page = db.prepare(
    `INSERT INTO gsc_page_daily
       (property_id, search_type, date, page, clicks, impressions, position, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions,
       position = excluded.position, fetched_at = excluded.fetched_at`,
  );
  for (const row of data.pages) {
    page.run(
      propertyId,
      searchType,
      date,
      row.keys[0],
      row.clicks,
      row.impressions,
      row.position,
      fetchedAt,
    );
  }

  const query = db.prepare(
    `INSERT INTO gsc_query_page_daily
       (property_id, search_type, date, query, page, clicks, impressions, position, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions,
       position = excluded.position, fetched_at = excluded.fetched_at`,
  );
  for (const row of data.queries) {
    query.run(
      propertyId,
      searchType,
      date,
      row.keys[0],
      row.keys[1],
      row.clicks,
      row.impressions,
      row.position,
      fetchedAt,
    );
  }

  db.prepare(
    `INSERT INTO gsc_sync_state
       (property_id, search_type, date, fetched_at, query_rows, page_rows, row_cap_hit,
        anonymised_click_share)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET fetched_at = excluded.fetched_at,
       query_rows = excluded.query_rows, page_rows = excluded.page_rows,
       row_cap_hit = excluded.row_cap_hit,
       anonymised_click_share = excluded.anonymised_click_share`,
  ).run(
    propertyId,
    searchType,
    date,
    fetchedAt,
    data.queries.length,
    data.pages.length,
    data.rowCapHit ? 1 : 0,
    anonymisedClickShare(data),
  );
}

/** Days in the range that already have a sync-state row. */
export function syncedDays(
  db: Db,
  propertyId: number,
  searchType: string,
  start: string,
  end: string,
): Set<string> {
  const rows = db
    .prepare(
      `SELECT date FROM gsc_sync_state
        WHERE property_id = ? AND search_type = ? AND date BETWEEN ? AND ?`,
    )
    .all(propertyId, searchType, start, end) as { date: string }[];
  return new Set(rows.map((row) => row.date));
}
