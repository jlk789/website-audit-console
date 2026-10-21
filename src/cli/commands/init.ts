import { existsSync } from 'node:fs';
import { ConfigError, parseConfig, writeConfig } from '../../config/load.js';
import { configPath, dbPath, resolveHome } from '../../config/paths.js';
import { openDb } from '../../db/open.js';
import { schemaVersion } from '../../db/migrate.js';

export interface InitOptions {
  site: string;
  brand?: string[];
  home?: string;
  force?: boolean;
}

export interface InitResult {
  configFile: string;
  dbFile: string;
  siteUrl: string;
  schemaVersion: number;
}

/** Writes the config, creates the database and records the site. */
export function runInit(options: InitOptions): InitResult {
  const home = resolveHome(options.home);
  const configFile = configPath(home);
  const dbFile = dbPath(home);

  if (existsSync(configFile) && !options.force) {
    throw new ConfigError(`A config already exists at ${configFile}. Use --force to replace it.`);
  }

  const config = parseConfig(
    { version: 1, site: { url: options.site, brandTerms: options.brand ?? [] } },
    'the init options',
  );
  // Store the URL in one canonical form, e.g. with the trailing slash on a bare origin.
  config.site.url = new URL(config.site.url).href;
  writeConfig(configFile, config);

  const db = openDb(dbFile);
  try {
    db.prepare(
      `INSERT INTO properties (site_url, brand_terms, created_at) VALUES (?, ?, ?)
       ON CONFLICT (site_url) DO UPDATE SET brand_terms = excluded.brand_terms`,
    ).run(config.site.url, JSON.stringify(config.site.brandTerms), new Date().toISOString());
    return { configFile, dbFile, siteUrl: config.site.url, schemaVersion: schemaVersion(db) };
  } finally {
    db.close();
  }
}
