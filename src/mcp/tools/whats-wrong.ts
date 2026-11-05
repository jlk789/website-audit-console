import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { foldByCheck } from '../../engine/fold.js';
import { UserError } from '../../errors.js';
import { brief, describeRun, reply, tool } from '../format.js';
import { latestRun, NO_AUDIT, openFindings, withSite } from '../site.js';
import { untrusted } from '../untrusted.js';

/** A check with more findings than this is folded unless `all` is set. */
const GROUP_OVER = 3;

export function registerWhatsWrong(server: McpServer, home: string): void {
  server.registerTool(
    'whats_wrong',
    {
      title: "What's wrong",
      description:
        'The top findings from the latest audit, severity floor first, then by priority ' +
        '(value at stake × expected yield × certainty ÷ effort). Checks with many similar ' +
        'findings are folded into their top one plus a count, unless all is true. Pass a ' +
        "finding's id to explain_finding for its evidence and fix.",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe('Only this category, e.g. "redirects", "indexing", "search-performance"'),
        limit: z.int().min(1).max(100).default(10).describe('How many entries to return'),
        all: z.boolean().default(false).describe('List every finding instead of folding'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ category, limit, all }) =>
      tool(() =>
        withSite(home, ({ db, config, propertyId }) => {
          const run = latestRun(db, propertyId);
          if (!run) throw new UserError(NO_AUDIT);

          const findings = openFindings(db, run.id, category);
          const entries = foldByCheck(
            findings.map((f) => ({ ...f, checkId: f.check_id })),
            all ? Infinity : GROUP_OVER,
          );
          const listed = entries.slice(0, limit);
          const skipped = Object.keys(JSON.parse(run.skipped) as object).length;

          const lines = [
            describeRun(run, config.site.url),
            `${findings.length} open findings${category ? ` in ${category}` : ''}` +
              ` (${findings.filter((f) => f.status === 'new').length} new). ` +
              `Showing ${listed.length} of ${entries.length} entries.` +
              (skipped > 0 ? ` ${skipped} checks were skipped; audit_status says why.` : ''),
          ];
          return reply(
            lines.join('\n'),
            listed.length > 0
              ? untrusted(
                  'findings',
                  listed.map(({ finding, more }) => ({
                    ...brief(finding),
                    ...(more > 0 ? { moreLikeThis: more } : {}),
                  })),
                )
              : '',
          );
        }),
      ),
  );
}
