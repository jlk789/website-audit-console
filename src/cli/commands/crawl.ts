import { randomUUID } from 'node:crypto';
import { readConfig } from '../../config/load.js';
import { configPath, dbPath, resolveHome } from '../../config/paths.js';
import { openDb, type Db } from '../../db/open.js';
import { UserError } from '../../errors.js';
import { enqueue } from '../../jobs/queue.js';
import { runJobs } from '../../jobs/runner.js';
import {
  CRAWL_JOB,
  crawlHandler,
  type CrawlerOptions,
  type CrawlPayload,
} from '../../connectors/crawler/crawl.js';
import type { CrawlSettings } from '../../connectors/crawler/store.js';
import { version } from '../../version.js';

export interface CrawlCommandOptions extends Omit<CrawlerOptions, 'report'> {
  home?: string;
  report: (line: string) => void;
  /** Aborted on Ctrl+C: the crawl stops after the current batch of pages. */
  signal?: AbortSignal;
  /** Start a new crawl even if an unfinished one exists. */
  fresh?: boolean;
  /** Page limit for a new crawl; defaults to crawl.maxPages in the config. */
  maxPages?: number;
}

export const USER_AGENT = `webmastery-console/${version} (+https://github.com/jlk789/website-audit-console)`;

/** Resumes the site's unfinished crawl, or starts a new one, and runs it. */
export async function runCrawl(options: CrawlCommandOptions): Promise<{ crawlId: string }> {
  const home = resolveHome(options.home);
  const config = readConfig(configPath(home));
  const now = options.now ?? (() => new Date());

  const db = openDb(dbPath(home));
  try {
    const property = db
      .prepare('SELECT id FROM properties WHERE site_url = ?')
      .get(config.site.url) as { id: number } | undefined;
    if (!property) {
      throw new UserError(`${config.site.url} is not in the database. Run "init" again.`);
    }

    let crawl = db
      .prepare(
        `SELECT id, started_at FROM crawls WHERE property_id = ? AND status = 'running'
          ORDER BY started_at DESC LIMIT 1`,
      )
      .get(property.id) as { id: string; started_at: string } | undefined;

    if (crawl && options.fresh) {
      abandon(db, crawl.id, now());
      crawl = undefined;
    }
    if (crawl) {
      options.report(`Resuming the crawl started ${crawl.started_at}.`);
    } else {
      const settings: CrawlSettings = {
        maxPages: options.maxPages ?? config.crawl.maxPages,
        concurrency: config.crawl.concurrency,
        userAgent: USER_AGENT,
      };
      crawl = { id: randomUUID(), started_at: now().toISOString() };
      db.prepare(
        `INSERT INTO crawls (id, property_id, start_url, settings, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      ).run(crawl.id, property.id, config.site.url, JSON.stringify(settings), crawl.started_at);
      options.report(
        `Crawling ${config.site.url} (up to ${settings.maxPages.toLocaleString('en')} pages).`,
      );
    }

    const payload: CrawlPayload = { crawlId: crawl.id };
    const jobId = findJob(db, crawl.id) ?? enqueue(db, CRAWL_JOB, payload);

    const handler = crawlHandler({ ...options, now });
    await runJobs(db, { [CRAWL_JOB]: handler }, { signal: options.signal, now: options.now });

    const job = db.prepare('SELECT state, last_error FROM jobs WHERE id = ?').get(jobId) as {
      state: string;
      last_error: string | null;
    };
    if (job.state === 'failed') throw new UserError(job.last_error ?? 'The crawl failed.');
    if (job.state === 'running') {
      throw new UserError(
        'Another crawl is running, or one was stopped less than 30 seconds ago. Try again shortly.',
      );
    }
    return { crawlId: crawl.id };
  } finally {
    db.close();
  }
}

function findJob(db: Db, crawlId: string): number | undefined {
  const row = db
    .prepare(
      `SELECT id FROM jobs WHERE type = ? AND state IN ('queued', 'running')
          AND json_extract(payload, '$.crawlId') = ?`,
    )
    .get(CRAWL_JOB, crawlId) as { id: number } | undefined;
  return row?.id;
}

/** Closes an unfinished crawl so a new one can start. Its data is kept. */
function abandon(db: Db, crawlId: string, now: Date): void {
  db.transaction(() => {
    db.prepare(`UPDATE crawls SET status = 'abandoned', finished_at = ? WHERE id = ?`).run(
      now.toISOString(),
      crawlId,
    );
    db.prepare(
      `UPDATE jobs SET state = 'failed', last_error = 'Replaced by a new crawl.', finished_at = ?
        WHERE type = ? AND state = 'queued' AND json_extract(payload, '$.crawlId') = ?`,
    ).run(now.toISOString(), CRAWL_JOB, crawlId);
  })();
}
