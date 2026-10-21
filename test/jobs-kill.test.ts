import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { enqueue, getJob } from '../src/jobs/queue.js';
import { makeTempHome } from './helpers/temp-home.js';

// Needs dist/, which `npm test` builds first.
const worker = fileURLToPath(new URL('./fixtures/jobs/counting-worker.mjs', import.meta.url));

let temp: ReturnType<typeof makeTempHome>;
let dbFile: string;

beforeEach(() => {
  temp = makeTempHome();
  dbFile = path.join(temp.home, 'data.db');
});
afterEach(() => temp.cleanup());

/** Runs the worker. If `killAt` is set, hard-kills it once it reports that step. */
function runWorker(args: string[], killAt?: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, dbFile, ...args]);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (killAt !== undefined && output.split('\n').includes(String(killAt))) {
        child.kill('SIGKILL');
      }
    });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => (errors ? reject(new Error(errors)) : resolve(code)));
  });
}

function withDb<T>(read: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb(dbFile);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

const counted = () =>
  withDb((db) =>
    db
      .prepare('SELECT n FROM counted ORDER BY n')
      .all()
      .map((row) => (row as { n: number }).n),
  );

it('resumes a job after its process is killed mid-run', { timeout: 30_000 }, async () => {
  const id = withDb((db) => {
    db.exec('CREATE TABLE counted (n INTEGER PRIMARY KEY) STRICT');
    return enqueue(db, 'count');
  });

  // First run: killed once it has finished step 5.
  await runWorker([], 5);
  const afterKill = counted();
  expect(afterKill.length).toBeGreaterThanOrEqual(5);
  expect(afterKill.length).toBeLessThan(20);
  expect(withDb((db) => getJob(db, id)?.state)).toBe('running');

  // Second run: a minute later, so the dead runner's lease has expired.
  expect(await runWorker(['60000'])).toBe(0);

  // Every step exactly once: no gaps, no repeats (a repeat would break the primary key).
  expect(counted()).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  expect(withDb((db) => getJob(db, id))).toMatchObject({ state: 'completed', attempts: 2 });
});
