import { runAudit } from '../../src/cli/commands/audit.js';
import { runCrawl } from '../../src/cli/commands/crawl.js';
import { runInit } from '../../src/cli/commands/init.js';
import type { CheckDefinition } from '../../src/checks/types.js';
import { readConfig, writeConfig } from '../../src/config/load.js';
import { configPath, dbPath } from '../../src/config/paths.js';
import { openDb, type Db } from '../../src/db/open.js';
import type { EngineFinding } from '../../src/engine/run.js';
import { fakeWeb, type WebRoutes } from './fake-web.js';
import { makeTempHome } from './temp-home.js';

/** One Search Console row: page totals, and a query row if `query` is set. */
export interface GscRow {
  date: string;
  page: string;
  clicks: number;
  impressions: number;
  position?: number;
  query?: string;
}

/** A temp home with a site set up, ready to crawl, seed and audit. */
export function auditHome(siteUrl: string, brand: string[] = []) {
  const temp = makeTempHome();
  runInit({ site: siteUrl, brand, home: temp.home });

  const withDb = <T>(work: (db: Db) => T): T => {
    const db = openDb(dbPath(temp.home));
    try {
      return work(db);
    } finally {
      db.close();
    }
  };

  return {
    home: temp.home,
    cleanup: temp.cleanup,
    withDb,

    crawl: (routes: WebRoutes) =>
      runCrawl({ home: temp.home, report: () => {}, fetch: fakeWeb(routes), retryDelayMs: 0 }),

    /**
     * Marks Search Console as connected and stores the rows, with a sync-state
     * row for every day up to `latest`, so the audit's 28-day window ends there.
     */
    seedGsc(rows: GscRow[], latest: string) {
      const file = configPath(temp.home);
      writeConfig(file, {
        ...readConfig(file),
        gsc: { auth: 'oauth', credentialsFile: 'secrets/x.json', property: 'sc-domain:test' },
      });
      withDb((db) => {
        const page = db.prepare(
          `INSERT INTO gsc_page_daily (property_id, date, page, clicks, impressions, position, fetched_at)
           VALUES (1, ?, ?, ?, ?, ?, 'seed')
           ON CONFLICT DO UPDATE SET clicks = clicks + excluded.clicks,
             impressions = impressions + excluded.impressions`,
        );
        const query = db.prepare(
          `INSERT INTO gsc_query_page_daily
             (property_id, date, query, page, clicks, impressions, position, fetched_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, 'seed')`,
        );
        for (const r of rows) {
          page.run(r.date, r.page, r.clicks, r.impressions, r.position ?? 5);
          if (r.query) query.run(r.date, r.query, r.page, r.clicks, r.impressions, r.position ?? 5);
        }
        db.prepare(
          `INSERT OR IGNORE INTO gsc_sync_state
             (property_id, date, fetched_at, query_rows, page_rows, row_cap_hit)
           VALUES (1, ?, 'seed', 0, 0, 0)`,
        ).run(latest);
      });
    },

    audit: (checks?: CheckDefinition[]) => runAudit({ home: temp.home, checks }),

    /** Runs every evidence query of a finding and returns the row counts. */
    evidenceRows: (finding: EngineFinding) =>
      withDb((db) => finding.evidence.map((e) => db.prepare(e.sql).all(...e.params).length)),
  };
}
