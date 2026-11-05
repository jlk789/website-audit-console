import { createHash } from 'node:crypto';
import { addDays, daysBetween } from '../connectors/gsc/dates.js';
import { threshold } from './helpers.js';
import { SkipCheck, type CheckContext, type DateRange, type EvidenceRef } from './types.js';

/**
 * Two back-to-back windows of `days` each, ending at the snapshot's newest
 * day. Throws SkipCheck if Search Console data doesn't reach back that far,
 * so a short history is reported as skipped instead of passing silently.
 */
export function windows(ctx: CheckContext, days: number): { before: DateRange; recent: DateRange } {
  const end = ctx.snapshot.gscRange!.end;
  const recent = { start: addDays(end, 1 - days), end };
  const before = { start: addDays(end, 1 - 2 * days), end: addDays(end, -days) };

  const first = ctx.db.get<{ day: string | null }>(
    `SELECT MIN(date) AS day FROM gsc_page_daily WHERE property_id = ? AND search_type = 'web'`,
    [ctx.snapshot.propertyId],
  )?.day;
  if (!first || first > before.start) {
    const have = first ? daysBetween(first, end).length : 0;
    throw new SkipCheck(
      `needs ${2 * days} days of Search Console data to compare two ${days}-day periods; there are ${have}`,
    );
  }
  return { before, recent };
}

/**
 * A search query fit to quote in a finding: no line breaks or control
 * characters, at most `max` characters. Queries are typed by strangers and
 * may contain anything, including instructions aimed at AI tools, so findings
 * quote them short. The full text stays in the database and the evidence.
 */
export function quoteQuery(query: string, max = 80): string {
  const visible = [...query]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return `"${visible.length > max ? `${visible.slice(0, max - 1)}…` : visible}"`;
}

/** A stable, short finding key for a query: its hash, never the stranger's text itself. */
export const queryKey = (query: string): string =>
  `query ${createHash('sha256').update(query).digest('hex').slice(0, 16)}`;

/**
 * Certainty for a query-level finding, lowered when Search Console hid much
 * of the period's clicks (anonymised queries) or a day hit the row cap:
 * certainty × (1 − anonymisedPenalty × share). A row-cap day counts as a
 * share of at least 0.5. Returns the evidence for the share too.
 */
export function queryCertainty(
  ctx: CheckContext,
  base: number,
  range: DateRange,
): { certainty: number; evidence: EvidenceRef } {
  const sql = `SELECT
      (SELECT COALESCE(SUM(clicks), 0) FROM gsc_page_daily
        WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?) AS pageClicks,
      (SELECT COALESCE(SUM(clicks), 0) FROM gsc_query_page_daily
        WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ?) AS queryClicks,
      (SELECT COUNT(*) FROM gsc_sync_state
        WHERE property_id = ? AND search_type = 'web' AND date BETWEEN ? AND ? AND row_cap_hit = 1)
        AS rowCapDays`;
  const p = [ctx.snapshot.propertyId, range.start, range.end];
  const params = [...p, ...p, ...p];
  const row = ctx.db.get<{ pageClicks: number; queryClicks: number; rowCapDays: number }>(
    sql,
    params,
  )!;

  const anonymised = row.pageClicks > 0 ? Math.max(0, 1 - row.queryClicks / row.pageClicks) : 0;
  const share = row.rowCapDays > 0 ? Math.max(anonymised, 0.5) : anonymised;
  return {
    certainty: base * (1 - threshold(ctx, 'anonymisedPenalty') * share),
    evidence: ctx.evidence.custom(
      'gsc_page_daily',
      sql,
      params,
      `Clicks with and without query detail, and row-cap days, ${range.start} to ${range.end}`,
    ),
  };
}

/**
 * Clicks, impressions and impression-weighted average position for one page
 * over a range: one row, even when there is no data.
 */
export function pageTotals(
  ctx: CheckContext,
  page: string,
  range: DateRange,
): { clicks: number; impressions: number; position: number | null; evidence: EvidenceRef } {
  const sql = `SELECT COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions,
                      SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
                 FROM gsc_page_daily
                WHERE property_id = ? AND search_type = 'web' AND page = ? AND date BETWEEN ? AND ?`;
  const params = [ctx.snapshot.propertyId, page, range.start, range.end];
  const row = ctx.db.get<{ clicks: number; impressions: number; position: number | null }>(
    sql,
    params,
  )!;
  return {
    ...row,
    evidence: ctx.evidence.custom(
      'gsc_page_daily',
      sql,
      params,
      `Search Console totals for ${page}, ${range.start} to ${range.end}`,
    ),
  };
}

export const percent = (share: number): string => `${Math.round(share * 100)}%`;
