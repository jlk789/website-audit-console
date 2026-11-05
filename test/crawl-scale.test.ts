import { afterEach, beforeEach, expect, it } from 'vitest';
import { runCrawl } from '../src/cli/commands/crawl.js';
import { runInit } from '../src/cli/commands/init.js';
import { readConfig, writeConfig } from '../src/config/load.js';
import { configPath, dbPath } from '../src/config/paths.js';
import { openDb } from '../src/db/open.js';
import { startTestSite, treeSite, type TestSite } from './helpers/test-site.js';
import { makeTempHome } from './helpers/temp-home.js';

// The v0.1 plan's "done when" for M3: crawl handles 10,000 pages.
const SIZE = 10_000;

let temp: ReturnType<typeof makeTempHome>;
let site: TestSite;

beforeEach(async () => {
  temp = makeTempHome();
  site = await startTestSite(treeSite(SIZE, { sitemap: true }));
  runInit({ site: `${site.origin}/`, home: temp.home });
  const file = configPath(temp.home);
  writeConfig(file, { ...readConfig(file), crawl: { maxPages: 20_000, concurrency: 8 } });
});
afterEach(async () => {
  await site.close();
  temp.cleanup();
});

it('crawls a 10,000-page site', { timeout: 300_000 }, async () => {
  const lines: string[] = [];
  await runCrawl({ home: temp.home, report: (line) => lines.push(line) });

  const db = openDb(dbPath(temp.home));
  try {
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS pages, SUM(status = 200) AS ok, SUM(in_sitemap) AS inSitemap,
                MAX(depth) AS maxDepth
           FROM pages WHERE url LIKE '%/p/%' AND url NOT LIKE '%/'`,
      )
      .get();
    // Page 10,000 is 14 links from the homepage: / → /p/1 → … → /p/10000.
    expect(counts).toEqual({ pages: SIZE, ok: SIZE, inSitemap: SIZE, maxDepth: 14 });
  } finally {
    db.close();
  }
  expect(lines.filter((line) => / pages crawled, /.test(line)).length).toBeGreaterThan(100);
  expect(lines.some((line) => line.startsWith('Crawl finished: '))).toBe(true);
});
