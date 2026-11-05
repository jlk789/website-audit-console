import type { Db } from '../../db/open.js';
import type { JobHandler } from '../../jobs/runner.js';
import {
  fetchFile,
  fetchWithHops,
  type Fetched,
  type FinalResponse,
  type HttpSettings,
} from './fetch.js';
import {
  hashBody,
  isHtml,
  parseHtml,
  saysNofollow,
  saysNoindex,
  type ParsedPage,
} from './parse.js';
import { parseRobots, robotsAllow, type RobotsFile } from './robots.js';
import { readSitemaps } from './sitemaps.js';
import {
  countQueue,
  enqueueUrl,
  finishCrawl,
  gscPages,
  isDone,
  loadCrawl,
  loadRobots,
  markDone,
  nextPending,
  saveHops,
  saveLinks,
  savePage,
  saveRobots,
  saveSitemaps,
  summarise,
  type CrawlRow,
  type StoredRobots,
} from './store.js';
import { hostVariants, missingPageUrl, normalise, originOf, pathOf, toggleSlash } from './urls.js';

export const CRAWL_JOB = 'crawl';

/** Bytes read from one page. */
export const MAX_PAGE_BYTES = 5_000_000;
/** Google reads at most 500 KiB of a robots.txt. */
const MAX_ROBOTS_BYTES = 500 * 1024;
/** Pages whose slash/no-slash twin is requested, to test for duplicates. */
const SLASH_PROBES = 20;
/** Progress is reported each time this many more pages are done. */
const REPORT_EVERY = 50;

export interface CrawlPayload {
  crawlId: string;
}

