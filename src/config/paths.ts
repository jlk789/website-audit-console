import { homedir } from 'node:os';
import path from 'node:path';

export const HOME_ENV = 'WEBMASTERY_CONSOLE_HOME';

/**
 * The folder that holds the config, database and (later) tokens and crawler storage.
 * Order: the --home flag, then the WEBMASTERY_CONSOLE_HOME variable, then ~/.webmastery-console.
 * Empty values count as unset.
 */
export function resolveHome(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  const chosen = flag || env[HOME_ENV] || path.join(homedir(), '.webmastery-console');
  return path.resolve(chosen);
}

export function configPath(home: string): string {
  return path.join(home, 'config.json');
}

export function dbPath(home: string): string {
  return path.join(home, 'data.db');
}
