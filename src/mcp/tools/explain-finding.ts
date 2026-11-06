import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dbPath } from '../../config/paths.js';
import { UserError } from '../../errors.js';
import { brief, checkInfo, reply, round, tool } from '../format.js';
import { openQueryOnly } from '../query-only.js';
import { latestRun, withSite, type FindingRow } from '../site.js';
import { untrusted } from '../untrusted.js';

/** Rows shown per evidence query. The full query is returned too. */
const EVIDENCE_ROWS = 20;

export function registerExplainFinding(server: McpServer, home: string): void {
  server.registerTool(
    'explain_finding',
    {
      title: 'Explain a finding',
      description:
        'Everything about one finding: what the check looks for, the summary, detail and ' +
        'reasoning, how the value at stake was worked out, certainty and effort, the drafted ' +
        `fix (such as a 301 map), and each evidence query with up to ${EVIDENCE_ROWS} of its rows.`,
      inputSchema: {
        id: z.int().positive().describe('Finding id, from whats_wrong or plan_sprint'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) =>
      tool(() =>
        withSite(home, ({ db, propertyId }) => {
          const f = db
            .prepare(
              `SELECT f.* FROM findings f JOIN check_runs r ON r.id = f.run_id
                WHERE f.id = ? AND r.property_id = ?`,
            )
            .get(id, propertyId) as FindingRow | undefined;
          if (!f)
            throw new UserError(`There is no finding with id ${id}. Call whats_wrong for ids.`);

          const evidence = db
            .prepare(
              `SELECT table_name, sql, params, label FROM finding_evidence
                WHERE finding_id = ? ORDER BY ordinal`,
            )
            .all(id) as { table_name: string; sql: string; params: string; label: string }[];

          const ro = openQueryOnly(dbPath(home));
          let rows;
          try {
            rows = evidence.map((e) => {
              const params = JSON.parse(e.params) as unknown[];
              const all = ro.prepare(e.sql).all(...params);
              return {
                label: e.label,
                table: e.table_name,
                sql: e.sql,
                params,
                rowCount: all.length,
                rows: all.slice(0, EVIDENCE_ROWS),
              };
            });
          } finally {
            ro.close();
          }

          const check = checkInfo(f.check_id);
          const latest = latestRun(db, propertyId);
          const ours = [
            `Finding ${f.id}: ${f.check_id} (${check?.label ?? 'unknown'} check, ` +
              `${f.status}${f.severity_floor ? ', severity floor' : ''}).`,
            check ? `What the check looks for: ${check.description}` : '',
            `Priority ${round(f.priority)} = value ${f.value_amount} ${f.value_metric} (${f.value_basis})` +
              ` × yield ${f.expected_yield} × certainty ${round(f.certainty)} ÷ ${f.effort_hours} h.`,
            latest && latest.id !== f.run_id
              ? 'This finding is from an earlier audit; whats_wrong lists the latest.'
              : '',
          ];
          return reply(
            ours.filter(Boolean).join('\n'),
            untrusted('finding', {
              ...brief(f),
              detail: f.detail,
              reasoning: f.reasoning,
              valueMethod: f.value_method,
              fix: f.fix === null ? null : JSON.parse(f.fix),
              evidence: rows,
            }),
          );
        }),
      ),
  );
}
