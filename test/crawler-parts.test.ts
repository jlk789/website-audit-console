import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseHtml, saysNoindex } from '../src/connectors/crawler/parse.js';
import { isAllowed, parseRobots, robotsAllow } from '../src/connectors/crawler/robots.js';
import { parseSitemap } from '../src/connectors/crawler/sitemaps.js';
import { hostVariants, normalise, toggleSlash } from '../src/connectors/crawler/urls.js';

describe('urls', () => {
  it('resolves links, drops fragments and rejects non-web schemes', () => {
    expect(normalise('../b?x=1#top', 'https://Example.com/a/c')).toBe('https://example.com/b?x=1');
    expect(normalise('mailto:me@example.com')).toBeUndefined();
    expect(normalise('javascript:void(0)', 'https://example.com/')).toBeUndefined();
    expect(normalise('https://example.com:443/')).toBe('https://example.com/');
  });

  it('lists the homepage on the other scheme and host', () => {
    expect(hostVariants('https://www.example.com/')).toEqual([
      'https://example.com/',
      'http://www.example.com/',
      'http://example.com/',
    ]);
    expect(hostVariants('http://127.0.0.1:8080/')).toEqual(['https://127.0.0.1:8080/']);
  });

  it('toggles a trailing slash, but not on the homepage or a file', () => {
    expect(toggleSlash('https://example.com/a/')).toBe('https://example.com/a');
    expect(toggleSlash('https://example.com/a?x=1')).toBe('https://example.com/a/?x=1');
    expect(toggleSlash('https://example.com/')).toBeUndefined();
    expect(toggleSlash('https://example.com/file.pdf')).toBeUndefined();
  });
});

describe('robots.txt', () => {
  const robots = parseRobots(
    [
      'User-agent: *',
      'Disallow: /private/',
      'Allow: /private/open',
      'Disallow: /*.pdf$',
      '',
      'User-agent: Googlebot',
      'User-agent: webmastery-console/0.1',
      'Disallow: /no-bots   # comment',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\r\n'),
  );

  it('uses the group naming this crawler instead of "*"', () => {
    expect(isAllowed(robots, '/no-bots/page')).toBe(false);
    expect(isAllowed(robots, '/private/x')).toBe(true);
    expect(isAllowed(robots, '/private/x', 'otherbot')).toBe(false);
  });

  it('picks the longest match, with wildcards and end anchors', () => {
    const other = 'otherbot';
    expect(isAllowed(robots, '/private/open/a', other)).toBe(true);
    expect(isAllowed(robots, '/files/a.pdf', other)).toBe(false);
    expect(isAllowed(robots, '/files/a.pdf?x=1', other)).toBe(true);
  });

  it('lets Allow win a tie and always allows robots.txt itself', () => {
    const tie = parseRobots('User-agent: *\nDisallow: /page\nAllow: /page');
    expect(isAllowed(tie, '/page')).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /'), '/robots.txt')).toBe(true);
  });

  it('keeps every line with its group, and the sitemaps', () => {
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(robots.lines.find((line) => line.value === '/no-bots')).toEqual({
      lineNo: 8,
      directive: 'disallow',
      value: '/no-bots',
      userAgent: 'googlebot, webmastery-console/0.1',
    });
  });

  it('treats a missing file as allow-all and an erroring one as block-all', () => {
    expect(robotsAllow({ status: 404, robots: null }, '/a')).toBe(true);
    expect(robotsAllow({ status: 503, robots: null }, '/a')).toBe(false);
    expect(robotsAllow({ status: null, robots: null }, '/a')).toBe(false);
  });
});

describe('parseHtml', () => {
  const page = (markup: string, contentType = 'text/html; charset=utf-8') =>
    parseHtml(Buffer.from(markup, 'latin1'), 'https://example.com/dir/page', contentType);

  it('reads the fields the checks use', () => {
    const parsed = page(
      `<html><head><title> My
        page </title><meta name="robots" content="noindex, follow">
        <meta name="googlebot" content="nosnippet">
        <link rel="canonical" href="/canonical"></head>
       <body><h1>Main</h1><h1>Second</h1><p>One two three.</p>
       <script>var notWords = 1;</script></body></html>`,
    );
    expect(parsed).toMatchObject({
      title: 'My page',
      h1: 'Main',
      h1Count: 2,
      metaRobots: 'noindex, follow, nosnippet',
      canonical: 'https://example.com/canonical',
      wordCount: 5,
    });
    expect(saysNoindex(parsed.metaRobots)).toBe(true);
  });

  it('records links with location, nofollow and anchor, honouring <base>', () => {
    const { links } = page(
      `<html><head><base href="https://example.com/base/"></head><body>
        <nav><a href="a">Nav link</a></nav>
        <main><a href="b" rel="nofollow ugc"><img alt="Pic"></a> <a href="mailto:x@y.z">mail</a></main>
        <footer><a href="/c#part">Footer</a></footer></body></html>`,
    );
    expect(links).toEqual([
      { to: 'https://example.com/base/a', anchor: 'Nav link', nofollow: false, location: 'nav' },
      { to: 'https://example.com/base/b', anchor: 'Pic', nofollow: true, location: 'body' },
      { to: 'https://example.com/c', anchor: 'Footer', nofollow: false, location: 'footer' },
    ]);
  });

  it('decodes the charset the server declares', () => {
    expect(page('<title>Café</title>', 'text/html; charset=iso-8859-1').title).toBe('Café');
  });
});

describe('parseSitemap', () => {
  const BOM = String.fromCharCode(0xfeff);

  it('reads a sitemap index', () => {
    const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(Buffer.from(xml), 'https://example.com/index.xml')).toEqual({
      sitemaps: ['https://example.com/a.xml'],
      urls: [],
    });
  });

  it('reads a gzipped urlset, ignoring image tags', () => {
    const xml = `${BOM}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc> https://example.com/a </loc><lastmod>2026-10-01</lastmod>
        <image:image><image:loc>https://example.com/pic.jpg</image:loc></image:image></url>
      <url><loc>https://example.com/b</loc></url></urlset>`;
    expect(parseSitemap(gzipSync(xml), 'https://example.com/s.xml.gz').urls).toEqual([
      { url: 'https://example.com/a', lastmod: '2026-10-01' },
      { url: 'https://example.com/b', lastmod: null },
    ]);
  });

  it('reads a plain-text sitemap', () => {
    expect(
      parseSitemap(Buffer.from('https://example.com/a\nnot a url\n'), 'https://example.com/s.txt')
        .urls,
    ).toEqual([{ url: 'https://example.com/a', lastmod: null }]);
  });
});
