import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { version } from '../version.js';
import { BackgroundRun, type BackgroundOptions } from './background.js';
import { registerAuditStatus } from './tools/audit-status.js';
import { registerExplainFinding } from './tools/explain-finding.js';
import { registerPlanSprint } from './tools/plan-sprint.js';
import { registerQueryData } from './tools/query-data.js';
import { registerRunAudit } from './tools/run-audit.js';
import { registerWhatsWrong } from './tools/whats-wrong.js';
import { UNTRUSTED_NOTE } from './untrusted.js';

const INSTRUCTIONS =
  'Website Audit Console: a local audit of one website, built from its Google Search Console ' +
  'history and a crawl. Start with whats_wrong; use explain_finding for evidence and fixes, ' +
  'plan_sprint to choose work for a time budget, audit_status for data freshness, run_audit to ' +
  'refresh, and query_data for anything else. ' +
  UNTRUSTED_NOTE;

/** The MCP server with all six tools. `background` settings are for run_audit. */
export function createServer(options: BackgroundOptions): {
  server: McpServer;
  runner: BackgroundRun;
} {
  const server = new McpServer(
    { name: 'webmastery-console', version },
    { instructions: INSTRUCTIONS },
  );
  const runner = new BackgroundRun(options);
  const { home } = options;

  registerWhatsWrong(server, home);
  registerExplainFinding(server, home);
  registerPlanSprint(server, home);
  registerQueryData(server, home);
  registerAuditStatus(server, home, runner);
  registerRunAudit(server, home, runner);
  return { server, runner };
}
