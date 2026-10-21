import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readConfig, writeConfig } from '../../config/load.js';
import { configPath, dbPath, resolveHome } from '../../config/paths.js';
import type { GscConfig } from '../../config/schema.js';
import { openDb } from '../../db/open.js';
import { UserError } from '../../errors.js';
import { createGscApi, type GscApi } from '../../connectors/gsc/api.js';
import {
  createTokenSource,
  readOAuthClient,
  readServiceAccount,
  saveRefreshToken,
  writePrivateFile,
} from '../../connectors/gsc/auth.js';
import { signInWithBrowser, type SignInOptions } from '../../connectors/gsc/oauth-flow.js';
import { chooseProperty } from '../../connectors/gsc/property.js';

export interface ConnectOptions {
  home?: string;
  oauthClient?: string;
  serviceAccount?: string;
  property?: string;
}

/** Parts that reach outside this process. Tests replace them. */
export interface ConnectDeps {
  log: (line: string) => void;
  openUrl: SignInOptions['openUrl'];
  signIn?: typeof signInWithBrowser;
  makeApi?: (getToken: () => Promise<string>) => GscApi;
}

export interface ConnectResult {
  auth: GscConfig['auth'];
  property: string;
}

/**
 * Connects Search Console: copies the credential file into the home folder,
 * signs in (OAuth) or checks the key (service account), picks the property,
 * and only then writes the config.
 */
export async function runConnectGoogle(
  options: ConnectOptions,
  deps: ConnectDeps,
): Promise<ConnectResult> {
  if (Boolean(options.oauthClient) === Boolean(options.serviceAccount)) {
    throw new UserError('Give exactly one of --oauth-client <file> or --service-account <file>.');
  }

  const home = resolveHome(options.home);
  const config = readConfig(configPath(home));
  const auth: GscConfig['auth'] = options.oauthClient ? 'oauth' : 'service-account';
  const source = path.resolve((options.oauthClient ?? options.serviceAccount) as string);

  // Check the file is the right kind before copying it.
  const oauthClient = auth === 'oauth' ? readOAuthClient(source) : undefined;
  if (auth === 'service-account') readServiceAccount(source);

  const fileName = auth === 'oauth' ? 'google-oauth-client.json' : 'google-service-account.json';
  writePrivateFile(path.join(home, 'secrets', fileName), readFileSync(source, 'utf8'));
  // Forward slashes keep the config readable on every OS; path.resolve accepts them.
  const credentialsFile = `secrets/${fileName}`;

  if (oauthClient) {
    deps.log('Opening Google sign-in in your browser. If it does not open, visit this URL:');
    const signIn = deps.signIn ?? signInWithBrowser;
    const refreshToken = await signIn({ ...oauthClient, openUrl: deps.openUrl, showUrl: deps.log });
    saveRefreshToken(home, refreshToken);
    deps.log('Signed in.');
  }

  const gsc: GscConfig = { auth, credentialsFile, property: '' };
  const makeApi = deps.makeApi ?? ((getToken) => createGscApi(getToken));
  const sites = await makeApi(createTokenSource(home, gsc)).listSites();
  const property = chooseProperty(
    config.site.url,
    sites.map((site) => site.siteUrl),
    options.property,
  );

  writeConfig(configPath(home), { ...config, gsc: { ...gsc, property } });
  const db = openDb(dbPath(home));
  try {
    db.prepare('UPDATE properties SET gsc_property = ? WHERE site_url = ?').run(
      property,
      config.site.url,
    );
  } finally {
    db.close();
  }
  return { auth, property };
}
