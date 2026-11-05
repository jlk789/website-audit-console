import { setTimeout as sleep } from 'node:timers/promises';
import { normalise } from './urls.js';

/** A chain longer than this is reported, not followed further. */
export const MAX_HOPS = 10;

export interface HttpSettings {
  userAgent: string;
  timeoutMs: number;
  /** Bytes read from one response; the rest is ignored. */
  maxBytes: number;
  /** Wait before the one retry of a network error or 5xx. */
  retryDelayMs: number;
  fetch: typeof fetch;
}

/** One redirect response. */
export interface Hop {
  from: string;
  status: number;
  /** Where the Location header points; null if it is missing or not a valid URL. */
  target: string | null;
}

/** The response a redirect chain ends on. */
export interface FinalResponse {
  url: string;
  /** Null when no response came back. */
  status: number | null;
  contentType: string | null;
  xRobotsTag: string | null;
  body: Buffer | null;
  error: string | null;
}

export interface Fetched {
  hops: Hop[];
  /** Null when the chain was not followed to the end; `stopped` says why. */
  final: FinalResponse | null;
  stopped: string | null;
}

export interface FetchRules {
  /** Whether robots.txt lets the crawler follow a redirect to `url`. */
  allowed: (url: string) => Promise<boolean>;
  /** Whether to download the final response's body. */
  wantBody: (url: string, contentType: string | null) => boolean;
}

/**
 * Fetches a URL without letting the HTTP client follow redirects, so every
 * hop is recorded with its own status. Stops at a loop, after MAX_HOPS, at a
 * missing or invalid Location, or where robots.txt blocks the next hop.
 */
export async function fetchWithHops(
  start: string,
  http: HttpSettings,
  rules: FetchRules,
): Promise<Fetched> {
  const hops: Hop[] = [];
  const seen = new Set<string>([start]);
  let url = start;

  for (;;) {
    let response: Response;
    try {
      response = await request(url, http, 'manual');
    } catch (error) {
      return { hops, final: failed(url, error, http), stopped: null };
    }

    const location = response.headers.get('location');
    const redirect = response.status >= 300 && response.status < 400 && location !== null;
    if (!redirect) {
      return { hops, final: await finish(url, response, http, rules), stopped: null };
    }

    await response.body?.cancel();
    const target = normalise(location, url) ?? null;
    hops.push({ from: url, status: response.status, target });

    if (!target) return { hops, final: null, stopped: 'redirect has no valid Location header' };
    if (seen.has(target)) return { hops, final: null, stopped: 'redirect loop' };
    if (hops.length >= MAX_HOPS) {
      return { hops, final: null, stopped: `more than ${MAX_HOPS} redirects` };
    }
    if (!(await rules.allowed(target))) {
      return { hops, final: null, stopped: 'redirect target is blocked by robots.txt' };
    }
    seen.add(target);
    url = target;
  }
}

export interface SimpleResponse {
  /** The URL that answered, after redirects. */
  url: string;
  status: number | null;
  body: Buffer | null;
  error: string | null;
}

/** Fetches a file such as robots.txt or a sitemap, following redirects. */
export async function fetchFile(url: string, http: HttpSettings): Promise<SimpleResponse> {
  try {
    const response = await request(url, http, 'follow');
    const { body, truncated } = await readBody(response, http.maxBytes);
    return {
      url: response.url || url,
      status: response.status,
      body,
      error: truncated ? tooLarge(http) : null,
    };
  } catch (error) {
    return { url, status: null, body: null, error: describeError(error, http) };
  }
}

/** One request, retried once after a network error or a 5xx. */
async function request(
  url: string,
  http: HttpSettings,
  redirect: 'manual' | 'follow',
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await http.fetch(url, {
        redirect,
        headers: {
          'user-agent': http.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(http.timeoutMs),
      });
      if (response.status < 500 || attempt === 2) return response;
      await response.body?.cancel();
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await sleep(http.retryDelayMs);
  }
}

async function finish(
  url: string,
  response: Response,
  http: HttpSettings,
  rules: FetchRules,
): Promise<FinalResponse> {
  const contentType = response.headers.get('content-type');
  const final: FinalResponse = {
    url,
    status: response.status,
    contentType,
    xRobotsTag: response.headers.get('x-robots-tag'),
    body: null,
    error: null,
  };
  if (!rules.wantBody(url, contentType)) {
    await response.body?.cancel();
    return final;
  }
  try {
    const { body, truncated } = await readBody(response, http.maxBytes);
    return { ...final, body, error: truncated ? tooLarge(http) : null };
  } catch (error) {
    return { ...final, error: describeError(error, http) };
  }
}

function failed(url: string, error: unknown, http: HttpSettings): FinalResponse {
  return {
    url,
    status: null,
    contentType: null,
    xRobotsTag: null,
    body: null,
    error: describeError(error, http),
  };
}

/** Reads at most `maxBytes`, then stops downloading. */
async function readBody(
  response: Response,
  maxBytes: number,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      chunks.push(Buffer.from(chunk));
      size += chunk.byteLength;
      if (size > maxBytes) {
        return { body: Buffer.concat(chunks).subarray(0, maxBytes), truncated: true };
      }
    }
  }
  return { body: Buffer.concat(chunks), truncated: false };
}

const tooLarge = (http: HttpSettings) =>
  `larger than ${Math.round(http.maxBytes / 1_000_000)} MB; only the start was read`;

/** A short reason such as "timed out after 20s" or "ENOTFOUND". */
export function describeError(error: unknown, http: Pick<HttpSettings, 'timeoutMs'>): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `timed out after ${Math.round(http.timeoutMs / 1000)}s`;
  }
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  if (cause?.code) return cause.code;
  return error instanceof Error ? error.message : String(error);
}
