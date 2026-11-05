/** The scoring inputs of one finding, as stored. */
export interface Scored {
  checkId: string;
  key: string;
  urls: string[];
  severityFloor: boolean;
  valueAmount: number;
  expectedYield: number;
  certainty: number;
  effortHours: number;
}

/** Value at stake × expected yield × certainty ÷ effort hours (docs/spec.md). */
export function priority(f: Omit<Scored, 'checkId' | 'key' | 'urls' | 'severityFloor'>): number {
  return (f.valueAmount * f.expectedYield * f.certainty) / f.effortHours;
}

/** How cheap and likely a fix is, regardless of value: the tie-breaker. */
export const ease = (f: Scored): number => (f.expectedYield * f.certainty) / f.effortHours;

/**
 * Orders findings: severity floor first, then by priority. Ties, such as
 * the many findings worth 0 clicks on a small site, go to the easier fix,
 * then to the one affecting more URLs, then by check id and key so the
 * order is always the same.
 */
export function compareFindings(a: Scored, b: Scored): number {
  return (
    Number(b.severityFloor) - Number(a.severityFloor) ||
    priority(b) - priority(a) ||
    ease(b) - ease(a) ||
    b.urls.length - a.urls.length ||
    a.checkId.localeCompare(b.checkId) ||
    a.key.localeCompare(b.key)
  );
}
