import type { Migration } from './index.js';

/**
 * The v0.1 schema. Conventions:
 * - STRICT tables, so SQLite rejects values of the wrong type.
 * - Times are ISO 8601 UTC text; GSC dates are YYYY-MM-DD.
 * - Booleans are INTEGER 0/1.
 * - Status and state columns have no CHECK list, because adding a value
 *   later would mean rebuilding the table. Code validates them instead.
 * - Crawl and check-run ids are text UUIDs; other ids are integers.
 */
export const initial: Migration = {
  id: 1,
  name: 'initial',
  sql: `
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY,
      site_url TEXT NOT NULL UNIQUE,
      gsc_property TEXT,
      brand_terms TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    ) STRICT;

    -- The two GSC fact tables are the largest. WITHOUT ROWID stores each row
    -- once, in primary-key order, instead of twice (table plus key index).
    CREATE TABLE gsc_query_page_daily (
      property_id INTEGER NOT NULL REFERENCES properties (id),
      search_type TEXT NOT NULL DEFAULT 'web',
      date TEXT NOT NULL,
      query TEXT NOT NULL,
      page TEXT NOT NULL,
      clicks INTEGER NOT NULL,
      impressions INTEGER NOT NULL,
      position REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (property_id, search_type, date, query, page)
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX gsc_query_page_daily_by_page
      ON gsc_query_page_daily (property_id, search_type, page, date);

    -- Page totals include clicks from anonymised queries, so they exceed
    -- the sum of the query rows for the same page and day.
    CREATE TABLE gsc_page_daily (
      property_id INTEGER NOT NULL REFERENCES properties (id),
      search_type TEXT NOT NULL DEFAULT 'web',
      date TEXT NOT NULL,
      page TEXT NOT NULL,
      clicks INTEGER NOT NULL,
      impressions INTEGER NOT NULL,
      position REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (property_id, search_type, date, page)
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX gsc_page_daily_by_page
      ON gsc_page_daily (property_id, search_type, page, date);

    -- One row per synced day. The last synced date is MAX(date).
    CREATE TABLE gsc_sync_state (
      property_id INTEGER NOT NULL REFERENCES properties (id),
      search_type TEXT NOT NULL DEFAULT 'web',
      date TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      query_rows INTEGER NOT NULL,
      page_rows INTEGER NOT NULL,
      row_cap_hit INTEGER NOT NULL CHECK (row_cap_hit IN (0, 1)),
      anonymised_click_share REAL,
      PRIMARY KEY (property_id, search_type, date)
    ) STRICT;

    CREATE TABLE crawls (
      id TEXT PRIMARY KEY,
      property_id INTEGER NOT NULL REFERENCES properties (id),
      start_url TEXT NOT NULL,
      settings TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    ) STRICT;

    CREATE TABLE pages (
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      status INTEGER,
      content_type TEXT,
      title TEXT,
      h1 TEXT,
      h1_count INTEGER,
      meta_robots TEXT,
      x_robots_tag TEXT,
      canonical TEXT,
      word_count INTEGER,
      depth INTEGER,
      indexable INTEGER CHECK (indexable IN (0, 1)),
      in_sitemap INTEGER CHECK (in_sitemap IN (0, 1)),
      body_hash TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (crawl_id, url)
    ) STRICT;

    -- One row per hop. url is where the chain starts; hop 0 is its first response.
    CREATE TABLE redirect_hops (
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      hop INTEGER NOT NULL,
      from_url TEXT NOT NULL,
      status INTEGER NOT NULL,
      target TEXT,
      PRIMARY KEY (crawl_id, url, hop)
    ) STRICT;

    CREATE TABLE links (
      id INTEGER PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      from_url TEXT NOT NULL,
      to_url TEXT NOT NULL,
      anchor TEXT,
      nofollow INTEGER NOT NULL DEFAULT 0 CHECK (nofollow IN (0, 1)),
      location TEXT
    ) STRICT;

    CREATE INDEX links_by_to ON links (crawl_id, to_url);
    CREATE INDEX links_by_from ON links (crawl_id, from_url);

    CREATE TABLE robots_rules (
      id INTEGER PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      host TEXT NOT NULL,
      user_agent TEXT,
      directive TEXT NOT NULL,
      value TEXT NOT NULL,
      line_no INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX robots_rules_by_crawl ON robots_rules (crawl_id, host);

    CREATE TABLE sitemap_urls (
      crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
      sitemap_url TEXT NOT NULL,
      url TEXT NOT NULL,
      lastmod TEXT,
      PRIMARY KEY (crawl_id, sitemap_url, url)
    ) STRICT;

    CREATE INDEX sitemap_urls_by_url ON sitemap_urls (crawl_id, url);

    CREATE TABLE check_runs (
      id TEXT PRIMARY KEY,
      property_id INTEGER NOT NULL REFERENCES properties (id),
      crawl_id TEXT REFERENCES crawls (id),
      gsc_start TEXT,
      gsc_end TEXT,
      comparison_start TEXT,
      comparison_end TEXT,
      check_versions TEXT NOT NULL DEFAULT '{}',
      skipped TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE findings (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES check_runs (id) ON DELETE CASCADE,
      check_id TEXT NOT NULL,
      check_version INTEGER NOT NULL,
      key TEXT NOT NULL,
      status TEXT NOT NULL,
      urls TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL,
      detail TEXT,
      reasoning TEXT,
      value_metric TEXT NOT NULL,
      value_amount REAL NOT NULL,
      value_basis TEXT NOT NULL,
      value_method TEXT,
      certainty REAL NOT NULL,
      effort_hours REAL NOT NULL,
      expected_yield REAL NOT NULL,
      priority REAL NOT NULL,
      severity_floor INTEGER NOT NULL CHECK (severity_floor IN (0, 1)),
      fix TEXT,
      UNIQUE (run_id, check_id, key)
    ) STRICT;

    CREATE INDEX findings_by_key ON findings (check_id, key);

    CREATE TABLE finding_evidence (
      finding_id INTEGER NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      sql TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '[]',
      label TEXT NOT NULL,
      PRIMARY KEY (finding_id, ordinal)
    ) STRICT;

    -- Tracks one issue across runs. Created now, used from v0.2.
    CREATE TABLE finding_lifecycle (
      property_id INTEGER NOT NULL REFERENCES properties (id),
      check_id TEXT NOT NULL,
      key TEXT NOT NULL,
      state TEXT NOT NULL,
      first_seen_run TEXT REFERENCES check_runs (id),
      last_seen_run TEXT REFERENCES check_runs (id),
      opened_at TEXT NOT NULL,
      fixed_at TEXT,
      verifying_at TEXT,
      verified_at TEXT,
      regressed_at TEXT,
      effort_hours_override REAL,
      PRIMARY KEY (property_id, check_id, key)
    ) STRICT;

    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL,
      checkpoint TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      lease_until TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    ) STRICT;

    CREATE INDEX jobs_by_state ON jobs (state, id);
  `,
};
