import { readConfig } from '../config/load.js';
import type { Config } from '../config/schema.js';
import { configPath, dbPath } from '../config/paths.js';
import { openDb, type Db } from '../db/open.js';
import { UserError } from '../errors.js';

export interface Site {
  db: Db;
  config: Config;
  propertyId: number;
}

/** Opens the database for one tool call, and always closes it again. */
export function withSite<T>(home: string, work: (site: Site) => T): T {
  const config = readConfig(configPath(home));
  const db = openDb(dbPath(home));
  try {
    const property = db
      .prepare('SELECT id FROM properties WHERE site_url = ?')
      .get(config.site.url) as { id: number } | undefined;
    if (!property) {
      throw new UserError(`${config.site.url} is not in the database. Run "init" again.`);
    }
    return work({ db, config, propertyId: property.id });
  } finally {
    db.close();
  }
}

export interface RunRow {
  id: string;
  crawl_id: string | null;
  gsc_start: string | null;
  gsc_end: string | null;
  skipped: string;
  check_versions: string;
  finished_at: string;
}

/** The site's latest completed audit, if any. */
export function latestRun(db: Db, propertyId: number): RunRow | undefined {
  return db
    .prepare(
      `SELECT id, crawl_id, gsc_start, gsc_end, skipped, check_versions, finished_at
         FROM check_runs WHERE property_id = ? AND status = 'completed'
        ORDER BY started_at DESC LIMIT 1`,
    )
    .get(propertyId) as RunRow | undefined;
}

export const NO_AUDIT =
  'No audit has been run yet. Call run_audit, or run "webmastery-console audit" in a terminal.';

/** One stored finding, as the tools return it. */
export interface FindingRow {
  id: number;
  run_id: string;
  check_id: string;
  key: string;
  status: string;
  urls: string;
  summary: string;
  detail: string | null;
  reasoning: string | null;
  value_metric: string;
  value_amount: number;
  value_basis: string;
  value_method: string | null;
  certainty: number;
  effort_hours: number;
  expected_yield: number;
  priority: number;
  severity_floor: number;
  fix: string | null;
}

/**
 * Open findings of a run in rank order: the same order as the engine's
 * compareFindings (severity floor, priority, ease, URLs, check id, key).
 */
export function openFindings(db: Db, runId: string, category?: string): FindingRow[] {
  return db
    .prepare(
      `SELECT * FROM findings
        WHERE run_id = ? AND status IN ('new', 'persisting')
          AND (? IS NULL OR check_id LIKE ? || '.%')
        ORDER BY severity_floor DESC, priority DESC,
                 expected_yield * certainty / effort_hours DESC,
                 json_array_length(urls) DESC, check_id, key`,
    )
    .all(runId, category ?? null, category ?? null) as FindingRow[];
}
