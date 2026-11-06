import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BackgroundRun } from '../background.js';
import { reply, tool } from '../format.js';
import { latestRun, withSite } from '../site.js';
import { untrusted } from '../untrusted.js';

export function registerAuditStatus(server: McpServer, home: string, runner: BackgroundRun): void {
  server.registerTool(
    'audit_status',
    {
      title: 'Audit status',
      description:
        'How fresh the data is: whether Search Console is connected and its newest synced day, ' +
        'the latest crawl, the latest audit with any skipped checks and why, unfinished jobs, ' +
        'and the progress of a run started with run_audit.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      tool(() =>
        withSite(home, ({ db, config, propertyId }) => {
          const gsc = config.gsc;
          const connected = Boolean(gsc?.credentialsFile && gsc.property);
          const days = db
            .prepare(
              `SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS days,
                      (SELECT MIN(date) FROM gsc_page_daily
                        WHERE property_id = ? AND search_type = 'web') AS firstData
                 FROM gsc_sync_state WHERE property_id = ? AND search_type = 'web'`,
            )
            .get(propertyId, propertyId) as {
            first: string | null;
            last: string | null;
            days: number;
            firstData: string | null;
          };

          const crawl = db
            .prepare(
              `SELECT c.id, c.status, c.started_at, c.finished_at,
                      (SELECT COUNT(*) FROM pages p WHERE p.crawl_id = c.id) AS pages
                 FROM crawls c WHERE c.property_id = ? ORDER BY c.started_at DESC LIMIT 1`,
            )
            .get(propertyId) as
            | {
                id: string;
                status: string;
                started_at: string;
                finished_at: string | null;
                pages: number;
              }
            | undefined;

          const run = latestRun(db, propertyId);
          const counts = run
            ? (db
                .prepare(
                  `SELECT COUNT(*) FILTER (WHERE status IN ('new', 'persisting')) AS open,
                          COUNT(*) FILTER (WHERE status = 'new') AS new,
                          COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
                     FROM findings WHERE run_id = ?`,
                )
                .get(run.id) as { open: number; new: number; resolved: number })
            : undefined;

          const jobs = db
            .prepare(
              `SELECT id, type, state, attempts, last_error, created_at FROM jobs
                WHERE state IN ('queued', 'running') ORDER BY id`,
            )
            .all() as { id: number; type: string; state: string }[];

          const lines = [
            `Site: ${config.site.url}`,
            connected
              ? days.last
                ? `Search Console: connected (${gsc!.property}); ${days.days} days synced, ` +
                  `${days.first} to ${days.last}; ` +
                  (days.firstData
                    ? `the site's search data starts ${days.firstData}.`
                    : 'no search data in them yet.')
                : `Search Console: connected (${gsc!.property}), but nothing synced yet.`
              : 'Search Console: not connected. Run "webmastery-console connect google" in a terminal.',
            crawl
              ? `Latest crawl: ${crawl.status}, started ${crawl.started_at}` +
                `${crawl.finished_at ? `, finished ${crawl.finished_at}` : ''}; ${crawl.pages} pages.`
              : 'No crawl yet.',
            run && counts
              ? `Latest audit: finished ${run.finished_at}; ` +
                `${Object.keys(JSON.parse(run.check_versions) as object).length} checks ran; ` +
                `${counts.open} open findings (${counts.new} new), ${counts.resolved} resolved.`
              : 'No audit yet.',
            jobs.length > 0
              ? `Unfinished jobs: ${jobs.map((j) => `${j.type} (${j.state})`).join(', ')}.`
              : 'No unfinished jobs.',
            runner.state
              ? runner.busy
                ? `run_audit is running, started ${runner.state.startedAt}.`
                : `The last run_audit finished ${runner.state.finishedAt}.`
              : '',
          ];

          // Skip reasons and progress lines are our own text, but they can name
          // URLs or carry error messages from the site, so they go in the block.
          const skipped = run ? (JSON.parse(run.skipped) as Record<string, string>) : {};
          const details = {
            ...(Object.keys(skipped).length > 0 ? { skippedChecks: skipped } : {}),
            ...(runner.state ? { runAudit: runner.state } : {}),
          };
          return reply(
            lines.filter(Boolean).join('\n'),
            Object.keys(details).length > 0 ? untrusted('status', details) : '',
          );
        }),
      ),
  );
}
