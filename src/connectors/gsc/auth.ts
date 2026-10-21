import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JWT, OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import type { GscConfig } from '../../config/schema.js';
import { messageOf, UserError } from '../../errors.js';

/** Read-only access to Search Console. The tool never asks for more. */
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

const oauthClientFile = z.object({
  installed: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }),
});

const serviceAccountFile = z.object({
  type: z.literal('service_account'),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ServiceAccountCredentials {
  email: string;
  key: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UserError(`Could not read ${file}: ${messageOf(error)}`);
  }
}

/** Reads the file Google gives you for a "Desktop app" OAuth client. */
export function readOAuthClient(file: string): OAuthClientCredentials {
  const data = readJson(file);
  const result = oauthClientFile.safeParse(data);
  if (!result.success) {
    const hint = serviceAccountFile.safeParse(data).success
      ? ' It looks like a service-account key: use --service-account instead.'
      : ' Create an OAuth client of type "Desktop app" and download its JSON file.';
    throw new UserError(`${file} is not a desktop OAuth client file.${hint}`);
  }
  return {
    clientId: result.data.installed.client_id,
    clientSecret: result.data.installed.client_secret,
  };
}

/** Reads a service-account key file. */
export function readServiceAccount(file: string): ServiceAccountCredentials {
  const data = readJson(file);
  const result = serviceAccountFile.safeParse(data);
  if (!result.success) {
    const hint = oauthClientFile.safeParse(data).success
      ? ' It looks like an OAuth client file: use --oauth-client instead.'
      : ' Download a JSON key for the service account in Google Cloud Console.';
    throw new UserError(`${file} is not a service-account key file.${hint}`);
  }
  return { email: result.data.client_email, key: result.data.private_key };
}

/** Writes a file only its owner can read (on macOS and Linux; Windows
 *  already limits the user folder to its owner). */
export function writePrivateFile(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function tokenPath(home: string): string {
  return path.join(home, 'tokens', 'google.json');
}

export function saveRefreshToken(home: string, refreshToken: string): void {
  writePrivateFile(
    tokenPath(home),
    JSON.stringify({ refresh_token: refreshToken }, null, 2) + '\n',
  );
}

export function loadRefreshToken(home: string): string | undefined {
  try {
    const data = JSON.parse(readFileSync(tokenPath(home), 'utf8')) as { refresh_token?: string };
    return data.refresh_token || undefined;
  } catch {
    return undefined;
  }
}

export function credentialsPath(home: string, gsc: GscConfig): string {
  return path.resolve(home, gsc.credentialsFile);
}

const EXPIRED_OAUTH =
  'Your Google sign-in has expired or was revoked. If your OAuth consent screen is in ' +
  '"Testing" mode, Google expires sign-ins after 7 days: open Google Cloud Console, go to ' +
  'Google Auth Platform > Audience, click "Publish app", then run ' +
  '"webmastery-console connect google" again.';

const REJECTED_KEY =
  'Google rejected the service-account key. It may have been deleted or disabled. Create a ' +
  'new key in Google Cloud Console, then run "webmastery-console connect google" again.';

/** Turns a token error into a message the user can act on. Never includes the token. */
export function explainAuthError(error: unknown, auth: GscConfig['auth']): Error {
  const text = messageOf(error);
  if (/invalid_grant|unauthorized_client|invalid_client/.test(text)) {
    return new UserError(auth === 'oauth' ? EXPIRED_OAUTH : REJECTED_KEY);
  }
  return new Error(`Google sign-in failed: ${text}`);
}

/** Returns a function that hands out a fresh access token, refreshing it when needed. */
export function createTokenSource(home: string, gsc: GscConfig): () => Promise<string> {
  const file = credentialsPath(home, gsc);
  let client: OAuth2Client;

  if (gsc.auth === 'oauth') {
    const refreshToken = loadRefreshToken(home);
    if (!refreshToken) {
      throw new UserError(
        'You are not signed in to Google. Run "webmastery-console connect google" first.',
      );
    }
    client = new OAuth2Client(readOAuthClient(file));
    client.setCredentials({ refresh_token: refreshToken });
  } else {
    client = new JWT({ ...readServiceAccount(file), scopes: [GSC_SCOPE] });
  }

  return async () => {
    try {
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('Google returned no access token.');
      return token;
    } catch (error) {
      throw explainAuthError(error, gsc.auth);
    }
  };
}
