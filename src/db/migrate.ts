import type { Db } from './open.js';
import { migrations } from './migrations/index.js';

/**
 * Applies any migrations not yet recorded in schema_migrations, in order,
 * inside one write transaction. Returns the ids it applied.
 */
export function migrate(db: Db): number[] {
  const applyPending = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);
    const applied = new Set(
      db
        .prepare('SELECT id FROM schema_migrations')
        .all()
        .map((row) => (row as { id: number }).id),
    );

    const ran: number[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
      ran.push(migration.id);
    }
    return ran;
  });

  // IMMEDIATE takes the write lock up front, so two processes opening
  // the database at once cannot both apply the same migration.
  return applyPending.immediate();
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(id) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  return row.version ?? 0;
}
