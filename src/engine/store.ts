import type { Db } from '../db/open.js';
import { compareFindings } from './rank.js';
import type { CheckOutcome, EngineFinding } from './run.js';
import type { Snapshot } from './snapshot.js';

export interface AuditResult {
  runId: string;
  snapshot: Snapshot;
  ran: number;
  skipped: { checkId: string; reason: string }[];
  errors: { checkId: string; reason: string }[];
  /** Open findings, ranked. */
  findings: EngineFinding[];
  /** Open in the previous run of the same check, gone now. */
  resolved: EngineFinding[];
}

interface FindingRow {
  id: number;
  check_id: string;
  check_version: number;
  key: string;
  urls: string;
  summary: string;
  detail: string | null;
  reasoning: string | null;
  value_metric: EngineFinding['valueMetric'];
  value_amount: number;
  value_basis: EngineFinding['valueBasis'];
  value_method: string | null;
  certainty: number;
  effort_hours: number;
  expected_yield: number;
  priority: number;
  severity_floor: number;
  fix: string | null;
  fix_group: string | null;
}

/**
 * Compares each check's findings with the last run in which that check ran
 * (so a check skipped for a while never "resolves" anything), then saves the
 * run, its findings and their evidence, and updates finding_lifecycle.
 * Call inside a job step: everything is written in one transaction.
 */
