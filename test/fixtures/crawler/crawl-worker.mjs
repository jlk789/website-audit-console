// Runs `crawl` in its own process, so test/crawl-kill.test.ts can hard-kill
// it partway through. Uses the compiled code in dist/.
//
// Usage: node crawl-worker.mjs <home folder> [clock offset in ms]
import process from 'node:process';
import { runCrawl } from '../../../dist/cli/commands/crawl.js';

const [home, offset = '0'] = process.argv.slice(2);

await runCrawl({
  home,
  report: (line) => process.stdout.write(`${line}\n`),
  now: () => new Date(Date.now() + Number(offset)),
});
