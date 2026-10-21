import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A fresh, empty folder for one test. Close any database in it before cleanup. */
export function makeTempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(tmpdir(), 'wmc-test-'));
  return {
    home,
    // Windows can hold a file lock for a moment after a database closes, so retry.
    cleanup: () => rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
