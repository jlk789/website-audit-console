import type { Route } from './test-site.js';

/** Answers a full URL; undefined means 404. */
export type WebRoutes = (url: string) => Route | undefined;

/**
 * A pretend internet for the crawler: a fetch that answers from `routes` by
 * full URL, so fixtures can use real-looking hosts (http and https, www and
 * not) without a server. Redirects are returned as-is, like redirect: 'manual'.
 */
export function fakeWeb(routes: WebRoutes): typeof fetch {
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const route = routes(url) ?? { status: 404, body: 'Not found' };
    const status = route.status ?? 200;
    const body = status >= 300 && status < 400 ? null : (route.body ?? '');
    return new Response(body, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers },
    });
  };
}

/** A redirect route. */
export const redirectTo = (location: string, status = 301): Route => ({
  status,
  headers: { location },
});
