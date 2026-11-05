/**
 * robots.txt parsing and matching, following RFC 9309 (the rules Google uses).
 * Pure functions with no network calls, so checks can reuse them on stored files.
 */

/** The product token this crawler obeys rules for, before falling back to "*". */
export const ROBOTS_AGENT = 'webmastery-console';

export interface RobotsLine {
  lineNo: number;
  /** Lower case, e.g. "user-agent", "disallow", "sitemap". */
  directive: string;
  value: string;
  /** The user agents of the group this line belongs to, comma-separated; null outside a group. */
  userAgent: string | null;
}

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export interface Robots {
  lines: RobotsLine[];
  sitemaps: string[];
  groups: Group[];
}

export function parseRobots(text: string): Robots {
  const parsed: { line: Omit<RobotsLine, 'userAgent'>; group?: Group }[] = [];
  const sitemaps: string[] = [];
  const groups: Group[] = [];
  let group: Group | undefined;
  let lastWasAgent = false;

  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const content = raw.replace(/#.*/, '').trim();
    const colon = content.indexOf(':');
    if (colon < 0) return;
    const directive = content.slice(0, colon).trim().toLowerCase();
    const value = content.slice(colon + 1).trim();

    if (directive === 'user-agent') {
      // Consecutive user-agent lines share one group.
      if (!group || !lastWasAgent) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (directive === 'sitemap') sitemaps.push(value);
      // An empty Disallow allows everything, so it adds no rule.
      if ((directive === 'allow' || directive === 'disallow') && group && value) {
        group.rules.push({ allow: directive === 'allow', pattern: value });
      }
    }
    const inGroup = directive === 'sitemap' ? undefined : group;
    parsed.push({ line: { lineNo: index + 1, directive, value }, group: inGroup });
  });

  const lines = parsed.map(({ line, group }) => ({
    ...line,
    userAgent: group ? group.agents.join(', ') : null,
  }));
  return { lines, sitemaps, groups };
}

/**
 * Whether `agent` may fetch `path` (path plus query). Uses the groups naming
 * the agent, or else the "*" groups. The longest matching rule wins; on a tie, Allow wins.
 */
export function isAllowed(robots: Robots, path: string, agent = ROBOTS_AGENT): boolean {
  if (path === '/robots.txt') return true;
  const token = (name: string) => name.split('/')[0]!.trim();
  const named = robots.groups.filter((g) => g.agents.some((a) => token(a) === agent));
  const groups = named.length > 0 ? named : robots.groups.filter((g) => g.agents.includes('*'));

  let best: Rule | undefined;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!matches(rule.pattern, path)) continue;
    const longer = !best || rule.pattern.length > best.pattern.length;
    const tieAllow = best && rule.pattern.length === best.pattern.length && rule.allow;
    if (longer || tieAllow) best = rule;
  }
  return best?.allow ?? true;
}

/** "*" matches any characters; a final "$" anchors the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

/** A robots.txt as fetched. `status` is null when it could not be fetched at all. */
export interface RobotsFile {
  status: number | null;
  /** Parsed rules, present only for a 2xx response. */
  robots: Robots | null;
}

/**
 * Applies RFC 9309's rules for the fetch result: a 2xx file's rules apply; a
 * 4xx (no file) allows everything; a 5xx, a 429 or no answer means crawlers
 * must treat the whole site as disallowed.
 */
export function robotsAllow(file: RobotsFile, path: string): boolean {
  if (path === '/robots.txt') return true;
  if (file.status === null || file.status === 429 || file.status >= 500) return false;
  return file.robots ? isAllowed(file.robots, path) : true;
}
