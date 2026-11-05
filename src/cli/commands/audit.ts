import { checks as allChecks } from '../../checks/index.js';
import type { CheckDefinition } from '../../checks/types.js';
import { readConfig } from '../../config/load.js';
import { configPath, dbPath, resolveHome } from '../../config/paths.js';
import { openDb } from '../../db/open.js';
import { AUDIT_JOB, auditHandler, type AuditPayload } from '../../engine/audit.js';
import { foldByCheck } from '../../engine/fold.js';
import { priority } from '../../engine/rank.js';
import type { AuditResult } from '../../engine/store.js';
import { UserError } from '../../errors.js';
import { enqueue } from '../../jobs/queue.js';
import { runJobs } from '../../jobs/runner.js';

export interface AuditCommandOptions {
  home?: string;
  /** Replaces the full check list in tests. */
  checks?: CheckDefinition[];
  now?: () => Date;
}

/** Runs every check against the latest crawl and Search Console data, and saves the results. */
export async function runAudit(
  options: AuditCommandOptions = {},
): Promise<AuditResult & { siteUrl: string }> {
  const home = resolveHome(options.home);
  const config = readConfig(configPath(home));
  const file = dbPath(home);

  const db = openDb(file);
  try {
    const property = db
      .prepare('SELECT id FROM properties WHERE site_url = ?')
      .get(config.site.url) as { id: number } | undefined;
    if (!property) {
      throw new UserError(`${config.site.url} is not in the database. Run "init" again.`);
    }

    const payload: AuditPayload = { propertyId: property.id };
    const jobId = enqueue(db, AUDIT_JOB, payload);
    let result: AuditResult | undefined;
    const handler = auditHandler({
      config,
      dbFile: file,
      checks: options.checks ?? allChecks,
      now: options.now,
      onResult: (r) => (result = r),
    });
    await runJobs(db, { [AUDIT_JOB]: handler }, { now: options.now });

    const job = db.prepare('SELECT state, last_error FROM jobs WHERE id = ?').get(jobId) as {
      state: string;
      last_error: string | null;
    };
    if (job.state === 'failed' || !result) {
      throw new UserError(job.last_error ?? 'The audit did not finish.');
    }
    return { ...result, siteUrl: config.site.url };
  } finally {
    db.close();
  }
}

/** How many entries the printout lists without --all. */
const TOP = 20;
/** Without --all, a check with more findings than this shows only its top one and a count. */
const GROUP_OVER = 3;

/**
 * The audit as lines of text: what it ran on, then the ranked findings.
 * Unless `all` is set, the list is shortened: repetitive checks are folded
 * into their top finding plus "and N more like this", and only the first
 * TOP entries are listed. Only the printout changes; every finding is stored.
 */
export function describeAudit(
  result: AuditResult & { siteUrl: string },
  options: { all: boolean },
): string[] {
  const { snapshot, siteUrl } = result;
  const sources = [
    snapshot.crawlId ? 'the latest crawl' : 'no crawl',
    snapshot.gscRange
      ? `Search Console ${snapshot.gscRange.start} to ${snapshot.gscRange.end}`
      : 'no Search Console data',
  ];
  const count = (status: string) => result.findings.filter((f) => f.status === status).length;
  const lines = [
    `Audit of ${siteUrl}: ${sources.join(', ')}.`,
    `${result.ran} checks ran, ${result.skipped.length} skipped, ${result.errors.length} failed. ` +
      `${result.findings.length} findings: ${count('new')} new, ${count('persisting')} persisting; ` +
      `${result.resolved.length} resolved since the last audit.`,
  ];

  const entries = foldByCheck(result.findings, options.all ? Infinity : GROUP_OVER);
  const folded = entries.filter((e) => e.more > 0);
  const listed = options.all ? entries : entries.slice(0, TOP);

  if (listed.length > 0) lines.push('');
  listed.forEach(({ finding: f, more }, i) => {
    const rank = f.severityFloor ? '  !' : String(i + 1).padStart(3);
    const score = f.severityFloor ? 'FLOOR' : priority(f).toFixed(1).padStart(5);
    lines.push(`${rank}  ${score}  ${f.status === 'new' ? 'new ' : '    '} ${f.checkId}`);
    lines.push(`              ${f.summary}`);
    if (more > 0) lines.push(`              ...and ${more} more like this.`);
  });
  const hidden = entries.length - listed.length;
  if (hidden > 0) lines.push('', `${hidden} more not shown.`);
  if (hidden > 0 || folded.length > 0) lines.push('Run "audit --all" to list every finding.');
  for (const f of result.resolved) lines.push(`Resolved: ${f.checkId}: ${f.summary}`);
  if (result.skipped.length > 0) {
    lines.push('', 'Skipped:');
    for (const s of result.skipped) lines.push(`  ${s.checkId}: ${s.reason}`);
  }
  if (result.errors.length > 0) {
    lines.push('', 'Failed (please report this):');
    for (const e of result.errors) lines.push(`  ${e.checkId}: ${e.reason}`);
  }
  return lines;
}
