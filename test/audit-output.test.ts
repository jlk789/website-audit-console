import { describe, expect, it } from 'vitest';
import { describeAudit } from '../src/cli/commands/audit.js';
import type { EngineFinding } from '../src/engine/run.js';
import type { AuditResult } from '../src/engine/store.js';

const finding = (checkId: string, key: string): EngineFinding => ({
  checkId,
  key,
  urls: [key],
  severityFloor: false,
  valueAmount: 0,
  expectedYield: 0.5,
  certainty: 1,
  effortHours: 1,
  checkVersion: 1,
  status: 'new',
  summary: `${checkId} at ${key}`,
  detail: null,
  reasoning: null,
  valueMetric: 'none',
  valueBasis: 'observed',
  valueMethod: null,
  priority: 0,
  fix: null,
  fixGroup: null,
  evidence: [],
});

const result = (findings: EngineFinding[]): AuditResult & { siteUrl: string } => ({
  runId: 'run',
  siteUrl: 'https://example.com/',
  snapshot: { propertyId: 1, crawlId: 'c' },
  ran: 2,
  skipped: [],
  errors: [],
  findings,
  resolved: [],
});

describe('describeAudit', () => {
  // 13 findings from one check, then 2 from another.
  const many = [
    ...Array.from({ length: 13 }, (_, i) => finding('indexing.repetitive', `/tag-${i}`)),
    finding('redirects.chain', '/a'),
    finding('redirects.chain', '/b'),
  ];

  it('folds a check with more than 3 findings into its top one', () => {
    const lines = describeAudit(result(many), { all: false });
    expect(lines.filter((l) => l.includes('indexing.repetitive at'))).toHaveLength(1);
    expect(lines).toContain('              ...and 12 more like this.');
    expect(lines.filter((l) => l.includes('redirects.chain at'))).toHaveLength(2);
    expect(lines.at(-1)).toBe('Run "audit --all" to list every finding.');
  });

  it('lists everything with --all', () => {
    const lines = describeAudit(result(many), { all: true });
    expect(lines.filter((l) => l.includes(' at /'))).toHaveLength(15);
    expect(lines.some((l) => l.includes('more like this'))).toBe(false);
  });

  it('shows at most 20 entries and says how many more there are', () => {
    const varied = Array.from({ length: 25 }, (_, i) => finding(`redirects.check-${i}`, `/p${i}`));
    const lines = describeAudit(result(varied), { all: false });
    expect(lines.filter((l) => l.includes(' at /'))).toHaveLength(20);
    expect(lines).toContain('5 more not shown.');
  });
});
