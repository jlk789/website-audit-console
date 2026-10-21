import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/open.js';
import { claimNext, enqueue, getJob, LeaseLostError, saveStep } from '../src/jobs/queue.js';
import { runJobs, type JobHandler } from '../src/jobs/runner.js';
import { makeTempHome } from './helpers/temp-home.js';

const later = (ms: number) => () => new Date(Date.now() + ms);

describe('job runner', () => {
  let temp: ReturnType<typeof makeTempHome>;
  let db: Db;

  beforeEach(() => {
    temp = makeTempHome();
    db = openDb(path.join(temp.home, 'data.db'));
    db.exec('CREATE TABLE counted (n INTEGER PRIMARY KEY) STRICT');
  });
  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  const countTo =
    (last: number): JobHandler =>
    async (ctx) => {
      let next = (ctx.checkpoint as { next: number } | null)?.next ?? 1;
      while (next <= last && !ctx.signal.aborted) {
        const n = next;
        ctx.step(() => db.prepare('INSERT INTO counted (n) VALUES (?)').run(n), { next: n + 1 });
        next = n + 1;
      }
    };

  const counted = () =>
    db
      .prepare('SELECT n FROM counted ORDER BY n')
      .all()
      .map((row) => (row as { n: number }).n);

  it('runs queued jobs in order and completes them', async () => {
    const first = enqueue(db, 'note', { n: 1 });
    const second = enqueue(db, 'note', { n: 2 });
    const order: number[] = [];
    const summary = await runJobs(db, {
      note: async (ctx) => {
        order.push((ctx.payload as { n: number }).n);
      },
    });
    expect(summary.completed).toBe(2);
    expect(order).toEqual([1, 2]);
    expect(getJob(db, first)?.state).toBe('completed');
    expect(getJob(db, second)?.state).toBe('completed');
  });

  it('rolls back a step whose work throws, keeping the old checkpoint', () => {
    const id = enqueue(db, 'count');
    const job = claimNext(db, 30_000, new Date())!;
    saveStep(
      db,
      job,
      () => db.prepare('INSERT INTO counted VALUES (1)').run(),
      { next: 2 },
      30_000,
      new Date(),
    );
    expect(() =>
      saveStep(
        db,
        job,
        () => {
          db.prepare('INSERT INTO counted VALUES (2)').run();
          throw new Error('disk on fire');
        },
        { next: 3 },
        30_000,
        new Date(),
      ),
    ).toThrow('disk on fire');
    expect(counted()).toEqual([1]);
    expect(getJob(db, id)?.checkpoint).toEqual({ next: 2 });
  });

  it('resumes from the checkpoint when a lease expires', async () => {
    const id = enqueue(db, 'count');
    // A runner claims the job, does three steps, then disappears.
    const crashed = claimNext(db, 30_000, new Date())!;
    for (const n of [1, 2, 3]) {
      saveStep(
        db,
        crashed,
        () => db.prepare('INSERT INTO counted VALUES (?)').run(n),
        { next: n + 1 },
        30_000,
        new Date(),
      );
    }

    // Before the lease runs out, nobody else can take it.
    expect(await runJobs(db, { count: countTo(10) })).toMatchObject({ completed: 0 });

    // After it runs out, the next runner continues from step 4.
    const summary = await runJobs(db, { count: countTo(10) }, { now: later(60_000) });
    expect(summary.completed).toBe(1);
    expect(counted()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(getJob(db, id)).toMatchObject({ state: 'completed', attempts: 2 });
  });

  it('stops a runner that lost its lease from writing', () => {
    enqueue(db, 'count');
    const stale = claimNext(db, 30_000, new Date())!;
    claimNext(db, 30_000, new Date(Date.now() + 60_000)); // another runner takes over
    expect(() =>
      saveStep(
        db,
        stale,
        () => db.prepare('INSERT INTO counted VALUES (1)').run(),
        { next: 2 },
        30_000,
        new Date(),
      ),
    ).toThrow(LeaseLostError);
    expect(counted()).toEqual([]);
  });

  it('retries a failing job, then marks it failed with the last error', async () => {
    const id = enqueue(db, 'flaky', {}, { maxAttempts: 3 });
    const summary = await runJobs(db, {
      flaky: async () => {
        throw new Error('server said no');
      },
    });
    expect(summary).toMatchObject({ retried: 2, failed: 1 });
    expect(getJob(db, id)).toMatchObject({ state: 'failed', attempts: 3 });
    const row = db.prepare('SELECT last_error FROM jobs WHERE id = ?').get(id) as {
      last_error: string;
    };
    expect(row.last_error).toBe('server said no');
  });

  it('fails a job with no handler without retrying', async () => {
    const id = enqueue(db, 'mystery');
    expect(await runJobs(db, {})).toMatchObject({ failed: 1 });
    expect(getJob(db, id)).toMatchObject({ state: 'failed', attempts: 1 });
  });

  it('puts a job back in the queue on a clean stop, without using an attempt', async () => {
    const id = enqueue(db, 'count');
    const controller = new AbortController();
    const summary = await runJobs(
      db,
      {
        count: async (ctx) => {
          ctx.step(() => db.prepare('INSERT INTO counted VALUES (1)').run(), { next: 2 });
          controller.abort(); // Ctrl+C arrives
          await countTo(10)(ctx);
        },
      },
      { signal: controller.signal },
    );
    expect(summary.released).toBe(1);
    expect(getJob(db, id)).toMatchObject({ state: 'queued', attempts: 0, checkpoint: { next: 2 } });

    await runJobs(db, { count: countTo(10) });
    expect(counted()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
