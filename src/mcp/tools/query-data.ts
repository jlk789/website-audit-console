import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dbPath } from '../../config/paths.js';
import { UserError } from '../../errors.js';
import { reply, tool } from '../format.js';
import { openQueryOnly } from '../query-only.js';
import { untrusted } from '../untrusted.js';

const TABLES =
  'properties, gsc_page_daily (page totals per day), gsc_query_page_daily (query × page per day), ' +
  'gsc_sync_state, crawls, pages, redirect_hops, links, robots_files, robots_rules, sitemaps, ' +
  'sitemap_urls, crawl_queue, check_runs, findings, finding_evidence, finding_lifecycle, jobs. ' +
  "Search Console tables filter by property_id and search_type = 'web'; crawl tables by crawl_id.";

export function registerQueryData(server: McpServer, home: string): void {
  server.registerTool(
    'query_data',
    {
      title: 'Query the data',
      description:
        'Runs one read-only SQLite SELECT on the local database, for anything the other tools ' +
        `miss. Tables: ${TABLES} Use "SELECT sql FROM sqlite_schema" to see columns. ` +
        'Writes, ATTACH and multiple statements are refused.',
      inputSchema: {
        sql: z.string().min(1).describe('One SELECT (or WITH … SELECT) statement'),
        limit: z.int().min(1).max(500).default(100).describe('Most rows to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ sql, limit }) => tool(() => reply(...runQuery(home, sql, limit))),
  );
}

/** Runs the query on a read-only, query-only connection; returns our note and the rows. */
export function runQuery(home: string, sql: string, limit: number): [string, string] {
  const db = openQueryOnly(dbPath(home));
  try {
    let statement;
    try {
      statement = db.prepare(sql);
    } catch (error) {
      throw new UserError(`The query was refused: ${(error as Error).message}`);
    }
    // `reader` is true only for statements that return rows; `readonly` only
    // for ones that change nothing. ATTACH, writes and PRAGMA writes fail one.
    if (!statement.reader || !statement.readonly) {
      throw new UserError('Only a single read-only statement that returns rows is allowed.');
    }

    const rows: unknown[] = [];
    let more = false;
    try {
      for (const row of statement.iterate()) {
        if (rows.length === limit) {
          more = true;
          break;
        }
        rows.push(row);
      }
    } catch (error) {
      throw new UserError(`The query failed: ${(error as Error).message}`);
    }
    const columns = statement.columns().map((c) => c.name);
    const note = more
      ? `${rows.length} rows shown; there are more. Raise limit (up to 500) or narrow the query.`
      : `${rows.length} rows.`;
    return [note, untrusted('query_data', { columns, rows })];
  } finally {
    db.close();
  }
}
