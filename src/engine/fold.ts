/**
 * Folds repetitive checks for display: a check with more than `groupOver`
 * findings is shown as its top finding plus a count of the rest. Findings
 * must already be ranked. Only the display changes; every finding is stored.
 */
export function foldByCheck<F extends { checkId: string }>(
  findings: F[],
  groupOver: number,
): { finding: F; more: number }[] {
  const perCheck = new Map<string, number>();
  for (const f of findings) perCheck.set(f.checkId, (perCheck.get(f.checkId) ?? 0) + 1);

  const entries: { finding: F; more: number }[] = [];
  const folded = new Set<string>();
  for (const finding of findings) {
    const total = perCheck.get(finding.checkId)!;
    if (total <= groupOver) {
      entries.push({ finding, more: 0 });
    } else if (!folded.has(finding.checkId)) {
      folded.add(finding.checkId);
      entries.push({ finding, more: total - 1 });
    }
  }
  return entries;
}
