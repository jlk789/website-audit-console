import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runInit } from '../src/cli/commands/init.js';
import { dbPath } from '../src/config/paths.js';
import { openDb } from '../src/db/open.js';
import { startTestSite, treeSite, type TestSite } from './helpers/test-site.js';
import { makeTempHome } from './helpers/temp-home.js';

// Needs dist/, which `npm test` builds first.
const worker = fileURLToPath(new URL('./fixtures/crawler/crawl-worker.mjs', import.meta.url));
const SIZE = 2000;

let temp: ReturnType<typeof makeTempHome>;
let site: TestSite;

beforeEach(async () => {
  temp = makeTempHome();
  site = await startTestSite(treeSite(SIZE));
  runInit({ site: `${site.origin}/`, home: temp.home });
});
afterEach(async () => {
  await site.close();
  temp.cleanup();
});

/** Runs the worker. If `killOn` matches a line of output, hard-kills it there. */
function runWorker(args: string[], killOn?: RegExp): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, temp.home, ...args]);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (killOn?.test(output)) child.kill('SIGKILL');
    });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    child.on('error', reject);
    child.on('exit', () => (errors ? reject(new Error(errors)) : resolve(output)));
  });
}

function query<T>(sql: string): T[] {
  const db = openDb(dbPath(temp.home));
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}

it('resumes a crawl after its process is killed mid-run', { timeout: 60_000 }, async () => {
  // First run: killed at its first progress report (after 50 or so pages).
  await runWorker([], / pages crawled, /);
  const afterKill = query<{ n: number }>(`SELECT COUNT(*) AS n FROM pages`)[0]!.n;
  expect(afterKill).toBeGreaterThanOrEqual(50);
  expect(afterKill).toBeLessThan(SIZE);
  expect(query('SELECT status FROM crawls')).toEqual([{ status: 'running' }]);

  // Second run: a minute later, so the dead runner's lease has expired.
  const output = await runWorker(['60000']);
  expect(output).toMatch(/^Resuming the crawl/);
  expect(query('SELECT status FROM crawls')).toEqual([{ status: 'completed' }]);

  // Every page is stored once, with its shortest link depth.
  const stored = query<{ url: string; depth: number }>(
    `SELECT url, depth FROM pages WHERE url LIKE '%/p/%' AND url NOT LIKE '%/'`,
  );
  expect(stored).toHaveLength(SIZE);
  expect(stored.find((page) => page.url.endsWith('/p/1'))?.depth).toBe(1);
  expect(stored.find((page) => page.url.endsWith('/p/2000'))?.depth).toBe(11);

  // At most the batch in flight when the process died is fetched twice.
  const pageHits = [...site.hits].filter(([path]) => path.startsWith('/p/'));
  expect(pageHits).toHaveLength(SIZE);
  const repeats = pageHits.filter(([, hits]) => hits > 1);
  expect(repeats.every(([, hits]) => hits === 2)).toBe(true);
  expect(repeats.length).toBeLessThanOrEqual(10);
  expect(site.hits.get('/robots.txt')).toBe(1);
});