export function saveAudit(
  db: Db,
  run: {
    id: string;
    snapshot: Snapshot;
    outcomes: CheckOutcome[];
    startedAt: string;
    finishedAt: string;
  },
): AuditResult {
  const { snapshot } = run;
  const findings: EngineFinding[] = [];
  const resolved: EngineFinding[] = [];

  for (const outcome of run.outcomes.filter((o) => o.status === 'ran')) {
    const previous = previousOpen(db, snapshot.propertyId, outcome.check.id);
    const current = new Set(outcome.findings.map((f) => f.key));
    for (const finding of outcome.findings) {
      findings.push({ ...finding, status: previous.has(finding.key) ? 'persisting' : 'new' });
    }
    for (const [key, old] of previous) {
      if (!current.has(key)) resolved.push({ ...old, status: 'resolved', priority: 0 });
    }
  }
  findings.sort(compareFindings);

  const notRun = (status: CheckOutcome['status']) =>
    run.outcomes
      .filter((o) => o.status === status)
      .map((o) => ({ checkId: o.check.id, reason: o.reason ?? '' }));
  const skipped = notRun('skipped');
  const errors = notRun('error');

  const versions = Object.fromEntries(
    run.outcomes.filter((o) => o.status === 'ran').map((o) => [o.check.id, o.check.version]),
  );
  const notRunReasons = Object.fromEntries([
    ...skipped.map((s) => [s.checkId, s.reason]),
    ...errors.map((e) => [e.checkId, `error: ${e.reason}`]),
  ]);
  db.prepare(
    `INSERT INTO check_runs (id, property_id, crawl_id, gsc_start, gsc_end, comparison_start,
       comparison_end, check_versions, skipped, status, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
  ).run(
    run.id,
    snapshot.propertyId,
    snapshot.crawlId ?? null,
    snapshot.gscRange?.start ?? null,
    snapshot.gscRange?.end ?? null,
    snapshot.comparisonRange?.start ?? null,
    snapshot.comparisonRange?.end ?? null,
    JSON.stringify(versions),
    JSON.stringify(notRunReasons),
    run.startedAt,
    run.finishedAt,
  );

  for (const finding of [...findings, ...resolved]) insertFinding(db, run.id, finding);
  updateLifecycle(db, run, findings, resolved);

  return {
    runId: run.id,
    snapshot,
    ran: Object.keys(versions).length,
    skipped,
    errors,
    findings,
    resolved,
  };
}

/** The open findings of `checkId` in the latest run that ran it, by key. */
function previousOpen(db: Db, propertyId: number, checkId: string): Map<string, EngineFinding> {
  const runRow = db
    .prepare(
      `SELECT id FROM check_runs
        WHERE property_id = ? AND status = 'completed'
          AND json_extract(check_versions, '$."' || ? || '"') IS NOT NULL
        ORDER BY started_at DESC LIMIT 1`,
    )
    .get(propertyId, checkId) as { id: string } | undefined;
  if (!runRow) return new Map();

  const rows = db
    .prepare(
      `SELECT * FROM findings WHERE run_id = ? AND check_id = ? AND status IN ('new', 'persisting')`,
    )
    .all(runRow.id, checkId) as FindingRow[];
  const evidence = db.prepare(
    'SELECT table_name, sql, params, label FROM finding_evidence WHERE finding_id = ? ORDER BY ordinal',
  );
  return new Map(
    rows.map((row) => [
      row.key,
      {
        ...fromRow(row),
        evidence: (
          evidence.all(row.id) as {
            table_name: string;
            sql: string;
            params: string;
            label: string;
          }[]
        ).map((e) => ({
          table: e.table_name,
          sql: e.sql,
          params: JSON.parse(e.params) as unknown[],
          label: e.label,
        })),
      },
    ]),
  );
}

function fromRow(row: FindingRow): Omit<EngineFinding, 'evidence'> {
  return {
    checkId: row.check_id,
    checkVersion: row.check_version,
    key: row.key,
    urls: JSON.parse(row.urls) as string[],
    status: 'persisting',
    summary: row.summary,
    detail: row.detail,
    reasoning: row.reasoning,
    valueMetric: row.value_metric,
    valueAmount: row.value_amount,
    valueBasis: row.value_basis,
    valueMethod: row.value_method,
    certainty: row.certainty,
    effortHours: row.effort_hours,
    expectedYield: row.expected_yield,
    priority: row.priority,
    severityFloor: row.severity_floor === 1,
    fix: row.fix === null ? null : JSON.parse(row.fix),
    fixGroup: row.fix_group,
  };
}

function insertFinding(db: Db, runId: string, f: EngineFinding): void {
  const result = db
    .prepare(
      `INSERT INTO findings (run_id, check_id, check_version, key, status, urls, summary, detail,
         reasoning, value_metric, value_amount, value_basis, value_method, certainty,
         effort_hours, expected_yield, priority, severity_floor, fix, fix_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      f.checkId,
      f.checkVersion,
      f.key,
      f.status,
      JSON.stringify(f.urls),
      f.summary,
      f.detail,
      f.reasoning,
      f.valueMetric,
      f.valueAmount,
      f.valueBasis,
      f.valueMethod,
      f.certainty,
      f.effortHours,
      f.expectedYield,
      f.priority,
      f.severityFloor ? 1 : 0,
      f.fix === null ? null : JSON.stringify(f.fix),
      f.fixGroup,
    );
  const insert = db.prepare(
    `INSERT INTO finding_evidence (finding_id, ordinal, table_name, sql, params, label)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  f.evidence.forEach((e, i) =>
    insert.run(result.lastInsertRowid, i, e.table, e.sql, JSON.stringify(e.params), e.label),
  );
}

/**
 * v0.1 keeps only the start of the lifecycle: when an issue was first and
 * last seen, and "fixed" once a run no longer finds it. If it comes back, it
 * is open again and regressed_at records when. Verification comes in v0.2.
 */
function updateLifecycle(
  db: Db,
  run: { id: string; snapshot: Snapshot; finishedAt: string },
  open: EngineFinding[],
  resolved: EngineFinding[],
): void {
  const seen = db.prepare(
    `INSERT INTO finding_lifecycle
       (property_id, check_id, key, state, first_seen_run, last_seen_run, opened_at)
     VALUES (?, ?, ?, 'open', ?, ?, ?)
     ON CONFLICT DO UPDATE SET last_seen_run = excluded.last_seen_run,
       regressed_at = CASE WHEN state = 'fixed' THEN excluded.opened_at ELSE regressed_at END,
       state = 'open'`,
  );
  for (const f of open) {
    seen.run(run.snapshot.propertyId, f.checkId, f.key, run.id, run.id, run.finishedAt);
  }
  const fixed = db.prepare(
    `UPDATE finding_lifecycle SET state = 'fixed', fixed_at = ?
      WHERE property_id = ? AND check_id = ? AND key = ?`,
  );
  for (const f of resolved) fixed.run(run.finishedAt, run.snapshot.propertyId, f.checkId, f.key);
}
