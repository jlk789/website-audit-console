import type Database from 'better-sqlite3';
import { openReadOnly } from '../engine/context.js';

/**
 * A read-only connection that also refuses writes at the SQL level
 * (query_only), for running evidence and query_data SQL.
 */
export function openQueryOnly(file: string): Database.Database {
  const db = openReadOnly(file);
  db.pragma('query_only = ON');
  return db;
}
