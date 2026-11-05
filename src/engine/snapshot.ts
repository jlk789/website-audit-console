import type { Capability, CheckContext } from '../checks/types.js';
import type { Config } from '../config/schema.js';
import { addDays } from '../connectors/gsc/dates.js';
import type { Db } from '../db/open.js';

export type Snapshot = CheckContext['snapshot'];

export interface Availability {
  snapshot: Snapshot;
  /** Why each missing capability is missing, in words a user can act on. */
  missing: Partial<Record<Capability, string>>;
}

/** Capabilities that no v0.1 connector provides. */
const LATER: Capability[] = [
  'gsc.inspection',
  'cwv.field',
  'cwv.lab',
  'logs',
  'conversions',
  'bing',
  'keyword.volume',
  'serp',
  'backlinks',
  'authority',
];

/**
 * Picks the data an audit runs against: the latest completed crawl, and the
 * last 28 days of Search Console data ending at the newest synced day (not
 * today, because Search Console lags by a few days).
 */
export function resolveSnapshot(db: Db, config: Config, propertyId: number): Availability {
  const snapshot: Snapshot = { propertyId };
  const missing: Availability['missing'] = {};

  const crawl = db
    .prepare(
      `SELECT id FROM crawls WHERE property_id = ? AND status = 'completed'
        ORDER BY finished_at DESC LIMIT 1`,
    )
    .get(propertyId) as { id: string } | undefined;
  if (crawl) snapshot.crawlId = crawl.id;
  else missing.crawl = 'no finished crawl yet; run "webmastery-console crawl"';

  const latest = db
    .prepare(
      `SELECT MAX(date) AS day FROM gsc_sync_state WHERE property_id = ? AND search_type = 'web'`,
    )
    .get(propertyId) as { day: string | null };
  if (!config.gsc?.credentialsFile || !config.gsc.property) {
    missing.gsc = 'Search Console is not connected; run "webmastery-console connect google"';
  } else if (!latest.day) {
    missing.gsc = 'no Search Console data yet; run "webmastery-console sync"';
  } else {
    snapshot.gscRange = { start: addDays(latest.day, -27), end: latest.day };
    snapshot.comparisonRange = { start: addDays(latest.day, -55), end: addDays(latest.day, -28) };
  }

  if (config.site.brandTerms.length === 0) {
    missing['brand-terms'] = 'no brand terms; add them to "site.brandTerms" in config.json';
  }
  for (const capability of LATER) missing[capability] = 'needs a provider not available in v0.1';
  return { snapshot, missing };
}
