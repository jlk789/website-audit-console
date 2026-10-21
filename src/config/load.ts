import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { configSchema, type Config } from './schema.js';

/** A problem the user can fix. The CLI prints the message without a stack trace. */
export class ConfigError extends Error {}

/** Validates config data. `source` names where it came from, for the error message. */
export function parseConfig(data: unknown, source: string): Config {
  const result = configSchema.safeParse(data);
  if (!result.success) {
    throw new ConfigError(`Problems in ${source}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function readConfig(file: string): Config {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(
        `No config found at ${file}. Run "webmastery-console init --site <url>" first.`,
      );
    }
    throw error;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  return parseConfig(data, file);
}

export function writeConfig(file: string, config: Config): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}
