import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, schemaVersion } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { openDb, type Db } from '../src/db/open.js';
import { makeTempHome } from './helpers/temp-home.js';

const v01Tables = [
  'check_runs',
  'crawls',
  'finding_evidence',
  'finding_lifecycle',
  'findings',
  'gsc_page_daily',
  'gsc_query_page_daily',
  'gsc_sync_state',
  'jobs',
  'links',
  'pages',
  'properties',
  'redirect_hops',
  'robots_rules',
  'sitemap_urls',
];

describe('database', () => {
  let temp: ReturnType<typeof makeTempHome>;
  let db: Db;

  beforeEach(() => {
    temp = makeTempHome();
    db = openDb(path.join(temp.home, 'data.db'));
  });
  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it('creates every v0.1 table', () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([...v01Tables, 'schema_migrations'].sort());
  });

  it('uses WAL mode and enforces foreign keys', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('applies nothing the second time', () => {
    expect(migrate(db)).toEqual([]);
    expect(schemaVersion(db)).toBe(migrations.length);
  });

  it('numbers migrations 1, 2, 3 … with no gaps', () => {
    expect(migrations.map((m) => m.id)).toEqual(migrations.map((_, i) => i + 1));
  });

  it('rejects a value of the wrong type', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO jobs (type, state, attempts, created_at) VALUES ('x', 'queued', ?, ?)`,
        )
        .run('many', new Date().toISOString()),
    ).toThrow(/cannot store TEXT value in INTEGER column/);
  });
});
