import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

/** Answers a path (with its query string); undefined means 404. */
export type Routes = (path: string, origin: string) => Route | undefined;

export interface TestSite {
  /** e.g. "http://127.0.0.1:53211" */
  origin: string;
  /** How many times each path was requested. */
  hits: Map<string, number>;
  /** Every User-Agent header seen. */
  userAgents: Set<string>;
  close: () => Promise<void>;
}

/** A local HTTP server for crawler tests. HTML responses default to text/html. */
export async function startTestSite(routes: Routes): Promise<TestSite> {
  const hits = new Map<string, number>();
  const userAgents = new Set<string>();
  let origin = '';
  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.set(path, (hits.get(path) ?? 0) + 1);
    userAgents.add(req.headers['user-agent'] ?? '');
    const route = routes(path, origin) ?? { status: 404, body: 'Not found' };
    const body = route.body ?? '';
    res.writeHead(route.status ?? 200, {
      'content-type': 'text/html; charset=utf-8',
      ...route.headers,
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    hits,
    userAgents,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * A generated site of `size` pages: the homepage links to /p/1, and page i
 * links to /p/2i and /p/2i+1, so every page is reachable. With `sitemap`, a
 * sitemap at /sitemap.xml lists them all too.
 */
export function treeSite(size: number, options: { sitemap?: boolean } = {}): Routes {
  const page = (i: number) => {
    const children = [2 * i, 2 * i + 1].filter((n) => n <= size);
    const links = children.map((n) => `<a href="/p/${n}">Page ${n}</a>`).join(' ');
    return html({
      title: `Page ${i}`,
      body: `<nav><a href="/">Home</a></nav><h1>Page ${i}</h1><p>Some words here.</p>${links}`,
    });
  };
  return (path, origin) => {
    if (path === '/') return { body: html({ title: 'Home', body: '<a href="/p/1">Start</a>' }) };
    if (path === '/sitemap.xml' && options.sitemap) {
      const urls = Array.from(
        { length: size },
        (_, i) => `<url><loc>${origin}/p/${i + 1}</loc></url>`,
      );
      return {
        headers: { 'content-type': 'application/xml' },
        body: `<urlset>${urls.join('')}</urlset>`,
      };
    }
    const match = /^\/p\/(\d+)$/.exec(path);
    const i = match ? Number(match[1]) : 0;
    return i >= 1 && i <= size ? { body: page(i) } : undefined;
  };
}

/** A minimal HTML page. */
export function html(options: { title?: string; head?: string; body?: string }): string {
  return `<!doctype html><html><head><title>${options.title ?? 'Page'}</title>${options.head ?? ''}</head><body>${options.body ?? ''}</body></html>`;
}
