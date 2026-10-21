import { readConfig } from '../../config/load.js';
import { configPath, dbPath, resolveHome } from '../../config/paths.js';
import { openDb } from '../../db/open.js';
import { UserError } from '../../errors.js';
import { enqueue } from '../../jobs/queue.js';
import { runJobs, type RunSummary } from '../../jobs/runner.js';
import { createGscApi, type GscApi } from '../../connectors/gsc/api.js';
import { createTokenSource } from '../../connectors/gsc/auth.js';
import { GSC_SYNC_JOB, gscSyncHandler, type GscSyncPayload } from '../../connectors/gsc/sync.js';

export interface SyncCommandOptions {
  home?: string;
  report: (line: string) => void;
  /** Aborted on Ctrl+C: the sync stops after the current day. */
  signal?: AbortSignal;
  /** Replaces the real Search Console API in tests. */
  api?: GscApi;
  now?: () => Date;
}

const NOT_CONNECTED =
  'Search Console is not connected. Run "webmastery-console connect google" first.';

/** Queues a Search Console sync for the site (unless one is waiting) and runs it. */
export async function runSync(options: SyncCommandOptions): Promise<RunSummary> {
  const home = resolveHome(options.home);
  const config = readConfig(configPath(home));
  const gsc = config.gsc;
  // Off means off: an empty credentials file or property switches the source off.
  if (!gsc?.credentialsFile || !gsc.property) throw new UserError(NOT_CONNECTED);

  const db = openDb(dbPath(home));
  try {
    const property = db
      .prepare('SELECT id FROM properties WHERE site_url = ?')
      .get(config.site.url) as { id: number } | undefined;
    if (!property) {
      throw new UserError(`${config.site.url} is not in the database. Run "init" again.`);
    }

    const payload: GscSyncPayload = {
      propertyId: property.id,
      gscProperty: gsc.property,
      searchType: 'web',
    };
    const pending = db
      .prepare(
        `SELECT id FROM jobs
          WHERE type = ? AND state IN ('queued', 'running')
            AND json_extract(payload, '$.propertyId') = ?`,
      )
      .get(GSC_SYNC_JOB, property.id) as { id: number } | undefined;
    const jobId = pending?.id ?? enqueue(db, GSC_SYNC_JOB, payload);

    const api = options.api ?? createGscApi(createTokenSource(home, gsc));
    const handler = gscSyncHandler(api, { report: options.report, now: options.now });
    const summary = await runJobs(
      db,
      { [GSC_SYNC_JOB]: handler },
      { signal: options.signal, now: options.now },
    );

    const job = db.prepare('SELECT state, last_error FROM jobs WHERE id = ?').get(jobId) as {
      state: string;
      last_error: string | null;
    };
    if (job.state === 'failed') throw new UserError(job.last_error ?? 'The sync failed.');
    if (job.state === 'running') {
      throw new UserError(
        'Another sync is running, or one was stopped less than 30 seconds ago. Try again shortly.',
      );
    }
    return summary;
  } finally {
    db.close();
  }
}
