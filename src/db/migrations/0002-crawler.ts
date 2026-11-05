import type { Migration } from './index.js';

/**
 * What the crawler needs beyond the v0.1 tables: the list of URLs to visit
 * (which is also how a stopped crawl resumes), each robots.txt and sitemap
 * file as fetched, and two page columns.
 */
export const crawler: Migration = {
  id: 2,
  name: 'crawler',
  sql: `
    -- Every URL a crawl has found, and how. Kept after the crawl finishes:
    -- it records why each URL was visited, and which ones the page limit left out.
    CREATE TABLE crawl_queue (
      id INTEGER PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      -- start, link, redirect, sitemap, gsc or probe
      source TEXT NOT NULL,
      -- Clicks from the start URL; NULL if no crawled link leads here.
      depth INTEGER,
      -- pending or done
      state TEXT NOT NULL,
      UNIQUE (crawl_id, url)
    ) STRICT;

    CREATE INDEX crawl_queue_pending ON crawl_queue (crawl_id, state, depth, id);

    -- One row per origin (scheme + host). status is NULL if it could not be fetched.
    CREATE TABLE robots_files (
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      status INTEGER,
      body TEXT,
      fetch_error TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (crawl_id, origin)
    ) STRICT;

    CREATE TABLE sitemaps (
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      -- "robots.txt", "default location", or the sitemap index that lists it
      found_in TEXT NOT NULL,
      status INTEGER,
      url_count INTEGER NOT NULL,
      fetch_error TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (crawl_id, url)
    ) STRICT;

    ALTER TABLE pages ADD COLUMN robots_blocked INTEGER CHECK (robots_blocked IN (0, 1));
    ALTER TABLE pages ADD COLUMN fetch_error TEXT;
  `,
};
