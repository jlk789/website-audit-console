import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { STEPS, type BackgroundRun } from '../background.js';
import { reply, tool } from '../format.js';
import { withSite } from '../site.js';

export function registerRunAudit(server: McpServer, home: string, runner: BackgroundRun): void {
  server.registerTool(
    'run_audit',
    {
      title: 'Run an audit',
      description:
        'Refreshes the data and re-runs the checks: syncs new Search Console days (if connected), ' +
        'crawls the site (continuing an unfinished crawl), then audits. It starts in the ' +
        'background and returns at once; a full run can take several minutes. Call audit_status ' +
        'to follow progress, then whats_wrong for the results.',
      inputSchema: {
        steps: z
          .array(z.enum(STEPS))
          .min(1)
          .default([...STEPS])
          .describe('Which steps to run, in this order: sync, crawl, audit'),
      },
      // Sync and crawl reach Google and the site; the audit writes its results.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ steps }) =>
      tool(() => {
        // Fails early, with a clear message, if the config or database is missing.
        withSite(home, () => undefined);
        if (!runner.start(steps)) {
          return reply('A run is already in progress. Call audit_status to follow it.');
        }
        return reply(
          `Started: ${STEPS.filter((s) => steps.includes(s)).join(', then ')}. ` +
            'Call audit_status to follow progress.',
        );
      }),
  );
}
