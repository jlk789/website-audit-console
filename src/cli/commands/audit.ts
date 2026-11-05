import { checks as allChecks } from '../../checks/index.js';
import type { CheckDefinition } from '../../checks/types.js';
import { readConfig } from '../../config/load.js';
import { configPath, dbPath, resolveHome } from '../../config/paths.js';
import { openDb } from '../../db/open.js';
import { AUDIT_JOB, auditHandler, type AuditPayload } from '../../engine/audit.js';
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

/** The audit as lines of text: what it ran on, then the ranked findings. */
export function describeAudit(result: AuditResult & { siteUrl: string }, limit: number): string[] {
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

  if (result.findings.length > 0) {
    lines.push('');
    result.findings.slice(0, limit).forEach((f, i) => {
      const rank = f.severityFloor ? '  !' : String(i + 1).padStart(3);
      const score = f.severityFloor ? 'FLOOR' : priority(f).toFixed(1).padStart(5);
      lines.push(`${rank}  ${score}  ${f.status === 'new' ? 'new ' : '    '} ${f.checkId}`);
      lines.push(`              ${f.summary}`);
    });
    if (result.findings.length > limit) {
      lines.push(
        '',
        `${result.findings.length - limit} more. Run "audit --all" to list every finding.`,
      );
    }
  }
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
