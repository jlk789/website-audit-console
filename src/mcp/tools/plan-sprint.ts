import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { UserError } from '../../errors.js';
import { brief, checkTitle, describeRun, reply, round, tool } from '../format.js';
import { latestRun, NO_AUDIT, openFindings, withSite, type FindingRow } from '../site.js';
import { untrusted } from '../untrusted.js';

/** URLs listed per shared fix; the rest are counted. */
const FIX_URLS = 5;

export function registerPlanSprint(server: McpServer, home: string): void {
  server.registerTool(
    'plan_sprint',
    {
      title: 'Plan a sprint',
      description:
        'Picks what to fix in a given number of hours: severity-floor findings first, then by ' +
        'priority, skipping any fix whose effort no longer fits. Findings that one change fixes ' +
        '(a template, a sitemap setting) count as one fix, costed once. Returns the picks, the ' +
        'hours used, the value they cover and the next fixes that did not fit.',
      inputSchema: {
        hours: z.number().positive().max(1000).describe('Hours available'),
        category: z.string().optional().describe('Only this category, e.g. "redirects"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ hours, category }) =>
      tool(() =>
        withSite(home, ({ db, config, propertyId }) => {
          const run = latestRun(db, propertyId);
          if (!run) throw new UserError(NO_AUDIT);

          const fixes = groupFixes(openFindings(db, run.id, category));
          const { picked, tooBig, used } = fillHours(fixes, hours);
          const findings = picked.flatMap((fix) => fix.findings);
          // Expected recovery: value at stake × expected yield, by metric.
          const recovered = new Map<string, number>();
          for (const f of findings) {
            if (f.value_metric === 'none') continue;
            const gain = f.value_amount * f.expected_yield;
            recovered.set(f.value_metric, (recovered.get(f.value_metric) ?? 0) + gain);
          }
          const gains = [...recovered].map(([metric, n]) => `${round(n)} ${metric}`);

          const lines = [
            describeRun(run, config.site.url),
            `${picked.length} fixes, covering ${findings.length} findings, fit in ${hours} h, ` +
              `using ${round(used)} h.`,
            gains.length > 0
              ? `Expected recovery if the fixes work: about ${gains.join(' and ')} per 28 days ` +
                '(value at stake × expected yield).'
              : 'None of the picks has search traffic at stake; they are hygiene fixes.',
          ];
          return reply(
            lines.join('\n'),
            untrusted('sprint', {
              picks: picked.map(describeFix),
              didNotFit: tooBig.slice(0, 3).map(describeFix),
            }),
          );
        }),
      ),
  );
}

/** One fix: a single finding, or findings of one check that share a fix group. */
export interface Fix {
  findings: FindingRow[];
  /** A shared fix costs the largest effort among its findings, once. */
  effortHours: number;
}

/** Gathers ranked findings into fixes, each placed where its top finding ranks. */
export function groupFixes(ranked: FindingRow[]): Fix[] {
  const fixes: Fix[] = [];
  const shared = new Map<string, Fix>();
  for (const f of ranked) {
    const group = f.fix_group === null ? undefined : `${f.check_id}\n${f.fix_group}`;
    const existing = group === undefined ? undefined : shared.get(group);
    if (existing) {
      existing.findings.push(f);
      existing.effortHours = Math.max(existing.effortHours, f.effort_hours);
      continue;
    }
    const fix = { findings: [f], effortHours: f.effort_hours };
    fixes.push(fix);
    if (group !== undefined) shared.set(group, fix);
  }
  return fixes;
}

/** Takes fixes in rank order while their effort fits in the hours left. */
export function fillHours(fixes: Fix[], hours: number) {
  const picked: Fix[] = [];
  const tooBig: Fix[] = [];
  let used = 0;
  for (const fix of fixes) {
    if (used + fix.effortHours <= hours + 1e-9) {
      picked.push(fix);
      used += fix.effortHours;
    } else {
      tooBig.push(fix);
    }
  }
  return { picked, tooBig, used };
}

/** A single finding in its short form; a shared fix as one entry with its findings' ids. */
function describeFix(fix: Fix) {
  const top = fix.findings[0]!;
  if (fix.findings.length === 1) return brief(top);
  const urls = fix.findings.flatMap((f) => JSON.parse(f.urls) as string[]);
  const amounts = new Map<string, number>();
  for (const f of fix.findings) {
    amounts.set(f.value_metric, (amounts.get(f.value_metric) ?? 0) + f.value_amount);
  }
  return {
    sharedFix: top.fix_group,
    check: top.check_id,
    title: checkTitle(top.check_id),
    findingIds: fix.findings.map((f) => f.id),
    findings: fix.findings.length,
    urls: urls.slice(0, FIX_URLS),
    moreUrls: Math.max(0, urls.length - FIX_URLS),
    value: Object.fromEntries(amounts),
    effortHours: fix.effortHours,
  };
}
