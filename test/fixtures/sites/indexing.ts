// Fixture sites for the indexing checks: a broken site with one fault per
// ranked check, its clean twin, and a small site for each severity-floor check.
import type { GscRow } from '../../helpers/audit-home.js';
import { redirectTo, type WebRoutes } from '../../helpers/fake-web.js';
import type { Route } from '../../helpers/test-site.js';
import { html } from '../../helpers/test-site.js';

export const SITE = 'https://www.example.test/';
export const S = 'https://www.example.test';
export const LATEST = '2026-10-28';

const text = (body: string): Route => ({ headers: { 'content-type': 'text/plain' }, body });
const xml = (body: string): Route => ({ headers: { 'content-type': 'application/xml' }, body });
const sitemap = (paths: string[]) =>
  xml(`<urlset>${paths.map((p) => `<url><loc>${S}${p}</loc></url>`).join('')}</urlset>`);
const links = (paths: string[]) => paths.map((p) => `<a href="${p}">${p}</a>`).join(' ');

/** A page whose canonical points at `canonical` (its own URL by default). */
const page = (
  path: string,
  options: { canonical?: string | null; head?: string; body?: string } = {},
): Route => {
  const canonical = options.canonical === undefined ? `${S}${path}` : options.canonical;
  const tag = canonical === null ? '' : `<link rel="canonical" href="${canonical}">`;
  return { body: html({ title: path, head: `${tag}${options.head ?? ''}`, body: options.body }) };
};
const noindex = '<meta name="robots" content="noindex">';

/** One fault per ranked indexing check. */
export const brokenSite: WebRoutes = (url) => {
  const path = url.startsWith(S) ? url.slice(S.length) : url;
  switch (path) {
    case '/robots.txt':
      return text(`User-agent: *\nDisallow: /private/\nSitemap: ${S}/sitemap.xml\n`);
    case '/sitemap.xml':
      // sitemap-non-200 (/redirected, /gone), sitemap-non-indexable (/noindexed, /canon-away),
      // sitemap-url-robots-blocked (/private/page)
      return sitemap([
        '/',
        '/good',
        '/redirected',
        '/gone',
        '/noindexed',
        '/canon-away',
        '/private/page',
      ]);
    case '/':
      return page('/', {
        body: links([
          '/good',
          '/noindexed',
          '/canon-away',
          '/canon-broken',
          '/chain-a',
          '/no-canonical',
          '/not-in-sitemap',
          '/bulk-1',
          '/bulk-2',
          '/bulk-3',
        ]),
      });
    case '/good':
      return page('/good');
    case '/redirected':
      return redirectTo(`${S}/good`);
    // noindex-with-clicks (has clicks in the seeded data)
    case '/noindexed':
      return page('/noindexed', { head: noindex });
    // canonicalised-away-with-clicks (has clicks in the seeded data)
    case '/canon-away':
      return page('/canon-away', { canonical: `${S}/good` });
    // canonical-to-non-200: canonical points at a redirect
    case '/canon-broken':
      return page('/canon-broken', { canonical: `${S}/redirected` });
    // canonical-chain: /chain-a → /chain-b → /good
    case '/chain-a':
      return page('/chain-a', { canonical: `${S}/chain-b` });
    case '/chain-b':
      return page('/chain-b', { canonical: `${S}/good` });
    // missing-canonical
    case '/no-canonical':
      return page('/no-canonical', { canonical: null });
    // indexable-not-in-sitemap (and, with the bulk pages, index-bloat-ratio)
    case '/not-in-sitemap':
    case '/bulk-1':
    case '/bulk-2':
    case '/bulk-3':
      return page(path);
    default:
      return undefined;
  }
};

export const brokenGsc: GscRow[] = [
  { date: '2026-10-20', page: `${S}/noindexed`, clicks: 7, impressions: 50 },
  { date: '2026-10-20', page: `${S}/canon-away`, clicks: 4, impressions: 40 },
];

const cleanPages = ['/', '/a', '/b', '/c', '/d'];

/** Every page indexable, self-canonical, in the sitemap and earning clicks. */
export const cleanSite: WebRoutes = (url) => {
  const path = url.startsWith(S) ? url.slice(S.length) : url;
  if (path === '/robots.txt') return text(`User-agent: *\nDisallow:\nSitemap: ${S}/sitemap.xml\n`);
  if (path === '/sitemap.xml') return sitemap(cleanPages);
  if (cleanPages.includes(path)) return page(path, { body: links(cleanPages) });
  return undefined;
};

export const cleanGsc: GscRow[] = cleanPages.map((p) => ({
  date: '2026-10-20',
  page: `${S}${p}`,
  clicks: 5,
  impressions: 60,
}));

/** indexing.sitewide-noindex: every page, the homepage included, is noindex. */
export const noindexSite: WebRoutes = (url) => {
  const path = url.slice(S.length);
  if (path === '/robots.txt') return text('User-agent: *\nDisallow:\n');
  if (['/', '/a', '/b', '/c'].includes(path)) {
    return page(path, { head: noindex, body: links(['/a', '/b', '/c']) });
  }
  return undefined;
};

/** indexing.robots-blocks-site: robots.txt disallows everything. */
export const disallowAllSite: WebRoutes = (url) =>
  url === `${S}/robots.txt` ? text('User-agent: *\nDisallow: /\n') : page('/');

/** indexing.robots-blocks-site: robots.txt answers with a server error. */
export const robotsErrorSite: WebRoutes = (url) =>
  url === `${S}/robots.txt` ? { status: 503, body: 'Unavailable' } : page('/');

/** indexing.canonical-all-to-one: every page points its canonical at the homepage. */
export const allToOneSite: WebRoutes = (url) => {
  const path = url.slice(S.length);
  if (path === '/robots.txt') return text('User-agent: *\nDisallow:\n');
  const paths = ['/', '/a', '/b', '/c', '/d', '/e'];
  if (paths.includes(path)) return page(path, { canonical: `${S}/`, body: links(paths) });
  return undefined;
};

/**
 * indexing.indexed-pages-collapse: 20 pages earn impressions in each of the
 * three weeks before the last, but only 3 in the last 7 days.
 */
export function collapseGsc(steady: boolean): GscRow[] {
  const pages = Array.from({ length: 20 }, (_, i) => `${S}/p${i + 1}`);
  const row = (date: string, page: string): GscRow => ({ date, page, clicks: 0, impressions: 10 });
  return [
    ...['2026-10-01', '2026-10-08', '2026-10-15'].flatMap((date) => pages.map((p) => row(date, p))),
    ...(steady ? pages : pages.slice(0, 3)).map((p) => row('2026-10-25', p)),
  ];
}
