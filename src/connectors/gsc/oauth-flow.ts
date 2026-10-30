import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { UserError } from '../../errors.js';
import { GSC_SCOPE, type OAuthClientCredentials } from './auth.js';

export interface SignInOptions extends OAuthClientCredentials {
  /** Opens the sign-in page. Failure is fine: the URL is also printed. */
  openUrl: (url: string) => Promise<unknown>;
  /** Shows the sign-in URL to the user. */
  showUrl: (url: string) => void;
  /** Swaps the one-time code for a refresh token. Replaceable in tests. */
  exchangeCode?: (client: OAuth2Client, code: string, codeVerifier: string) => Promise<string>;
  timeoutMs?: number;
}

/**
 * Signs in through the browser and returns a refresh token. Google sends the
 * browser back to a temporary server on 127.0.0.1, which only accepts a reply
 * carrying the random `state` it sent. PKCE means an intercepted code is useless
 * without the verifier, which never leaves this process.
 */
export async function signInWithBrowser(options: SignInOptions): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const client = new OAuth2Client({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: `http://127.0.0.1:${port}`,
    });
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(16).toString('hex');
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // makes Google return a refresh token every time
      scope: [GSC_SCOPE],
      state,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge,
    });

    const code = waitForCode(server, state, options.timeoutMs ?? 5 * 60_000);
    options.showUrl(url);
    options.openUrl(url).catch(() => {
      // No browser available; the user can open the printed URL instead.
    });

    const exchange = options.exchangeCode ?? exchangeCode;
    return await exchange(client, await code, codeVerifier);
  } finally {
    server.close();
    server.closeAllConnections(); // the browser may hold a keep-alive connection open
  }
}

async function exchangeCode(
  client: OAuth2Client,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) {
    throw new UserError('Google did not return a refresh token. Run the sign-in again.');
  }
  return tokens.refresh_token;
}

/** Resolves with the code from the first redirect that carries the right state. */
function waitForCode(server: Server, state: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new UserError('Sign-in timed out. Run the command again.')),
      timeoutMs,
    );

    server.on('request', (req, res) => {
      const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
      if (params.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('Unexpected request.');
        return; // not ours; keep waiting
      }
      const error = params.get('error');
      const code = params.get('code');
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(
          error || !code
            ? '<p>Sign-in was not completed. You can close this tab.</p>'
            : '<p>Signed in to Webmastery Console. You can close this tab.</p>',
        );
      clearTimeout(timer);
      if (error || !code) reject(new UserError(`Google sign-in was not completed (${error}).`));
      else resolve(code);
    });
  });
}
