// Fixture sites for the redirects and hosts-and-404s checks: a broken site
// with one fault per check, and a clean twin on which none should fire.
import type { GscRow } from '../../helpers/audit-home.js';
import { redirectTo, type WebRoutes } from '../../helpers/fake-web.js';
import { html } from '../../helpers/test-site.js';

export const SITE = 'https://www.example.test/';
const S = 'https://www.example.test';
export const LATEST = '2026-10-28';

const robots = {
  headers: { 'content-type': 'text/plain' },
  body: `User-agent: *\nDisallow:\n`,
};

/** Every fault, each linked from the homepage. */
export const brokenSite: WebRoutes = (url) => {
  switch (url) {
    case `${S}/robots.txt`:
      return robots;
    case `${S}/`:
      return {
        body: html({
          title: 'Home',
          body: [
            '/page',
            '/chain-1',
            '/loop-a',
            '/old-product',
            '/moved',
            '/dead-redirect',
            '/dup',
            '/dup/',
            '/broken',
            '/oops',
          ]
            .map((p) => `<a href="${p}">${p}</a>`)
            .join(' '),
        }),
      };
    case `${S}/page`:
      return { body: html({ title: 'Page', body: '<h1>Page</h1>' }) };
    // redirects.chain (and internal-links-to-redirects)
    case `${S}/chain-1`:
      return redirectTo(`${S}/chain-2`);
    case `${S}/chain-2`:
      return redirectTo(`${S}/page`);
    // redirects.loop
    case `${S}/loop-a`:
      return redirectTo(`${S}/loop-b`);
    case `${S}/loop-b`:
      return redirectTo(`${S}/loop-a`);
    // redirects.deep-to-homepage
    case `${S}/old-product`:
      return redirectTo(`${S}/`);
    // redirects.temporary-with-traffic (has clicks in the seeded data)
    case `${S}/moved`:
      return redirectTo(`${S}/page`, 302);
    // redirects.to-error
    case `${S}/dead-redirect`:
      return redirectTo(`${S}/gone`);
    case `${S}/gone`:
      return { status: 404, body: html({ title: 'Gone' }) };
    // hosts-and-404s.trailing-slash-duplicates
    case `${S}/dup`:
    case `${S}/dup/`:
      return { body: html({ title: 'Duplicate', body: '<p>Same words.</p>' }) };
    // hosts-and-404s.404-with-history (seeded history; /page wins its query)
    case `${S}/removed/`:
      return { status: 404, body: html({ title: 'Missing' }) };
    // hosts-and-404s.server-errors
    case `${S}/broken`:
      return { status: 503, body: 'Down' };
    // hosts-and-404s.http-not-redirected: http answers, or redirects but stays on http
    case 'http://www.example.test/':
      return { body: html({ title: 'Home over http' }) };
    case 'http://example.test/':
      return redirectTo('http://www.example.test/');
    // hosts-and-404s.www-apex-both-resolve
    case 'https://example.test/':
      return { body: html({ title: 'Home without www' }) };
    default:
      // hosts-and-404s.soft-404: unknown URLs, the made-up probe included, answer 200.
      if (url.startsWith(S)) {
        return { body: html({ title: 'Sorry, page not found', body: '<h1>Not found</h1>' }) };
      }
      return undefined;
  }
};

export const brokenGsc: GscRow[] = [
  { date: '2026-10-20', page: `${S}/moved`, clicks: 12, impressions: 100 },
  { date: '2026-09-01', page: `${S}/removed/`, clicks: 9, impressions: 80, query: 'widgets' },
  { date: '2026-10-20', page: `${S}/page`, clicks: 30, impressions: 300, query: 'widgets' },
];

/** The same site with every fault fixed. */
export const cleanSite: WebRoutes = (url) => {
  switch (url) {
    case `${S}/robots.txt`:
      return robots;
    case `${S}/`:
      return {
        body: html({ title: 'Home', body: '<a href="/page">Page</a> <a href="/about/">About</a>' }),
      };
    case `${S}/page`:
      return { body: html({ title: 'Page', body: '<h1>Page</h1>' }) };
    case `${S}/about/`:
      return { body: html({ title: 'About', body: '<h1>About</h1>' }) };
    case `${S}/about`:
      return redirectTo(`${S}/about/`);
    case 'http://www.example.test/':
    case 'http://example.test/':
    case 'https://example.test/':
      return redirectTo(`${S}/`);
    default:
      return undefined;
  }
};

export const cleanGsc: GscRow[] = [
  { date: '2026-10-20', page: `${S}/page`, clicks: 30, impressions: 300, query: 'widgets' },
  { date: '2026-10-20', page: `${S}/about/`, clicks: 3, impressions: 40, query: 'about us' },
];
