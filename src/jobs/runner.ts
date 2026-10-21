import type { Db } from '../db/open.js';
import {
  claimNext,
  complete,
  fail,
  LeaseLostError,
  release,
  renewLease,
  saveStep,
  type Job,
} from './queue.js';

export interface JobContext {
  db: Db;
  payload: unknown;
  /** Saved by the last completed step; null on a fresh start. Resume from here. */
  checkpoint: unknown;
  /** Aborted on Ctrl+C. Return at the end of the current step. */
  signal: AbortSignal;
  /** Runs `work` and saves `checkpoint` in one transaction. Write a job's
   *  data only inside a step, or a crash can lose or repeat it. */
  step(work: () => void, checkpoint: unknown): void;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

export interface RunOptions {
  /** How long a claimed job stays reserved without a heartbeat. */
  leaseMs?: number;
  signal?: AbortSignal;
  /** Clock, replaceable in tests. */
  now?: () => Date;
}

export interface RunSummary {
  completed: number;
  /** Errored and went back in the queue. */
  retried: number;
  failed: number;
  /** Stopped cleanly, or taken over by another runner. */
  released: number;
}

/** Runs queued jobs one at a time until the queue is empty or `signal` aborts. */
export async function runJobs(
  db: Db,
  handlers: Record<string, JobHandler>,
  options: RunOptions = {},
): Promise<RunSummary> {
  const leaseMs = options.leaseMs ?? 30_000;
  const now = options.now ?? (() => new Date());
  const signal = options.signal ?? new AbortController().signal;
  const summary: RunSummary = { completed: 0, retried: 0, failed: 0, released: 0 };

  while (!signal.aborted) {
    const job = claimNext(db, leaseMs, now());
    if (!job) break;

    const handler = handlers[job.type];
    if (job.attempts > job.maxAttempts) {
      fail(db, job, `Gave up after ${job.maxAttempts} attempts.`, now(), true);
      summary.failed++;
    } else if (!handler) {
      fail(db, job, `No handler for job type "${job.type}".`, now(), true);
      summary.failed++;
    } else {
      summary[await runOne(db, job, handler, leaseMs, now, signal)]++;
    }
  }
  return summary;
}

async function runOne(
  db: Db,
  job: Job,
  handler: JobHandler,
  leaseMs: number,
  now: () => Date,
  signal: AbortSignal,
): Promise<keyof RunSummary> {
  const heartbeat = setInterval(() => {
    try {
      renewLease(db, job, leaseMs, now());
    } catch {
      // Lease lost. The handler's next step will throw LeaseLostError.
    }
  }, leaseMs / 3);
  heartbeat.unref();

  try {
    await handler({
      db,
      payload: job.payload,
      checkpoint: job.checkpoint,
      signal,
      step: (work, checkpoint) => saveStep(db, job, work, checkpoint, leaseMs, now()),
    });
    if (signal.aborted) {
      release(db, job);
      return 'released';
    }
    complete(db, job, now());
    return 'completed';
  } catch (error) {
    if (error instanceof LeaseLostError) return 'released';
    const message = error instanceof Error ? error.message : String(error);
    return fail(db, job, message, now()) === 'failed' ? 'failed' : 'retried';
  } finally {
    clearInterval(heartbeat);
  }
}
