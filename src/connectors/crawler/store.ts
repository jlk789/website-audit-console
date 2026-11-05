import type { Db } from '../../db/open.js';
import type { Hop } from './fetch.js';
import type { PageLink } from './parse.js';
import { parseRobots } from './robots.js';
import type { SitemapEntry, SitemapFile } from './sitemaps.js';

/** How a URL was found. 'canonical' was added in M4; the column has no CHECK list, so no migration. */
export type QueueSource = 'start' | 'link' | 'redirect' | 'canonical' | 'sitemap' | 'gsc' | 'probe';

export interface CrawlSettings {
  maxPages: number;
  concurrency: number;
  userAgent: string;
}

export interface CrawlRow {
  id: string;
  propertyId: number;
  startUrl: string;
  settings: CrawlSettings;
  status: string;
}

export function loadCrawl(db: Db, crawlId: string): CrawlRow | undefined {
  const row = db
    .prepare('SELECT id, property_id, start_url, settings, status FROM crawls WHERE id = ?')
    .get(crawlId) as
    | { id: string; property_id: number; start_url: string; settings: string; status: string }
    | undefined;
  return (
    row && {
      id: row.id,
      propertyId: row.property_id,
      startUrl: row.start_url,
      settings: JSON.parse(row.settings) as CrawlSettings,
      status: row.status,
    }
  );
}

/**
 * Adds a URL to the crawl's list. If it is already there, keeps the smaller
 * link depth, so depth ends up as the shortest click path from the start URL.
 */
export function enqueueUrl(
  db: Db,
  crawlId: string,
  url: string,
  source: QueueSource,
  depth: number | null,
): void {
  db.prepare(
    `INSERT INTO crawl_queue (crawl_id, url, source, depth, state) VALUES (?, ?, ?, ?, 'pending')
     ON CONFLICT (crawl_id, url) DO UPDATE SET depth = excluded.depth
      WHERE excluded.depth IS NOT NULL AND (depth IS NULL OR excluded.depth < depth)`,
  ).run(crawlId, url, source, depth);
}

/**
 * Pending URLs, closest to the start first (breadth-first, so each page's
 * depth is its shortest click path). URLs no link has reached yet (from
 * sitemaps or Search Console) wait until every reachable URL is done; mixing
 * them in earlier would give their linked pages no depth.
 */
export function nextPending(
  db: Db,
  crawlId: string,
  limit: number,
): { url: string; depth: number | null }[] {
  const reachable = db
    .prepare(
      `SELECT url, depth FROM crawl_queue
        WHERE crawl_id = ? AND state = 'pending' AND depth IS NOT NULL
        ORDER BY depth, id LIMIT ?`,
    )
    .all(crawlId, limit) as { url: string; depth: number | null }[];
  if (reachable.length > 0) return reachable;
  return db
    .prepare(
      `SELECT url, depth FROM crawl_queue WHERE crawl_id = ? AND state = 'pending'
        ORDER BY id LIMIT ?`,
    )
    .all(crawlId, limit) as { url: string; depth: number | null }[];
}

export function countQueue(db: Db, crawlId: string): { done: number; pending: number } {
  return db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE state = 'done') AS done,
              COUNT(*) FILTER (WHERE state = 'pending') AS pending
         FROM crawl_queue WHERE crawl_id = ?`,
    )
    .get(crawlId) as { done: number; pending: number };
}

export function isDone(db: Db, crawlId: string, url: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM crawl_queue WHERE crawl_id = ? AND url = ? AND state = 'done'`)
      .get(crawlId, url) !== undefined
  );
}

/** Marks a URL visited, adding it to the list first if a redirect led there. */
export function markDone(
  db: Db,
  crawlId: string,
  url: string,
  source: QueueSource,
  depth: number | null,
): void {
  enqueueUrl(db, crawlId, url, source, depth);
  db.prepare(`UPDATE crawl_queue SET state = 'done' WHERE crawl_id = ? AND url = ?`).run(
    crawlId,
    url,
  );
}

export interface PageRow {
  url: string;
  status: number | null;
  contentType: string | null;
  title: string | null;
  h1: string | null;
  h1Count: number | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  canonical: string | null;
  wordCount: number | null;
  indexable: boolean;
  bodyHash: string | null;
  robotsBlocked: boolean;
  fetchError: string | null;
  fetchedAt: string;
}

/** Writes a page, replacing any earlier row from an interrupted batch. */
export function savePage(db: Db, crawlId: string, page: PageRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO pages
       (crawl_id, url, status, content_type, title, h1, h1_count, meta_robots, x_robots_tag,
        canonical, word_count, indexable, body_hash, robots_blocked, fetch_error, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crawlId,
    page.url,
    page.status,
    page.contentType,
    page.title,
    page.h1,
    page.h1Count,
    page.metaRobots,
    page.xRobotsTag,
    page.canonical,
    page.wordCount,
    page.indexable ? 1 : 0,
    page.bodyHash,
    page.robotsBlocked ? 1 : 0,
    page.fetchError,
    page.fetchedAt,
  );
}

