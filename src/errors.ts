/**
 * A problem the user can fix, such as a bad option or an expired sign-in.
 * The CLI prints the message without a stack trace, and the job runner
 * fails the job at once instead of retrying, because retrying cannot help.
 */
export class UserError extends Error {}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
