import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { checks } from '../checks/index.js';
import { UserError } from '../errors.js';
import type { FindingRow, RunRow } from './site.js';

const checkById = new Map(checks.map((c) => [c.id, c]));

export const checkTitle = (id: string): string => checkById.get(id)?.title ?? id;
export const checkInfo = (id: string) => checkById.get(id);

/** A tool reply: our own text, plus any <untrusted-data> blocks, as one text part. */
export function reply(...parts: string[]): CallToolResult {
  return { content: [{ type: 'text', text: parts.filter(Boolean).join('\n\n') }] };
}

/**
 * Runs a tool body. A UserError (no config, no audit yet, a refused query)
 * becomes an error reply Claude can show; anything else is a bug and is
 * reported as one.
 */
export async function tool(body: () => CallToolResult | Promise<CallToolResult>) {
  try {
    return await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const text =
      error instanceof UserError ? message : `Internal error (please report this): ${message}`;
    return { isError: true, content: [{ type: 'text' as const, text }] } satisfies CallToolResult;
  }
}

/** What an audit was run on, in our own words: dates and counts only. */
export function describeRun(run: RunRow, siteUrl: string): string {
  const gsc = run.gsc_start
    ? `Search Console ${run.gsc_start} to ${run.gsc_end}`
    : 'no Search Console data';
  return `Audit of ${siteUrl} finished ${run.finished_at}, on ${run.crawl_id ? 'the crawl ' + run.crawl_id : 'no crawl'} and ${gsc}.`;
}

/** The short form of a finding used in lists. */
export function brief(f: FindingRow) {
  return {
    id: f.id,
    check: f.check_id,
    title: checkTitle(f.check_id),
    status: f.status,
    severityFloor: f.severity_floor === 1,
    summary: f.summary,
    urls: JSON.parse(f.urls) as string[],
    value: { metric: f.value_metric, amount: f.value_amount, basis: f.value_basis },
    priority: round(f.priority),
    certainty: round(f.certainty),
    effortHours: f.effort_hours,
    ...(f.fix_group ? { sharedFix: f.fix_group } : {}),
  };
}

export const round = (n: number): number => Math.round(n * 100) / 100;
