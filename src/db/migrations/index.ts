import { initial } from './0001-initial.js';
import { crawler } from './0002-crawler.js';

export interface Migration {
  /** Sequential, starting at 1. Never reuse or reorder. */
  id: number;
  name: string;
  sql: string;
}

/**
 * Every migration, oldest first. Migrations are additive: new tables,
 * new columns, new indexes. Never drop or rename a column that holds user history.
 */
export const migrations: Migration[] = [initial, crawler];
