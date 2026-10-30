import { UserError } from '../../errors.js';

/**
 * Picks the Search Console property for a site. An explicit choice must be in
 * the list. Otherwise prefer the domain property (it covers every host and
 * protocol), then a URL-prefix property for the exact site URL or its origin.
 */
export function chooseProperty(siteUrl: string, available: string[], requested?: string): string {
  const list = available.map((p) => `  ${p}`).join('\n') || '  (none)';

  if (requested) {
    if (available.includes(requested)) return requested;
    throw new UserError(
      `This Google account cannot see the property "${requested}". It can see:\n${list}`,
    );
  }

  const url = new URL(siteUrl);
  const apex = url.hostname.replace(/^www\./, '');
  const candidates = [`sc-domain:${url.hostname}`, `sc-domain:${apex}`, url.href, `${url.origin}/`];
  const match = candidates.find((candidate) => available.includes(candidate));
  if (match) return match;

  throw new UserError(
    `No Search Console property matches ${siteUrl}. This Google account can see:\n${list}\n` +
      'Run the command again with --property "<one of the above>".',
  );
}
