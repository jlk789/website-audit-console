import type Database from 'better-sqlite3';
import type {
  CheckContext,
  CheckDefinition,
  EvidenceRef,
  FindingDraft,
  FixAsset,
  ValueAtStake,
} from '../checks/types.js';
import type { Config } from '../config/schema.js';
import { SkipCheck } from '../checks/types.js';
import { UserError, messageOf } from '../errors.js';
import { evidenceBuilder, readOnlyDb } from './context.js';
import { priority, type Scored } from './rank.js';
import type { Availability } from './snapshot.js';

export type FindingStatus = 'new' | 'persisting' | 'resolved';

/** A validated finding with the engine's scoring inputs filled in. */
export interface EngineFinding extends Scored {
  checkVersion: number;
  status: FindingStatus;
  summary: string;
  detail: string | null;
  reasoning: string | null;
  valueMetric: ValueAtStake['metric'];
  valueBasis: ValueAtStake['basis'];
  valueMethod: string | null;
  priority: number;
  fix: FixAsset | null;
  /** Findings of one check with the same fixGroup share one fix. */
  fixGroup: string | null;
  evidence: EvidenceRef[];
}

export interface CheckOutcome {
  check: CheckDefinition;
  status: 'ran' | 'skipped' | 'error';
  /** Why a check was skipped, or what went wrong. */
  reason?: string;
  /** Status is 'new' until the run is compared with earlier runs. */
  findings: EngineFinding[];
}

/** Stops the audit if the config names a check or threshold that doesn't exist. */
export function checkThresholdConfig(checks: CheckDefinition[], config: Config): void {
  for (const [id, overrides] of Object.entries(config.checks)) {
    const check = checks.find((c) => c.id === id);
    if (!check) throw new UserError(`config.json "checks" names an unknown check: ${id}.`);
    for (const name of Object.keys(overrides)) {
      if (!(name in check.thresholds)) {
        const known = Object.keys(check.thresholds).join(', ') || 'none';
        throw new UserError(`${id} has no threshold "${name}". Its thresholds: ${known}.`);
      }
    }
  }
}

/**
 * Runs each check whose capabilities are available, on the read-only
 * connection. A check that throws, or returns a finding that breaks the
 * contract, is reported as an error; the others still run.
 */
export async function runChecks(
  checks: CheckDefinition[],
  ro: Database.Database,
  availability: Availability,
  config: Config,
): Promise<CheckOutcome[]> {
  const { snapshot, missing } = availability;
  const outcomes: CheckOutcome[] = [];

  for (const check of checks) {
    const lacking = check.requires.filter((capability) => missing[capability]);
    if (lacking.length > 0) {
      const reason = lacking
        .map((capability) => `${capability}: ${missing[capability]}`)
        .join('; ');
      outcomes.push({ check, status: 'skipped', reason, findings: [] });
      continue;
    }

    const ctx: CheckContext = {
      db: readOnlyDb(ro),
      snapshot,
      config: {
        siteUrl: config.site.url,
        brandTerms: config.site.brandTerms,
        thresholds: { ...check.thresholds, ...config.checks[check.id] },
      },
      evidence: evidenceBuilder(snapshot.propertyId, snapshot.crawlId),
    };
    try {
      const drafts = await check.run(ctx);
      const keys = new Set<string>();
      const findings = drafts.map((draft) => {
        if (keys.has(draft.key)) throw new Error(`two findings share the key "${draft.key}"`);
        keys.add(draft.key);
        return toFinding(check, draft, ro, snapshot.propertyId);
      });
      outcomes.push({ check, status: 'ran', findings });
    } catch (error) {
      // A check that says its data is too thin to judge is skipped, not failed.
      const status = error instanceof SkipCheck ? 'skipped' : 'error';
      outcomes.push({ check, status, reason: messageOf(error), findings: [] });
    }
  }
  return outcomes;
}

/** Checks a draft against the contract's rules and fills in the defaults. */
function toFinding(
  check: CheckDefinition,
  draft: FindingDraft,
  ro: Database.Database,
  propertyId: number,
): EngineFinding {
  const problem = (text: string) => new Error(`finding "${draft.key}": ${text}`);
  if (!draft.key) throw problem('has no key');
  if (draft.evidence.length === 0) throw problem('has no evidence');
  if (check.label === 'judgement' && !draft.reasoning) {
    throw problem('a judgement check must give its reasoning');
  }
  const value = draft.valueAtStake;
  if (!Number.isFinite(value.amount) || value.amount < 0) {
    throw problem(`value at stake must be 0 or more, not ${value.amount}`);
  }
  if (value.basis === 'estimated' && !value.method) {
    throw problem('an estimated value must say how it was estimated');
  }
  if (draft.fixGroup !== undefined && !draft.fixGroup.trim()) {
    throw problem('a fix group must say what the shared fix is');
  }

  // Every evidence query must be read-only and run; at least one must return rows.
  let rows = 0;
  for (const ref of draft.evidence) {
    const statement = ro.prepare(ref.sql);
    if (!statement.reader || !statement.readonly) {
      throw problem(`evidence "${ref.label}" is not a read-only query`);
    }
    rows += statement.all(...ref.params).length;
  }
  if (rows === 0) throw problem('none of its evidence queries return any rows');

  const certainty = draft.certainty ?? check.defaults.certainty;
  if (certainty < 0 || certainty > 1) throw problem(`certainty must be 0–1, not ${certainty}`);
  const override = ro
    .prepare(
      `SELECT effort_hours_override AS hours FROM finding_lifecycle
        WHERE property_id = ? AND check_id = ? AND key = ?`,
    )
    .get(propertyId, check.id, draft.key) as { hours: number | null } | undefined;
  const effortHours = override?.hours ?? draft.effortHours ?? check.defaults.effortHours;
  if (!(effortHours > 0)) throw problem(`effort must be more than 0 hours, not ${effortHours}`);

  const scored = {
    checkId: check.id,
    key: draft.key,
    urls: draft.urls,
    severityFloor: check.severityFloor,
    valueAmount: value.amount,
    expectedYield: check.defaults.expectedYield,
    certainty,
    effortHours,
  };
  return {
    ...scored,
    checkVersion: check.version,
    status: 'new',
    summary: draft.summary,
    detail: draft.detail ?? null,
    reasoning: draft.reasoning ?? null,
    valueMetric: value.metric,
    valueBasis: value.basis,
    valueMethod: value.method ?? null,
    priority: priority(scored),
    fix: draft.fix ?? null,
    fixGroup: draft.fixGroup ?? null,
    evidence: draft.evidence,
  };
}