export function saveLinks(db: Db, crawlId: string, from: string, links: PageLink[]): void {
  db.prepare('DELETE FROM links WHERE crawl_id = ? AND from_url = ?').run(crawlId, from);
  const insert = db.prepare(
    `INSERT INTO links (crawl_id, from_url, to_url, anchor, nofollow, location)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const link of links) {
    insert.run(crawlId, from, link.to, link.anchor, link.nofollow ? 1 : 0, link.location);
  }
}

/** Hop 0 is the response to `url` itself. */
export function saveHops(db: Db, crawlId: string, url: string, hops: Hop[]): void {
  db.prepare('DELETE FROM redirect_hops WHERE crawl_id = ? AND url = ?').run(crawlId, url);
  const insert = db.prepare(
    `INSERT INTO redirect_hops (crawl_id, url, hop, from_url, status, target)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  hops.forEach((hop, index) => insert.run(crawlId, url, index, hop.from, hop.status, hop.target));
}

export interface StoredRobots {
  origin: string;
  status: number | null;
  body: string | null;
  error: string | null;
  fetchedAt: string;
}

/** Stores a robots.txt file and one row per line, so checks can cite the exact rule. */
export function saveRobots(db: Db, crawlId: string, file: StoredRobots): void {
  db.prepare(
    `INSERT OR REPLACE INTO robots_files (crawl_id, origin, status, body, fetch_error, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(crawlId, file.origin, file.status, file.body, file.error, file.fetchedAt);
  db.prepare('DELETE FROM robots_rules WHERE crawl_id = ? AND host = ?').run(crawlId, file.origin);
  if (file.body === null) return;
  const insert = db.prepare(
    `INSERT INTO robots_rules (crawl_id, host, user_agent, directive, value, line_no)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const line of parseRobots(file.body).lines) {
    insert.run(crawlId, file.origin, line.userAgent, line.directive, line.value, line.lineNo);
  }
}

export function loadRobots(db: Db, crawlId: string): StoredRobots[] {
  const rows = db
    .prepare(
      'SELECT origin, status, body, fetch_error, fetched_at FROM robots_files WHERE crawl_id = ?',
    )
    .all(crawlId) as {
    origin: string;
    status: number | null;
    body: string | null;
    fetch_error: string | null;
    fetched_at: string;
  }[];
  return rows.map((row) => ({
    origin: row.origin,
    status: row.status,
    body: row.body,
    error: row.fetch_error,
    fetchedAt: row.fetched_at,
  }));
}

export function saveSitemaps(
  db: Db,
  crawlId: string,
  files: SitemapFile[],
  entries: SitemapEntry[],
  fetchedAt: string,
): void {
  const file = db.prepare(
    `INSERT OR REPLACE INTO sitemaps
       (crawl_id, url, found_in, status, url_count, fetch_error, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const f of files)
    file.run(crawlId, f.url, f.foundIn, f.status, f.urlCount, f.error, fetchedAt);
  const entry = db.prepare(
    `INSERT OR IGNORE INTO sitemap_urls (crawl_id, sitemap_url, url, lastmod) VALUES (?, ?, ?, ?)`,
  );
  for (const e of entries) entry.run(crawlId, e.sitemapUrl, e.url, e.lastmod);
}

/** Pages with Search Console history, most clicks first. */
export function gscPages(db: Db, propertyId: number): string[] {
  const rows = db
    .prepare(
      `SELECT page FROM gsc_page_daily WHERE property_id = ?
        GROUP BY page ORDER BY SUM(clicks) DESC, SUM(impressions) DESC, page`,
    )
    .all(propertyId) as { page: string }[];
  return rows.map((row) => row.page);
}

/** Copies each page's link depth from the queue, sets its sitemap flag and closes the crawl. */
export function finishCrawl(db: Db, crawlId: string, finishedAt: string): void {
  db.prepare(
    `UPDATE pages
        SET depth = (SELECT q.depth FROM crawl_queue q
                      WHERE q.crawl_id = pages.crawl_id AND q.url = pages.url),
            in_sitemap = EXISTS (SELECT 1 FROM sitemap_urls s
                                  WHERE s.crawl_id = pages.crawl_id AND s.url = pages.url)
      WHERE crawl_id = ?`,
  ).run(crawlId);
  db.prepare(`UPDATE crawls SET status = 'completed', finished_at = ? WHERE id = ?`).run(
    finishedAt,
    crawlId,
  );
}

export interface CrawlSummary {
  pages: number;
  ok: number;
  redirects: number;
  clientErrors: number;
  serverErrors: number;
  blocked: number;
  failed: number;
  sitemapFiles: number;
  sitemapUrls: number;
  notCrawled: number;
}

export function summarise(db: Db, crawlId: string): CrawlSummary {
  const pages = db
    .prepare(
      `SELECT COUNT(*) AS pages,
              COUNT(*) FILTER (WHERE status BETWEEN 200 AND 299) AS ok,
              COUNT(*) FILTER (WHERE status BETWEEN 300 AND 399) AS redirects,
              COUNT(*) FILTER (WHERE status BETWEEN 400 AND 499) AS clientErrors,
              COUNT(*) FILTER (WHERE status >= 500) AS serverErrors,
              COUNT(*) FILTER (WHERE robots_blocked = 1) AS blocked,
              COUNT(*) FILTER (WHERE status IS NULL AND robots_blocked = 0) AS failed
         FROM pages WHERE crawl_id = ?`,
    )
    .get(crawlId) as Omit<CrawlSummary, 'sitemapFiles' | 'sitemapUrls' | 'notCrawled'>;
  const sitemaps = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM sitemaps WHERE crawl_id = ?) AS sitemapFiles,
              (SELECT COUNT(DISTINCT url) FROM sitemap_urls WHERE crawl_id = ?) AS sitemapUrls`,
    )
    .get(crawlId, crawlId) as { sitemapFiles: number; sitemapUrls: number };
  return { ...pages, ...sitemaps, notCrawled: countQueue(db, crawlId).pending };
}
