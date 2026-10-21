import type { Db } from '../db/open.js';

export type JobState = 'queued' | 'running' | 'completed' | 'failed';

export interface Job {
  id: number;
  type: string;
  payload: unknown;
  state: JobState;
  /** Saved by the job's last completed step; null on a fresh start. */
  checkpoint: unknown;
  /** Counts every start. Also fences writes: a runner may only update the
   *  job while attempts still matches the value it claimed. */
  attempts: number;
  maxAttempts: number;
}

interface JobRow {
  id: number;
  type: string;
  payload: string;
  state: JobState;
  checkpoint: string | null;
  attempts: number;
  max_attempts: number;
}

/** Another runner took the job over after this runner's lease expired. */
export class LeaseLostError extends Error {}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload),
    state: row.state,
    checkpoint: row.checkpoint === null ? null : JSON.parse(row.checkpoint),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

function leaseUntil(now: Date, leaseMs: number): string {
  return new Date(now.getTime() + leaseMs).toISOString();
}

export function enqueue(
  db: Db,
  type: string,
  payload: unknown = {},
  options: { maxAttempts?: number; now?: Date } = {},
): number {
  const result = db
    .prepare(
      `INSERT INTO jobs (type, payload, state, max_attempts, created_at)
       VALUES (?, ?, 'queued', ?, ?)`,
    )
    .run(
      type,
      JSON.stringify(payload),
      options.maxAttempts ?? 5,
      (options.now ?? new Date()).toISOString(),
    );
  return Number(result.lastInsertRowid);
}

export function getJob(db: Db, id: number): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row && toJob(row);
}

/**
 * Takes the oldest job that is queued, or running with an expired lease
 * (its runner was killed), and leases it to the caller. One UPDATE, so two
 * runners can never claim the same job.
 */
export function claimNext(db: Db, leaseMs: number, now: Date): Job | undefined {
  const row = db
    .prepare(
      `UPDATE jobs
          SET state = 'running',
              attempts = attempts + 1,
              lease_until = ?,
              started_at = COALESCE(started_at, ?)
        WHERE id = (
          SELECT id FROM jobs
           WHERE state = 'queued' OR (state = 'running' AND lease_until < ?)
           ORDER BY id
           LIMIT 1)
       RETURNING *`,
    )
    .get(leaseUntil(now, leaseMs), now.toISOString(), now.toISOString()) as JobRow | undefined;
  return row && toJob(row);
}

/** Runs one fenced UPDATE on a job this runner holds. */
function updateHeld(db: Db, job: Job, set: string, params: unknown[]): void {
  const result = db
    .prepare(`UPDATE jobs SET ${set} WHERE id = ? AND state = 'running' AND attempts = ?`)
    .run(...params, job.id, job.attempts);
  if (result.changes === 0) {
    throw new LeaseLostError(`Job ${job.id} was taken over by another runner.`);
  }
}

/**
 * Runs `work` and saves `checkpoint` in one transaction, so after a crash
 * the database holds both or neither. This is what makes resume exact.
 */
export function saveStep(
  db: Db,
  job: Job,
  work: () => void,
  checkpoint: unknown,
  leaseMs: number,
  now: Date,
): void {
  db.transaction(() => {
    work();
    updateHeld(db, job, 'checkpoint = ?, lease_until = ?', [
      JSON.stringify(checkpoint),
      leaseUntil(now, leaseMs),
    ]);
  }).immediate();
}

export function renewLease(db: Db, job: Job, leaseMs: number, now: Date): void {
  updateHeld(db, job, 'lease_until = ?', [leaseUntil(now, leaseMs)]);
}

export function complete(db: Db, job: Job, now: Date): void {
  updateHeld(db, job, `state = 'completed', lease_until = NULL, finished_at = ?`, [
    now.toISOString(),
  ]);
}

/**
 * Records an error. The job goes back in the queue unless it has used all
 * its attempts or `permanent` is set. Returns the job's new state.
 */
export function fail(
  db: Db,
  job: Job,
  message: string,
  now: Date,
  permanent = false,
): 'queued' | 'failed' {
  const state = permanent || job.attempts >= job.maxAttempts ? 'failed' : 'queued';
  updateHeld(db, job, 'state = ?, lease_until = NULL, last_error = ?, finished_at = ?', [
    state,
    message,
    state === 'failed' ? now.toISOString() : null,
  ]);
  return state;
}

/** Puts a job back in the queue after a clean stop (Ctrl+C). A clean stop
 *  is not a failed attempt, so the attempt is handed back. */
export function release(db: Db, job: Job): void {
  updateHeld(db, job, `state = 'queued', lease_until = NULL, attempts = attempts - 1`, []);
}
