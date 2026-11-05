import { gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import type { HttpSettings } from './fetch.js';
import { fetchFile } from './fetch.js';
import { normalise } from './urls.js';

/** Sitemap files read per crawl, including those listed in sitemap indexes. */
export const MAX_SITEMAP_FILES = 200;
/** Google's limit for one uncompressed sitemap. */
export const MAX_SITEMAP_BYTES = 50_000_000;

export interface SitemapFile {
  url: string;
  /** "robots.txt", "default location", or the sitemap index that lists it. */
  foundIn: string;
  status: number | null;
  urlCount: number;
  error: string | null;
}

export interface SitemapEntry {
  sitemapUrl: string;
  url: string;
  lastmod: string | null;
}

export interface ParsedSitemap {
  /** From a sitemap index: more sitemaps to read. */
  sitemaps: string[];
  urls: { url: string; lastmod: string | null }[];
}

/** Reads an XML sitemap or sitemap index, gzipped or not, or a plain-text list of URLs. */
export function parseSitemap(data: Buffer, sitemapUrl: string): ParsedSitemap {
  const gzipped = data[0] === 0x1f && data[1] === 0x8b;
  const decoded = (
    gzipped ? gunzipSync(data, { maxOutputLength: MAX_SITEMAP_BYTES }) : data
  ).toString('utf8');
  // Drop a byte-order mark.
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;

  if (!text.trimStart().startsWith('<')) {
    const urls = text
      .split(/\r?\n/)
      // Only absolute URLs: other lines are not URLs at all.
      .map((line) => normalise(line))
      .filter((url): url is string => url !== undefined);
    return { sitemaps: [], urls: urls.map((url) => ({ url, lastmod: null })) };
  }

  const $ = load(text, { xml: true });
  const sitemaps = $('sitemapindex > sitemap > loc')
    .toArray()
    .map((el) => normalise($(el).text(), sitemapUrl))
    .filter((url): url is string => url !== undefined);
  const urls = $('urlset > url')
    .toArray()
    .flatMap((el) => {
      const url = normalise($(el).children('loc').first().text(), sitemapUrl);
      const lastmod = $(el).children('lastmod').first().text().trim() || null;
      return url ? [{ url, lastmod }] : [];
    });
  return { sitemaps, urls };
}

/** Reads each sitemap and every sitemap its indexes list, up to MAX_SITEMAP_FILES. */
export async function readSitemaps(
  roots: { url: string; foundIn: string }[],
  http: HttpSettings,
): Promise<{ files: SitemapFile[]; entries: SitemapEntry[] }> {
  const files: SitemapFile[] = [];
  const entries: SitemapEntry[] = [];
  const queue = [...roots];
  const seen = new Set(roots.map((root) => root.url));
  const settings = { ...http, maxBytes: MAX_SITEMAP_BYTES };

  while (queue.length > 0 && files.length < MAX_SITEMAP_FILES) {
    const { url, foundIn } = queue.shift()!;
    const response = await fetchFile(url, settings);
    const file: SitemapFile = { url, foundIn, status: response.status, urlCount: 0, error: null };
    files.push(file);

    if (response.status !== 200 || !response.body) {
      file.error = response.error ?? (response.status === null ? null : `HTTP ${response.status}`);
      continue;
    }
    let parsed: ParsedSitemap;
    try {
      parsed = parseSitemap(response.body, url);
    } catch (error) {
      file.error = `could not be read: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    file.urlCount = parsed.urls.length;
    entries.push(...parsed.urls.map((entry) => ({ sitemapUrl: url, ...entry })));
    for (const child of parsed.sitemaps) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push({ url: child, foundIn: url });
    }
  }
  return { files, entries };
}
