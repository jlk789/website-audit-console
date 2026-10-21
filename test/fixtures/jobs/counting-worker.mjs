// Runs the queued "count" job in its own process, so test/jobs-kill.test.ts
// can hard-kill it partway through. Uses the compiled code in dist/.
//
// Usage: node counting-worker.mjs <database file> [clock offset in ms]
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDb } from '../../../dist/db/open.js';
import { runJobs } from '../../../dist/jobs/runner.js';

const [dbFile, offset = '0'] = process.argv.slice(2);
const db = openDb(dbFile);
const insert = db.prepare('INSERT INTO counted (n) VALUES (?)');

await runJobs(
  db,
  {
    count: async (ctx) => {
      let next = ctx.checkpoint?.next ?? 1;
      while (next <= 20) {
        const n = next;
        ctx.step(() => insert.run(n), { next: n + 1 });
        process.stdout.write(`${n}\n`);
        next = n + 1;
        await sleep(25);
      }
    },
  },
  { now: () => new Date(Date.now() + Number(offset)) },
);
db.close();
