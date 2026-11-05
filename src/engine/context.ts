import Database from 'better-sqlite3';
import type { DateRange, EvidenceBuilder, EvidenceRef, ReadOnlyDb } from '../checks/types.js';
import { normalise } from '../connectors/crawler/urls.js';

/**
 * A second connection to the database, opened read-only, for checks. SQLite
 * itself refuses any write on it, so a check cannot change data even by mistake.
 */
export function openReadOnly(file: string): Database.Database {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

export function readOnlyDb(db: Database.Database): ReadOnlyDb {
  return {
    all: <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
    normaliseUrl: (url) => normalise(url) ?? url,
  };
}

/** Evidence queries for one snapshot. */
export function evidenceBuilder(propertyId: number, crawlId?: string): EvidenceBuilder {
  const crawl = crawlId ?? '';
  return {
    page: (url) => ({
      table: 'pages',
      sql: 'SELECT * FROM pages WHERE crawl_id = ? AND url = ?',
      params: [crawl, url],
      label: `Crawled page ${url}`,
    }),
    redirect: (url) => ({
      table: 'redirect_hops',
      sql: 'SELECT * FROM redirect_hops WHERE crawl_id = ? AND url = ? ORDER BY hop',
      params: [crawl, url],
      label: `Redirect hops from ${url}`,
    }),
    linksTo: (url) => ({
      table: 'links',
      sql: `SELECT from_url, to_url, anchor, nofollow, location FROM links
             WHERE crawl_id = ? AND to_url = ? ORDER BY from_url`,
      params: [crawl, url],
      label: `Internal links to ${url}`,
    }),
    gscClicks: (urls, range: DateRange): EvidenceRef => ({
      table: 'gsc_page_daily',
      sql: `SELECT COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions
              FROM gsc_page_daily
             WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?
               AND page IN (SELECT value FROM json_each(?))`,
      params: [propertyId, range.start, range.end, JSON.stringify(urls)],
      label: `Search Console clicks, ${range.start} to ${range.end}`,
    }),
    gscHistory: (url) => ({
      table: 'gsc_page_daily',
      sql: `SELECT MIN(date) AS first_day, MAX(date) AS last_day,
                   COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions
              FROM gsc_page_daily
             WHERE property_id = ? AND search_type = 'web' AND page = ?`,
      params: [propertyId, url],
      label: `Search Console history of ${url}`,
    }),
    sitemapEntries: (url) => ({
      table: 'sitemap_urls',
      sql: `SELECT sitemap_url, url, lastmod FROM sitemap_urls
             WHERE crawl_id = ? AND url = ? ORDER BY sitemap_url`,
      params: [crawl, url],
      label: `Sitemaps listing ${url}`,
    }),
    // A LEFT JOIN, so a file with no lines (or a 5xx) still returns its status row.
    robots: (origin) => ({
      table: 'robots_files',
      sql: `SELECT f.origin, f.status, f.fetch_error, r.line_no, r.user_agent, r.directive, r.value
              FROM robots_files f
              LEFT JOIN robots_rules r ON r.crawl_id = f.crawl_id AND r.host = f.origin
             WHERE f.crawl_id = ? AND f.origin = ?
             ORDER BY r.line_no`,
      params: [crawl, origin],
      label: `robots.txt for ${origin}`,
    }),
    custom: (table, sql, params, label) => ({ table, sql, params, label }),
  };
}
