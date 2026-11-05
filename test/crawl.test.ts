import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCrawl, USER_AGENT } from '../src/cli/commands/crawl.js';
import { runInit } from '../src/cli/commands/init.js';
import { readConfig, writeConfig } from '../src/config/load.js';
import { configPath, dbPath } from '../src/config/paths.js';
import { openDb } from '../src/db/open.js';
import { enqueue, getJob } from '../src/jobs/queue.js';
import { html, startTestSite, type Route, type TestSite } from './helpers/test-site.js';
import { makeTempHome } from './helpers/temp-home.js';

/**
 * A small site with one of each thing the crawler must record: redirect
 * chains and loops, a robots.txt block, noindex, a canonical elsewhere, a
 * 404, a 500, a nofollow link, an off-site link, and a page only the sitemap lists.
 */
function fixtureSite(path: string, origin: string): Route | undefined {
  const redirect = (status: number, location: string): Route => ({
    status,
    headers: { location },
  });
  switch (path) {
    case '/robots.txt':
      return {
        headers: { 'content-type': 'text/plain' },
        body: `User-agent: *\nDisallow: /private/\nSitemap: ${origin}/sitemap_index.xml\n`,
      };
    case '/sitemap_index.xml':
      return {
        headers: { 'content-type': 'application/xml' },
        body: `<sitemapindex><sitemap><loc>${origin}/pages.xml.gz</loc></sitemap></sitemapindex>`,
      };
    case '/pages.xml.gz':
      return {
        headers: { 'content-type': 'application/gzip' },
        body: gzipSync(
          `<urlset>${['/', '/about', '/orphan', '/private/secret']
            .map((p) => `<url><loc>${origin}${p}</loc></url>`)
            .join('')}</urlset>`,
        ),
      };
    case '/':
      return {
        body: html({
          title: 'Home',
          body: `<nav><a href="/about">About</a></nav>
            <main><a href="/old">Old</a> <a href="/chain-1">Chain</a> <a href="/loop-a">Loop</a>
            <a href="/private/secret">Secret</a> <a href="/noindex">Hidden</a>
            <a href="/canon">Copy</a> <a href="/missing">Gone</a> <a href="/error">Broken</a>
            <a href="https://external.example/">Elsewhere</a></main>
            <footer><a href="/contact" rel="nofollow">Contact</a></footer>`,
        }),
      };
    case '/about':
      return { body: html({ title: 'About', body: '<h1>About us</h1><a href="/">Home</a>' }) };
    case '/orphan':
      return { body: html({ title: 'Orphan', body: '<a href="/orphan-child">Child</a>' }) };
    case '/orphan-child':
      return { body: html({ title: 'Orphan child' }) };
    case '/old':
      return redirect(301, '/about');
    case '/chain-1':
      return redirect(301, '/chain-2');
    case '/chain-2':
      return redirect(302, `${origin}/about`);
    case '/loop-a':
      return redirect(301, '/loop-b');
    case '/loop-b':
      return redirect(301, '/loop-a');
    case '/noindex':
      return { body: html({ head: '<meta name="robots" content="noindex">' }) };
    case '/canon':
      return { body: html({ head: `<link rel="canonical" href="${origin}/canonical-only">` }) };
    case '/canonical-only':
      return { body: html({ title: 'Only reached through a canonical' }) };
    case '/header-noindex':
      return { headers: { 'x-robots-tag': 'noindex' }, body: html({}) };
    case '/error':
      return { status: 500, body: 'Oops' };
    case '/contact':
      return { body: html({ title: 'Contact' }) };
    default:
      return undefined;
  }
}

