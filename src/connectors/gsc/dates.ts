// Search Console dates are plain calendar days ("YYYY-MM-DD"). These helpers
// do the arithmetic in UTC so no time zone can shift a day.

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function today(now = new Date()): string {
  return format(now);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

export function subtractMonths(date: string, months: number): string {
  const d = parse(date);
  d.setUTCMonth(d.getUTCMonth() - months);
  return format(d);
}

/** Every day from start to end, inclusive, oldest first. */
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}
