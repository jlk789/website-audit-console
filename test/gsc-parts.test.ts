import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGscApi } from '../src/connectors/gsc/api.js';
import {
  explainAuthError,
  loadRefreshToken,
  readOAuthClient,
  readServiceAccount,
  saveRefreshToken,
} from '../src/connectors/gsc/auth.js';
import { addDays, daysBetween, subtractMonths } from '../src/connectors/gsc/dates.js';
import { chooseProperty } from '../src/connectors/gsc/property.js';
import { UserError } from '../src/errors.js';
import { makeTempHome } from './helpers/temp-home.js';

describe('chooseProperty', () => {
  const site = 'https://www.example.com/';

  it('prefers the domain property, including for a www site', () => {
    const available = ['https://www.example.com/', 'sc-domain:example.com'];
    expect(chooseProperty(site, available)).toBe('sc-domain:example.com');
  });

  it('falls back to a URL-prefix property for the site', () => {
    expect(chooseProperty(site, ['https://www.example.com/', 'sc-domain:other.com'])).toBe(
      'https://www.example.com/',
    );
  });

  it('uses an explicit choice only if the account can see it', () => {
    expect(
      chooseProperty(site, ['sc-domain:example.com', 'sc-domain:b.com'], 'sc-domain:b.com'),
    ).toBe('sc-domain:b.com');
    expect(() => chooseProperty(site, ['sc-domain:b.com'], 'sc-domain:c.com')).toThrow(UserError);
  });

  it('lists what the account can see when nothing matches', () => {
    expect(() => chooseProperty(site, ['sc-domain:other.com'])).toThrow(/sc-domain:other\.com/);
  });
});

describe('dates', () => {
  it('does calendar arithmetic without time-zone drift', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(subtractMonths('2026-10-18', 16)).toBe('2025-06-18');
    expect(daysBetween('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});

describe('credentials', () => {
  let temp: ReturnType<typeof makeTempHome>;
  const write = (name: string, data: unknown) => {
    const file = path.join(temp.home, name);
    writeFileSync(file, JSON.stringify(data));
    return file;
  };
  const oauthFile = { installed: { client_id: 'id.apps', client_secret: 'shh' } };
  const keyFile = { type: 'service_account', client_email: 'bot@p.iam', private_key: 'KEY' };

  beforeEach(() => {
    temp = makeTempHome();
  });
  afterEach(() => temp.cleanup());

  it('reads a desktop OAuth client file', () => {
    expect(readOAuthClient(write('client.json', oauthFile))).toEqual({
      clientId: 'id.apps',
      clientSecret: 'shh',
    });
  });

  it('says which flag to use when the files are swapped', () => {
    expect(() => readOAuthClient(write('key.json', keyFile))).toThrow(/--service-account/);
    expect(() => readServiceAccount(write('client.json', oauthFile))).toThrow(/--oauth-client/);
  });

  it('reads a service-account key file', () => {
    expect(readServiceAccount(write('key.json', keyFile))).toEqual({
      email: 'bot@p.iam',
      key: 'KEY',
    });
  });

  it('saves and loads the refresh token', () => {
    expect(loadRefreshToken(temp.home)).toBeUndefined();
    saveRefreshToken(temp.home, 'refresh-123');
    expect(loadRefreshToken(temp.home)).toBe('refresh-123');
    expect(readFileSync(path.join(temp.home, 'tokens', 'google.json'), 'utf8')).toContain(
      'refresh-123',
    );
  });

  it('explains an expired sign-in, including the 7-day Testing-mode trap', () => {
    const error = explainAuthError(new Error('invalid_grant'), 'oauth');
    expect(error).toBeInstanceOf(UserError);
    expect(error.message).toMatch(/Testing/);
    expect(explainAuthError(new Error('invalid_grant'), 'service-account').message).toMatch(
      /service-account key/,
    );
    expect(explainAuthError(new Error('ECONNRESET'), 'oauth')).not.toBeInstanceOf(UserError);
  });
});

describe('createGscApi', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  it('sends the token, encodes the property and returns rows', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const api = createGscApi(async () => 'token-1', {
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init! });
        return json(200, { rows: [{ keys: ['a'], clicks: 1, impressions: 2, position: 3 }] });
      },
    });
    const rows = await api.query('sc-domain:example.com', {
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      dimensions: ['query'],
      type: 'web',
      rowLimit: 10,
      startRow: 0,
    });
    expect(rows).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query',
    );
    expect((requests[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer token-1',
    );
  });

  it('retries a rate limit, waiting as Google asks', async () => {
    const waits: number[] = [];
    let calls = 0;
    const api = createGscApi(async () => 't', {
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async () =>
        ++calls === 1 ? json(429, {}, { 'retry-after': '7' }) : json(200, { siteEntry: [] }),
    });
    expect(await api.listSites()).toEqual([]);
    expect(waits).toEqual([7000]);
  });

  it('does not retry a permission error, and reports Google’s message', async () => {
    let calls = 0;
    const api = createGscApi(async () => 't', {
      fetch: async () => {
        calls++;
        return json(403, { error: { message: 'User does not have sufficient permission' } });
      },
    });
    await expect(api.listSites()).rejects.toThrow(/403: User does not have sufficient permission/);
    await expect(api.listSites()).rejects.toBeInstanceOf(UserError);
    expect(calls).toBe(2);
  });
});
