import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/program.js';
import { runInit } from '../src/cli/commands/init.js';
import { ConfigError, readConfig } from '../src/config/load.js';
import { configPath, dbPath } from '../src/config/paths.js';
import { openDb } from '../src/db/open.js';
import { makeTempHome } from './helpers/temp-home.js';

describe('init', () => {
  let temp: ReturnType<typeof makeTempHome>;

  beforeEach(() => {
    temp = makeTempHome();
  });
  afterEach(() => temp.cleanup());

  it('writes a config and creates the database with the site in it', () => {
    const result = runInit({ site: 'https://example.com', brand: ['example'], home: temp.home });

    expect(result.siteUrl).toBe('https://example.com/');
    expect(readConfig(configPath(temp.home)).site).toEqual({
      url: 'https://example.com/',
      brandTerms: ['example'],
    });

    const db = openDb(dbPath(temp.home));
    try {
      expect(db.prepare('SELECT site_url, brand_terms FROM properties').all()).toEqual([
        { site_url: 'https://example.com/', brand_terms: '["example"]' },
      ]);
    } finally {
      db.close();
    }
  });

  it('refuses to replace an existing config unless forced', () => {
    runInit({ site: 'https://example.com/', home: temp.home });
    expect(() => runInit({ site: 'https://example.org/', home: temp.home })).toThrow(ConfigError);

    runInit({ site: 'https://example.org/', home: temp.home, force: true });
    expect(readConfig(configPath(temp.home)).site.url).toBe('https://example.org/');
  });

  it('rejects a site that is not an http(s) URL', () => {
    expect(() => runInit({ site: 'example.com', home: temp.home })).toThrow(/site\.url/);
  });

  it('is wired into the CLI with --home', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(
        ['init', '--site', 'https://example.com/', '--brand', 'ex', 'example', '--home', temp.home],
        { from: 'user' },
      );
    } finally {
      log.mockRestore();
    }
    expect(readConfig(configPath(temp.home)).site.brandTerms).toEqual(['ex', 'example']);
  });
});
