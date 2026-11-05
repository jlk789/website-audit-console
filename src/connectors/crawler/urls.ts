import { isIP } from 'node:net';

/** Longer URLs are almost always crawl traps, so the crawler skips them. */
export const MAX_URL_LENGTH = 2000;

/**
 * Resolves `href` against `base` and drops the #fragment. Returns undefined
 * for anything that is not an http(s) URL (mailto:, javascript:, junk).
 */
export function normalise(href: string, base?: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href.trim(), base);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  url.hash = '';
  return url.href.length > MAX_URL_LENGTH ? undefined : url.href;
}

export const originOf = (url: string): string => new URL(url).origin;

/** Path and query, which is what robots.txt rules match against. */
export function pathOf(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

/**
 * The site's homepage on the other scheme and on the other www/non-www host,
 * e.g. for https://www.example.com/: http://www.example.com/,
 * https://example.com/ and http://example.com/.
 */
export function hostVariants(siteUrl: string): string[] {
  const site = new URL(siteUrl);
  const hosts = [site.host];
  if (!isIP(site.hostname) && site.hostname !== 'localhost') {
    hosts.push(site.hostname.startsWith('www.') ? site.host.slice(4) : `www.${site.host}`);
  }
  const variants: string[] = [];
  for (const protocol of ['https:', 'http:']) {
    for (const host of hosts) {
      const href = `${protocol}//${host}/`;
      if (href !== `${site.origin}/`) variants.push(href);
    }
  }
  return variants;
}

/**
 * The same URL with a trailing slash added or removed, to test whether both
 * forms answer. Undefined for the homepage and for file-like paths (/a.pdf).
 */
export function toggleSlash(href: string): string | undefined {
  const url = new URL(href);
  if (url.pathname === '/') return undefined;
  if (url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  } else {
    if (url.pathname.split('/').at(-1)?.includes('.')) return undefined;
    url.pathname += '/';
  }
  return url.href;
}

/** Start of the made-up path used by missingPageUrl. */
export const MISSING_PAGE_PATH = '/webmastery-console-missing-page-';

/** A URL that should not exist, to test whether the site answers 404 for missing pages. */
export function missingPageUrl(siteUrl: string, crawlId: string): string {
  return `${originOf(siteUrl)}${MISSING_PAGE_PATH}${crawlId.slice(0, 8)}`;
}
