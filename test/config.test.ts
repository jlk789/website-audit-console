import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, readConfig, writeConfig } from '../src/config/load.js';
import { configPath, HOME_ENV, resolveHome } from '../src/config/paths.js';
import { makeTempHome } from './helpers/temp-home.js';

describe('resolveHome', () => {
  it('prefers the flag, then the environment variable, then the default', () => {
    const env = { [HOME_ENV]: path.join('some', 'env-home') };
    expect(resolveHome(path.join('flag-home'), env)).toBe(path.resolve('flag-home'));
    expect(resolveHome(undefined, env)).toBe(path.resolve('some', 'env-home'));
    expect(resolveHome(undefined, {})).toBe(path.join(homedir(), '.webmastery-console'));
  });

  it('treats an empty environment variable as unset', () => {
    expect(resolveHome(undefined, { [HOME_ENV]: '' })).toBe(
      path.join(homedir(), '.webmastery-console'),
    );
  });
});

describe('readConfig', () => {
  let temp: ReturnType<typeof makeTempHome>;
  let file: string;

  beforeEach(() => {
    temp = makeTempHome();
    file = configPath(temp.home);
  });
  afterEach(() => temp.cleanup());

  it('fills in defaults for a minimal valid config', () => {
    writeFileSync(file, JSON.stringify({ version: 1, site: { url: 'https://example.com/' } }));
    expect(readConfig(file)).toEqual({
      version: 1,
      site: { url: 'https://example.com/', brandTerms: [] },
      crawl: { maxPages: 10_000 },
    });
  });

  it('round-trips what writeConfig writes', () => {
    const config = {
      version: 1 as const,
      site: { url: 'https://example.com/', brandTerms: ['example'] },
      crawl: { maxPages: 500 },
    };
    writeConfig(file, config);
    expect(readConfig(file)).toEqual(config);
  });

  it('tells the user to run init when the file is missing', () => {
    expect(() => readConfig(file)).toThrow(/Run "webmastery-console init/);
  });

  it('reports invalid JSON as a ConfigError', () => {
    writeFileSync(file, '{ not json');
    expect(() => readConfig(file)).toThrow(ConfigError);
  });

  it('names the field that is wrong', () => {
    writeFileSync(file, JSON.stringify({ version: 1, site: { url: 'ftp://example.com/' } }));
    expect(() => readConfig(file)).toThrow(/site\.url/);
  });
});
