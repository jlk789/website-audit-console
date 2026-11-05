import { createHash } from 'node:crypto';
import { loadBuffer, type CheerioAPI } from 'cheerio';
import { normalise } from './urls.js';

export type LinkLocation = 'nav' | 'body' | 'footer';

export interface PageLink {
  to: string;
  anchor: string | null;
  nofollow: boolean;
  location: LinkLocation;
}

export interface ParsedPage {
  title: string | null;
  h1: string | null;
  h1Count: number;
  /** Every robots and googlebot meta tag's content, comma-separated. */
  metaRobots: string | null;
  /** The first <link rel="canonical"> in the head, as an absolute URL. */
  canonical: string | null;
  wordCount: number;
  links: PageLink[];
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Reads the fields the checks need from an HTML page. */
export function parseHtml(body: Buffer, pageUrl: string, contentType: string | null): ParsedPage {
  const charset = contentType?.match(/charset=["']?([^;"'\s]+)/i)?.[1];
  const $ = loadBuffer(body, { encoding: { transportLayerEncodingLabel: charset } });
  const base = normalise($('base[href]').attr('href') ?? '', pageUrl) ?? pageUrl;

  const metaRobots = $('meta[name]')
    .toArray()
    .filter((el) => /^(robots|googlebot)$/i.test($(el).attr('name') ?? ''))
    .map((el) => collapse($(el).attr('content') ?? ''))
    .filter(Boolean);

  const canonicalTag = $('head link[rel]')
    .toArray()
    .find((el) => /(^|\s)canonical(\s|$)/i.test($(el).attr('rel') ?? ''));
  const canonicalHref = canonicalTag && $(canonicalTag).attr('href');

  const h1s = $('h1');
  const page = {
    title: collapse($('title').first().text()) || null,
    h1: h1s.length > 0 ? collapse(h1s.first().text()) : null,
    h1Count: h1s.length,
    metaRobots: metaRobots.length > 0 ? metaRobots.join(', ') : null,
    canonical: canonicalHref ? (normalise(canonicalHref, base) ?? canonicalHref) : null,
    links: readLinks($, base),
  };

  $('script, style, noscript, template').remove();
  // A space after every element, so <h1>A</h1><p>B</p> counts as two words.
  $('body *').append(' ');
  const text = collapse($('body').text());
  return { ...page, wordCount: text ? text.split(' ').length : 0 };
}

function readLinks($: CheerioAPI, base: string): PageLink[] {
  const links: PageLink[] = [];
  for (const el of $('a[href], area[href]').toArray()) {
    const link = $(el);
    const to = normalise(link.attr('href') ?? '', base);
    if (!to) continue;
    const rel = (link.attr('rel') ?? '').toLowerCase().split(/\s+/);
    const anchor =
      collapse(link.text()) || link.attr('alt') || link.find('img[alt]').attr('alt') || null;
    // Where the link sits, judged by its nearest landmark element.
    const location: LinkLocation =
      link.closest('nav, header, [role="navigation"], [role="banner"]').length > 0
        ? 'nav'
        : link.closest('footer, [role="contentinfo"]').length > 0
          ? 'footer'
          : 'body';
    links.push({ to, anchor, nofollow: rel.includes('nofollow'), location });
  }
  return links;
}

export const isHtml = (contentType: string | null): boolean =>
  /^\s*(text\/html|application\/xhtml\+xml)/i.test(contentType ?? '');

/** True if the meta robots tag or X-Robots-Tag header says noindex (or none). */
export const saysNoindex = (...directives: (string | null)[]): boolean =>
  directives.some((value) => /\b(noindex|none)\b/i.test(value ?? ''));

export const saysNofollow = (...directives: (string | null)[]): boolean =>
  directives.some((value) => /\b(nofollow|none)\b/i.test(value ?? ''));

export const hashBody = (body: Buffer): string => createHash('sha256').update(body).digest('hex');
