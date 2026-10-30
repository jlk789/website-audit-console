import { UserError } from '../../errors.js';

const BASE_URL = 'https://www.googleapis.com/webmasters/v3';

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscRow {
  /** Values of the requested dimensions, in order. */
  keys: string[];
  clicks: number;
  impressions: number;
  position: number;
}

/** Body of a searchAnalytics.query request. */
export interface GscQuery {
  startDate: string;
  endDate: string;
  dimensions: string[];
  type: string;
  aggregationType?: 'auto' | 'byPage' | 'byProperty';
  dataState?: 'final' | 'all';
  rowLimit: number;
  startRow: number;
}

/** The two Search Console calls the sync needs. Tests swap in a fake. */
export interface GscApi {
  listSites(): Promise<GscSite[]>;
  query(siteUrl: string, body: GscQuery): Promise<GscRow[]>;
}

/** An API error that a retry might fix (rate limit, server error, network). */
export class GscApiError extends Error {}

export interface ApiOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries after a rate limit or server error. Waits double each time. */
  maxRetries?: number;
}

/** Calls the Search Console API with a bearer token from `getToken`. */
export function createGscApi(getToken: () => Promise<string>, options: ApiOptions = {}): GscApi {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 5;

  async function call<T>(url: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { authorization: `Bearer ${await getToken()}` };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await doFetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.ok) return (await response.json()) as T;

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      const message = `Search Console API error ${response.status}: ${await errorText(response)}`;
      // Bad requests and missing permissions fail the same way every time.
      throw retryable ? new GscApiError(message) : new UserError(message);
    }
  }

  return {
    async listSites() {
      const data = await call<{ siteEntry?: GscSite[] }>(`${BASE_URL}/sites`);
      return data.siteEntry ?? [];
    },
    async query(siteUrl, body) {
      const url = `${BASE_URL}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
      const data = await call<{ rows?: GscRow[] }>(url, body);
      return data.rows ?? [];
    },
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  return retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
}

/** Google's error message, never the request (which carries the token). */
async function errorText(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    return data.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