export interface CrawlerOptions {
  /** Prints one line of progress. */
  report: (line: string) => void;
  now?: () => Date;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

interface QueueItem {
  url: string;
  depth: number | null;
}

interface Visit extends QueueItem {
  blocked: boolean;
  fetched: Fetched | null;
  parsed: ParsedPage | null;
  fetchedAt: string;
}

/**
 * The crawl job. First it reads robots.txt and the sitemaps and fills the
 * crawl's URL list (one step). Then it visits pending URLs in batches, saving
 * each batch with its newly found links in one step, so a stopped or killed
 * crawl resumes at the next unvisited URL. Last, it copies depth and sitemap
 * membership onto each page and marks the crawl completed.
 */
export function crawlHandler(options: CrawlerOptions): JobHandler {
  const now = options.now ?? (() => new Date());

  return async (ctx) => {
    const { crawlId } = ctx.payload as CrawlPayload;
    const crawl = loadCrawl(ctx.db, crawlId);
    // Replaced by `crawl --new` while this job waited.
    if (!crawl || crawl.status !== 'running') return;

    const http: HttpSettings = {
      userAgent: crawl.settings.userAgent,
      timeoutMs: options.timeoutMs ?? 20_000,
      maxBytes: MAX_PAGE_BYTES,
      retryDelayMs: options.retryDelayMs ?? 2_000,
      fetch: options.fetch ?? fetch,
    };
    const site = originOf(crawl.startUrl);
    const inSite = (url: string) => originOf(url) === site;

    // robots.txt is fetched once, at the start, and obeyed for the site's own origin.
    // It is saved in the set-up step, so a stored copy means set-up is done.
    let robots = loadRobots(ctx.db, crawlId).find((file) => file.origin === site);
    if (!robots) {
      const fetched = await fetchRobots(site, http, now);
      ctx.step(await setUp(ctx.db, crawl, fetched, http, now, options.report), { phase: 'fetch' });
      robots = fetched;
      if (ctx.signal.aborted) return;
    }
    const robotsFile = toRobotsFile(robots);
    const allowed = (url: string) => !inSite(url) || robotsAllow(robotsFile, pathOf(url));

    const visit = async (item: QueueItem): Promise<Visit> => {
      const fetchedAt = now().toISOString();
      if (!allowed(item.url))
        return { ...item, blocked: true, fetched: null, parsed: null, fetchedAt };
      const fetched = await fetchWithHops(item.url, http, {
        allowed: async (url) => allowed(url),
        wantBody: (url, contentType) => inSite(url) && isHtml(contentType),
      });
      const final = fetched.final;
      const parsed = final?.body ? parseHtml(final.body, final.url, final.contentType) : null;
      return { ...item, blocked: false, fetched, parsed, fetchedAt };
    };

    const batchSize = crawl.settings.concurrency * 5;
    let { done } = countQueue(ctx.db, crawlId);
    while (!ctx.signal.aborted && done < crawl.settings.maxPages) {
      const batch = nextPending(
        ctx.db,
        crawlId,
        Math.min(batchSize, crawl.settings.maxPages - done),
      );
      if (batch.length === 0) break;
      const visits = await pool(batch, crawl.settings.concurrency, visit);
      ctx.step(
        () => {
          for (const v of visits) saveVisit(ctx.db, crawlId, v, inSite);
        },
        { phase: 'fetch' },
      );

      const before = done;
      const counts = countQueue(ctx.db, crawlId);
      done = counts.done;
      if (Math.floor(done / REPORT_EVERY) > Math.floor(before / REPORT_EVERY)) {
        options.report(`${fmt(done)} pages crawled, ${fmt(counts.pending)} waiting.`);
      }
    }
    if (ctx.signal.aborted) return;

    ctx.step(() => finishCrawl(ctx.db, crawlId, now().toISOString()), { phase: 'done' });
    reportSummary(ctx.db, crawl, options.report);
  };
}

async function fetchRobots(
  origin: string,
  http: HttpSettings,
  now: () => Date,
): Promise<StoredRobots> {
  const response = await fetchFile(`${origin}/robots.txt`, { ...http, maxBytes: MAX_ROBOTS_BYTES });
  const ok = response.status !== null && response.status >= 200 && response.status < 300;
  return {
    origin,
    status: response.status,
    body: ok && response.body ? response.body.toString('utf8') : null,
    error: response.error,
    fetchedAt: now().toISOString(),
  };
}

const toRobotsFile = (stored: StoredRobots): RobotsFile => ({
  status: stored.status,
  robots: stored.body === null ? null : parseRobots(stored.body),
});

/**
 * Reads the sitemaps and returns the step that saves robots.txt, the
 * sitemaps and the starting URLs: the start URL, every sitemap URL and every
 * page with Search Console history, plus a few test requests ("probes").
 */
async function setUp(
  db: Db,
  crawl: CrawlRow,
  robots: StoredRobots,
  http: HttpSettings,
  now: () => Date,
  report: (line: string) => void,
): Promise<() => void> {
  const site = originOf(crawl.startUrl);
  const inSite = (url: string) => originOf(url) === site;
  const parsed = toRobotsFile(robots);

  if (!robotsAllow(parsed, '/')) {
    report(
      robots.status === null || robots.status === 429 || robots.status >= 500
        ? `robots.txt could not be fetched (${robots.error ?? `HTTP ${robots.status}`}). Crawlers must then treat the whole site as blocked.`
        : 'robots.txt blocks the homepage for this crawler.',
    );
  }

  const listed = (parsed.robots?.sitemaps ?? [])
    .map((url) => normalise(url, site))
    .filter((url): url is string => url !== undefined);
  const roots =
    listed.length > 0
      ? listed.map((url) => ({ url, foundIn: 'robots.txt' }))
      : [{ url: `${site}/sitemap.xml`, foundIn: 'default location' }];
  const { files, entries } = await readSitemaps(roots, http);
  const fromGsc = gscPages(db, crawl.propertyId).filter(inSite);
  const fromSitemaps = entries.map((entry) => entry.url).filter(inSite);

  const twins = [...new Set([...fromGsc, ...fromSitemaps])]
    .slice(0, SLASH_PROBES)
    .map(toggleSlash)
    .filter((url): url is string => url !== undefined);
  const probes = [
    ...hostVariants(crawl.startUrl),
    missingPageUrl(crawl.startUrl, crawl.id),
    ...twins,
  ];

  report(
    `robots.txt: ${robots.status ?? robots.error}. Sitemaps: ${files.length} file(s) listing ${fmt(new Set(fromSitemaps).size)} URLs on the site.`,
  );

  return () => {
    saveRobots(db, crawl.id, robots);
    saveSitemaps(db, crawl.id, files, entries, now().toISOString());
    enqueueUrl(db, crawl.id, crawl.startUrl, 'start', 0);
    for (const url of fromSitemaps) enqueueUrl(db, crawl.id, url, 'sitemap', null);
    for (const url of fromGsc) enqueueUrl(db, crawl.id, url, 'gsc', null);
    for (const url of probes) enqueueUrl(db, crawl.id, url, 'probe', null);
  };
}

/** Saves one visited URL: its page row, redirect hops, links, and the URLs it leads to. */
function saveVisit(db: Db, crawlId: string, visit: Visit, inSite: (url: string) => boolean): void {
  const { url, depth, fetchedAt } = visit;
  markDone(db, crawlId, url, 'link', depth);

  if (visit.blocked || !visit.fetched) {
    savePage(db, crawlId, { ...emptyPage(url, fetchedAt), robotsBlocked: true });
    return;
  }

  const { hops, final, stopped } = visit.fetched;
  saveHops(db, crawlId, url, hops);
  if (hops.length > 0) {
    savePage(db, crawlId, {
      ...emptyPage(url, fetchedAt),
      status: hops[0]!.status,
      fetchError: stopped,
    });
    // A chain stopped by robots.txt: queue the target so it is recorded as blocked.
    const last = hops.at(-1)!.target;
    if (stopped && last && inSite(last)) enqueueUrl(db, crawlId, last, 'redirect', depth);
  }
  if (!final) return;

  // The response at the end of a chain is the page at that URL, unless it was already crawled.
  const isStart = final.url === url;
  if (!isStart && (!inSite(final.url) || isDone(db, crawlId, final.url))) return;
  if (!isStart) markDone(db, crawlId, final.url, 'redirect', depth);
  saveResponse(db, crawlId, final, visit.parsed, depth, fetchedAt, inSite);
}

function saveResponse(
  db: Db,
  crawlId: string,
  final: FinalResponse,
  parsed: ParsedPage | null,
  depth: number | null,
  fetchedAt: string,
  inSite: (url: string) => boolean,
): void {
  const noindex = saysNoindex(parsed?.metaRobots ?? null, final.xRobotsTag);
  const selfCanonical = !parsed?.canonical || parsed.canonical === final.url;
  savePage(db, crawlId, {
    url: final.url,
    status: final.status,
    contentType: final.contentType,
    title: parsed?.title ?? null,
    h1: parsed?.h1 ?? null,
    h1Count: parsed?.h1Count ?? null,
    metaRobots: parsed?.metaRobots ?? null,
    xRobotsTag: final.xRobotsTag,
    canonical: parsed?.canonical ?? null,
    wordCount: parsed?.wordCount ?? null,
    indexable: final.status === 200 && parsed !== null && !noindex && selfCanonical,
    bodyHash: final.body ? hashBody(final.body) : null,
    robotsBlocked: false,
    fetchError: final.error,
    fetchedAt,
  });
  if (!parsed) return;

  saveLinks(db, crawlId, final.url, parsed.links);
  // Visit canonical targets too, so checks can see whether they answer and where they point.
  // Only from 200 pages: search engines ignore the canonical on an error page.
  // (A canonical that is not a valid URL is stored as written, so normalise before using it.)
  const canonical = parsed.canonical ? normalise(parsed.canonical) : undefined;
  if (final.status === 200 && canonical && canonical !== final.url && inSite(canonical)) {
    enqueueUrl(db, crawlId, canonical, 'canonical', null);
  }
  // Follow links the way a search engine would: not from a nofollow page, not rel="nofollow".
  if (saysNofollow(parsed.metaRobots, final.xRobotsTag)) return;
  for (const link of parsed.links) {
    if (link.nofollow || !inSite(link.to)) continue;
    enqueueUrl(db, crawlId, link.to, 'link', depth === null ? null : depth + 1);
  }
}

const emptyPage = (url: string, fetchedAt: string) => ({
  url,
  status: null,
  contentType: null,
  title: null,
  h1: null,
  h1Count: null,
  metaRobots: null,
  xRobotsTag: null,
  canonical: null,
  wordCount: null,
  indexable: false,
  bodyHash: null,
  robotsBlocked: false,
  fetchError: null,
  fetchedAt,
});

/** Runs `work` on every item, at most `size` at a time, keeping the order. */
async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

const fmt = (n: number) => n.toLocaleString('en');

function reportSummary(db: Db, crawl: CrawlRow, report: (line: string) => void): void {
  const s = summarise(db, crawl.id);
  report(
    `Crawl finished: ${fmt(s.pages)} URLs. ${fmt(s.ok)} OK, ${fmt(s.redirects)} redirects, ` +
      `${fmt(s.clientErrors)} not found or other 4xx, ${fmt(s.serverErrors)} server errors, ` +
      `${fmt(s.blocked)} blocked by robots.txt, ${fmt(s.failed)} failed to load.`,
  );
  report(`Sitemaps: ${fmt(s.sitemapFiles)} file(s) listing ${fmt(s.sitemapUrls)} URLs.`);
  if (s.notCrawled > 0) {
    report(
      `Stopped at the ${fmt(crawl.settings.maxPages)}-page limit; ${fmt(s.notCrawled)} URLs found but not crawled.`,
    );
  }
}
