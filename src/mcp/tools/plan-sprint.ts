import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { UserError } from '../../errors.js';
import { brief, describeRun, reply, round, tool } from '../format.js';
import { latestRun, NO_AUDIT, openFindings, withSite, type FindingRow } from '../site.js';
import { untrusted } from '../untrusted.js';

export function registerPlanSprint(server: McpServer, home: string): void {
  server.registerTool(
    'plan_sprint',
    {
      title: 'Plan a sprint',
      description:
        'Picks what to fix in a given number of hours: severity-floor findings first, then by ' +
        'priority, skipping any finding whose effort no longer fits. Returns the picks, the ' +
        'hours used, the value they cover and the next findings that did not fit.',
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

          const { picked, tooBig, used } = fillHours(openFindings(db, run.id, category), hours);
          // Expected recovery: value at stake × expected yield, by metric.
          const recovered = new Map<string, number>();
          for (const f of picked) {
            if (f.value_metric === 'none') continue;
            const gain = f.value_amount * f.expected_yield;
            recovered.set(f.value_metric, (recovered.get(f.value_metric) ?? 0) + gain);
          }
          const gains = [...recovered].map(([metric, n]) => `${round(n)} ${metric}`);

          const lines = [
            describeRun(run, config.site.url),
            `${picked.length} findings fit in ${hours} h, using ${round(used)} h.`,
            gains.length > 0
              ? `Expected recovery if the fixes work: about ${gains.join(' and ')} per 28 days ` +
                '(value at stake × expected yield).'
              : 'None of the picks has search traffic at stake; they are hygiene fixes.',
          ];
          return reply(
            lines.join('\n'),
            untrusted('sprint', {
              picks: picked.map(brief),
              didNotFit: tooBig.slice(0, 3).map(brief),
            }),
          );
        }),
      ),
  );
}

/** Takes ranked findings in order while their effort fits in the hours left. */
export function fillHours(ranked: FindingRow[], hours: number) {
  const picked: FindingRow[] = [];
  const tooBig: FindingRow[] = [];
  let used = 0;
  for (const f of ranked) {
    if (used + f.effort_hours <= hours + 1e-9) {
      picked.push(f);
      used += f.effort_hours;
    } else {
      tooBig.push(f);
    }
  }
  return { picked, tooBig, used };
}