describe('crawl', () => {
  let temp: ReturnType<typeof makeTempHome>;
  let site: TestSite;
  const lines: string[] = [];
  const report = (line: string) => lines.push(line);
  const crawl = (options: Partial<Parameters<typeof runCrawl>[0]> = {}) =>
    runCrawl({ home: temp.home, report, retryDelayMs: 0, timeoutMs: 5_000, ...options });

  beforeEach(async () => {
    temp = makeTempHome();
    lines.length = 0;
    site = await startTestSite(fixtureSite);
    runInit({ site: `${site.origin}/`, home: temp.home });
  });
  afterEach(async () => {
    await site.close();
    temp.cleanup();
  });

  function query<T>(sql: string, ...params: unknown[]): T[] {
    const db = openDb(dbPath(temp.home));
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  }

  type Page = {
    status: number | null;
    indexable: number;
    in_sitemap: number;
    depth: number | null;
    robots_blocked: number;
    fetch_error: string | null;
  };
  const pages = () =>
    Object.fromEntries(
      query<Page & { url: string }>(
        `SELECT url, status, indexable, in_sitemap, depth, robots_blocked, fetch_error FROM pages`,
      ).map(({ url, ...page }) => [url.replace(site.origin, ''), page]),
    );

  it('records every page, hop, link, robots rule and sitemap', async () => {
    const { crawlId } = await crawl();
    const all = pages();

    expect(all['/']).toMatchObject({ status: 200, indexable: 1, in_sitemap: 1, depth: 0 });
    expect(all['/about']).toMatchObject({ status: 200, indexable: 1, in_sitemap: 1, depth: 1 });
    expect(all['/orphan']).toMatchObject({ status: 200, in_sitemap: 1, depth: null });
    expect(all['/orphan-child']).toMatchObject({ status: 200, in_sitemap: 0, depth: null });
    expect(all['/noindex']).toMatchObject({ status: 200, indexable: 0 });
    expect(all['/canon']).toMatchObject({ status: 200, indexable: 0 });
    expect(all['/missing']).toMatchObject({ status: 404, indexable: 0 });
    expect(all['/error']).toMatchObject({ status: 500 });
    expect(all['/old']).toMatchObject({ status: 301, indexable: 0 });
    expect(all['/loop-a']).toMatchObject({ status: 301, fetch_error: 'redirect loop' });
    expect(all['/private/secret']).toMatchObject({
      status: null,
      robots_blocked: 1,
      in_sitemap: 1,
    });

    // Not followed: the nofollow link and the off-site link.
    expect(all['/contact']).toBeUndefined();
    expect(Object.keys(all).some((url) => url.includes('external.example'))).toBe(false);
    // Robots.txt is obeyed, a 500 is retried once, and the crawler says who it is.
    expect(site.hits.get('/private/secret')).toBeUndefined();
    expect(site.hits.get('/error')).toBe(2);
    expect([...site.userAgents]).toEqual([USER_AGENT]);

    expect(
      query(
        'SELECT hop, from_url, status, target FROM redirect_hops WHERE url = ? ORDER BY hop',
        `${site.origin}/chain-1`,
      ),
    ).toEqual([
      { hop: 0, from_url: `${site.origin}/chain-1`, status: 301, target: `${site.origin}/chain-2` },
      { hop: 1, from_url: `${site.origin}/chain-2`, status: 302, target: `${site.origin}/about` },
    ]);

    expect(
      query(
        `SELECT to_url, anchor, nofollow, location FROM links WHERE from_url = ? AND anchor IN ('About', 'Contact', 'Old')`,
        `${site.origin}/`,
      ),
    ).toEqual([
      { to_url: `${site.origin}/about`, anchor: 'About', nofollow: 0, location: 'nav' },
      { to_url: `${site.origin}/old`, anchor: 'Old', nofollow: 0, location: 'body' },
      { to_url: `${site.origin}/contact`, anchor: 'Contact', nofollow: 1, location: 'footer' },
    ]);

    expect(
      query(`SELECT directive, value, user_agent FROM robots_rules WHERE directive = 'disallow'`),
    ).toEqual([{ directive: 'disallow', value: '/private/', user_agent: '*' }]);
    expect(query('SELECT url, found_in, status, url_count FROM sitemaps ORDER BY url')).toEqual([
      {
        url: `${site.origin}/pages.xml.gz`,
        found_in: `${site.origin}/sitemap_index.xml`,
        status: 200,
        url_count: 4,
      },
      {
        url: `${site.origin}/sitemap_index.xml`,
        found_in: 'robots.txt',
        status: 200,
        url_count: 0,
      },
    ]);

    expect(
      query('SELECT status, finished_at IS NOT NULL AS finished FROM crawls WHERE id = ?', crawlId),
    ).toEqual([{ status: 'completed', finished: 1 }]);
    expect(lines.at(-2)).toMatch(/^Crawl finished: /);
  });

  it('sends probes: other hosts, a missing page, and slash twins', async () => {
    await crawl();
    const probes = query<{ url: string; status: number | null }>(
      `SELECT q.url, p.status FROM crawl_queue q JOIN pages p USING (crawl_id, url) WHERE q.source = 'probe'`,
    );
    const missing = probes.find((p) => p.url.includes('webmastery-console-missing-page-'));
    expect(missing?.status).toBe(404);
    expect(probes.find((p) => p.url === `${site.origin}/about/`)?.status).toBe(404);
    // The https:// version of a plain-http test server cannot answer.
    expect(probes.find((p) => p.url.startsWith('https://'))?.status).toBeNull();
  });

  it('visits canonical targets that no link leads to', async () => {
    await crawl();
    expect(pages()['/canonical-only']).toMatchObject({ status: 200, depth: null });
    expect(
      query(`SELECT source FROM crawl_queue WHERE url = ?`, `${site.origin}/canonical-only`),
    ).toEqual([{ source: 'canonical' }]);
  });

  it('starts from pages with Search Console history', async () => {
    const db = openDb(dbPath(temp.home));
    db.prepare(
      `INSERT INTO gsc_page_daily (property_id, date, page, clicks, impressions, position, fetched_at)
       VALUES (1, '2026-10-01', ?, 5, 50, 3, '2026-10-02')`,
    ).run(`${site.origin}/header-noindex`);
    db.close();

    await crawl();
    expect(pages()['/header-noindex']).toMatchObject({ status: 200, indexable: 0, depth: null });
    expect(
      query(`SELECT source FROM crawl_queue WHERE url = ?`, `${site.origin}/header-noindex`),
    ).toEqual([{ source: 'gsc' }]);
  });

  it('stops at the page limit and says how much was left', async () => {
    await crawl({ maxPages: 3 });
    expect(query<{ n: number }>('SELECT COUNT(*) AS n FROM pages')[0]!.n).toBe(3);
    expect(lines.at(-1)).toMatch(/Stopped at the 3-page limit; \d+ URLs found but not crawled/);
  });

  it('resumes after Ctrl+C without fetching any page twice', async () => {
    const controller = new AbortController();
    let fetches = 0;
    await crawl({
      signal: controller.signal,
      fetch: (input, init) => {
        if (++fetches === 6) controller.abort();
        return fetch(input, init);
      },
    });
    const crawlId = query<{ id: string; status: string }>('SELECT id, status FROM crawls')[0]!;
    expect(crawlId.status).toBe('running');
    const firstPass = query<{ n: number }>('SELECT COUNT(*) AS n FROM pages')[0]!.n;
    expect(firstPass).toBeGreaterThan(0);

    await crawl();
    expect(lines).toContain(
      `Resuming the crawl started ${query<{ started_at: string }>('SELECT started_at FROM crawls')[0]!.started_at}.`,
    );
    expect(query('SELECT status FROM crawls')).toEqual([{ status: 'completed' }]);
    // Each URL is requested once across both runs, robots.txt and the sitemaps
    // included. The exceptions: a retried 500, and URLs that redirect chains
    // also reach, which are requested once per chain.
    const chainTargets = ['/about', '/chain-2', '/loop-b'];
    for (const [path, hits] of site.hits) {
      if (path === '/error') expect(hits).toBe(2);
      else if (!chainTargets.includes(path)) expect(hits, path).toBe(1);
    }
  });

  it('starts over with --new, keeping the old crawl', async () => {
    const controller = new AbortController();
    controller.abort();
    await crawl({ signal: controller.signal });
    await crawl({ fresh: true });
    expect(query('SELECT status FROM crawls ORDER BY started_at, status')).toEqual([
      { status: 'abandoned' },
      { status: 'completed' },
    ]);
  });

  it('leaves a paused Search Console sync alone', async () => {
    const db = openDb(dbPath(temp.home));
    const syncJob = enqueue(db, 'gsc-sync', { propertyId: 1 });
    db.close();

    await crawl();
    const after = openDb(dbPath(temp.home));
    expect(getJob(after, syncJob)?.state).toBe('queued');
    after.close();
  });

  it('uses the concurrency from the config', async () => {
    const file = configPath(temp.home);
    writeConfig(file, { ...readConfig(file), crawl: { maxPages: 100, concurrency: 4 } });
    await crawl();
    expect(
      JSON.parse(query<{ settings: string }>('SELECT settings FROM crawls')[0]!.settings),
    ).toMatchObject({ maxPages: 100, concurrency: 4 });
  });
});
