import { randomUUID } from 'node:crypto';
import type { CheckDefinition } from '../checks/types.js';
import type { Config } from '../config/schema.js';
import type { JobHandler } from '../jobs/runner.js';
import { openReadOnly } from './context.js';
import { checkThresholdConfig, runChecks } from './run.js';
import { resolveSnapshot } from './snapshot.js';
import { saveAudit, type AuditResult } from './store.js';

export const AUDIT_JOB = 'audit';

export interface AuditPayload {
  propertyId: number;
}

export interface AuditOptions {
  config: Config;
  /** The database file, opened a second time read-only for the checks. */
  dbFile: string;
  checks: CheckDefinition[];
  now?: () => Date;
  /** Receives the saved result. */
  onResult: (result: AuditResult) => void;
}

/**
 * The audit job: picks the snapshot, runs every check against it, compares
 * with earlier runs and saves everything in one step. Checks only read, so
 * an interrupted audit simply runs again from the start.
 */
export function auditHandler(options: AuditOptions): JobHandler {
  const now = options.now ?? (() => new Date());

  return async (ctx) => {
    const { propertyId } = ctx.payload as AuditPayload;
    checkThresholdConfig(options.checks, options.config);
    const startedAt = now().toISOString();
    const availability = resolveSnapshot(ctx.db, options.config, propertyId);

    const ro = openReadOnly(options.dbFile);
    let outcomes;
    try {
      outcomes = await runChecks(options.checks, ro, availability, options.config);
    } finally {
      ro.close();
    }

    const runId = randomUUID();
    let result: AuditResult | undefined;
    ctx.step(
      () => {
        result = saveAudit(ctx.db, {
          id: runId,
          snapshot: availability.snapshot,
          outcomes,
          startedAt,
          finishedAt: now().toISOString(),
        });
      },
      { runId },
    );
    options.onResult(result!);
  };
}
