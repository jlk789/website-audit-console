import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConnectGoogle, type ConnectDeps } from '../src/cli/commands/connect.js';
import { runInit } from '../src/cli/commands/init.js';
import { readConfig } from '../src/config/load.js';
import { configPath, dbPath } from '../src/config/paths.js';
import { loadRefreshToken } from '../src/connectors/gsc/auth.js';
import { signInWithBrowser } from '../src/connectors/gsc/oauth-flow.js';
import { openDb } from '../src/db/open.js';
import { UserError } from '../src/errors.js';
import { fakeGsc } from './helpers/fake-gsc.js';
import { makeTempHome } from './helpers/temp-home.js';

const oauthClient = { installed: { client_id: 'id.apps', client_secret: 'shh' } };
const serviceAccount = { type: 'service_account', client_email: 'bot@p.iam', private_key: 'KEY' };

describe('connect google', () => {
  let temp: ReturnType<typeof makeTempHome>;
  let signIns: number;

  const deps = (sites: string[]): ConnectDeps => ({
    log: () => {},
    openUrl: async () => {},
    signIn: async () => {
      signIns++;
      return 'refresh-123';
    },
    makeApi: () => fakeGsc({ latest: '2026-10-18', sites }),
  });

  const download = (name: string, data: unknown) => {
    const file = path.join(temp.home, name);
    writeFileSync(file, JSON.stringify(data));
    return file;
  };

  beforeEach(() => {
    temp = makeTempHome();
    signIns = 0;
    runInit({ site: 'https://example.com/', home: temp.home });
  });
  afterEach(() => temp.cleanup());

  it('signs in with an OAuth client, picks the property and saves everything', async () => {
    const result = await runConnectGoogle(
      { home: temp.home, oauthClient: download('client_secret_x.json', oauthClient) },
      deps(['sc-domain:other.com', 'sc-domain:example.com']),
    );

    expect(result).toEqual({ auth: 'oauth', property: 'sc-domain:example.com' });
    expect(signIns).toBe(1);
    expect(loadRefreshToken(temp.home)).toBe('refresh-123');
    expect(existsSync(path.join(temp.home, 'secrets', 'google-oauth-client.json'))).toBe(true);
    expect(readConfig(configPath(temp.home)).gsc).toEqual({
      auth: 'oauth',
      credentialsFile: 'secrets/google-oauth-client.json',
      property: 'sc-domain:example.com',
    });

    const db = openDb(dbPath(temp.home));
    try {
      expect(db.prepare('SELECT gsc_property FROM properties').get()).toEqual({
        gsc_property: 'sc-domain:example.com',
      });
    } finally {
      db.close();
    }
  });

  it('uses a service account without a browser sign-in', async () => {
    const result = await runConnectGoogle(
      { home: temp.home, serviceAccount: download('key.json', serviceAccount) },
      deps(['https://example.com/']),
    );
    expect(result).toEqual({ auth: 'service-account', property: 'https://example.com/' });
    expect(signIns).toBe(0);
  });

  it('leaves the config alone when no property matches', async () => {
    await expect(
      runConnectGoogle(
        { home: temp.home, serviceAccount: download('key.json', serviceAccount) },
        deps(['sc-domain:other.com']),
      ),
    ).rejects.toThrow(/--property/);
    expect(readConfig(configPath(temp.home)).gsc).toBeUndefined();
  });

  it('needs exactly one credential flag', async () => {
    await expect(runConnectGoogle({ home: temp.home }, deps([]))).rejects.toThrow(UserError);
  });
});

describe('browser sign-in', () => {
  /** Plays the browser: reads the sign-in URL and calls the local redirect. */
  const browser =
    (...replies: ((state: string) => string)[]) =>
    async (url: string) => {
      const params = new URL(url).searchParams;
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
      const redirect = params.get('redirect_uri')!;
      const statuses: number[] = [];
      for (const reply of replies) {
        statuses.push((await fetch(`${redirect}/?${reply(params.get('state')!)}`)).status);
      }
      return statuses;
    };

  const signIn = (openUrl: (url: string) => Promise<unknown>) =>
    signInWithBrowser({
      clientId: 'id.apps',
      clientSecret: 'shh',
      showUrl: () => {},
      openUrl,
      exchangeCode: async (_client, code, verifier) => {
        expect(verifier.length).toBeGreaterThan(40);
        return `refresh-for-${code}`;
      },
    });

  it('ignores a reply with the wrong state, then accepts the real one', async () => {
    let statuses: Promise<number[]> | undefined;
    const token = await signIn((url) => {
      statuses = browser(
        () => 'state=forged&code=evil',
        (state) => `state=${state}&code=good`,
      )(url);
      return statuses;
    });
    expect(token).toBe('refresh-for-good');
    expect(await statuses).toEqual([400, 200]);
  });

  it('reports a cancelled sign-in', async () => {
    await expect(signIn(browser((state) => `state=${state}&error=access_denied`))).rejects.toThrow(
      /access_denied/,
    );
  });
});
