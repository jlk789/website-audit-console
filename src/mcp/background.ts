import { runAudit } from '../cli/commands/audit.js';
import { runCrawl } from '../cli/commands/crawl.js';
import { runSync } from '../cli/commands/sync.js';
import type { GscApi } from '../connectors/gsc/api.js';
import { readConfig } from '../config/load.js';
import { configPath } from '../config/paths.js';

export const STEPS = ['sync', 'crawl', 'audit'] as const;
export type Step = (typeof STEPS)[number];

export interface StepResult {
  step: Step;
  status: 'running' | 'done' | 'skipped' | 'failed' | 'stopped';
  message?: string;
}

export interface RunState {
  startedAt: string;
  finishedAt?: string;
  steps: StepResult[];
  /** The latest progress lines from sync and crawl. */
  log: string[];
}

export interface BackgroundOptions {
  home: string;
  /** Aborted when the server shuts down: the current step stops cleanly. */
  signal: AbortSignal;
  /** Progress lines also go here (standard error in the real server). */
  report?: (line: string) => void;
  /** Test doubles for the network. */
  fetch?: typeof fetch;
  gscApi?: GscApi;
  retryDelayMs?: number;
}

const LOG_LINES = 10;

/**
 * Runs sync, crawl and audit one after another, in this process, while the
 * MCP server keeps answering. Each step is a job in the jobs table, so if
 * Claude Desktop closes mid-way, the next run resumes where it stopped.
 * One run at a time.
 */
export class BackgroundRun {
  state?: RunState;
  private running?: Promise<void>;

  constructor(private readonly options: BackgroundOptions) {}

  get busy(): boolean {
    return this.running !== undefined;
  }

  /** Starts a run unless one is going. Returns false if one is. */
  start(steps: Step[]): boolean {
    if (this.running) return false;
    const state: RunState = {
      startedAt: new Date().toISOString(),
      steps: STEPS.filter((s) => steps.includes(s)).map((step) => ({ step, status: 'running' })),
      log: [],
    };
    this.state = state;
    this.running = this.run(state).finally(() => {
      state.finishedAt = new Date().toISOString();
      this.running = undefined;
    });
    return true;
  }

  /** Resolves when the current run (if any) ends. */
  async idle(): Promise<void> {
    await this.running;
  }

  private async run(state: RunState): Promise<void> {
    const { home, signal } = this.options;
    const report = (line: string) => {
      state.log = [...state.log, line].slice(-LOG_LINES);
      this.options.report?.(line);
    };

    for (const result of state.steps) {
      if (signal.aborted) {
        result.status = 'stopped';
        continue;
      }
      try {
        if (result.step === 'sync') {
          const gsc = readConfig(configPath(home)).gsc;
          // Off means off: no Search Console connection, no sync.
          if (!gsc?.credentialsFile || !gsc.property) {
            result.status = 'skipped';
            result.message = 'Search Console is not connected.';
            continue;
          }
          await runSync({ home, report, signal, api: this.options.gscApi });
        } else if (result.step === 'crawl') {
          await runCrawl({
            home,
            report,
            signal,
            fetch: this.options.fetch,
            retryDelayMs: this.options.retryDelayMs,
          });
        } else {
          const audit = await runAudit({ home });
          result.message =
            `${audit.ran} checks ran, ${audit.skipped.length} skipped, ${audit.errors.length} failed; ` +
            `${audit.findings.length} open findings ` +
            `(${audit.findings.filter((f) => f.status === 'new').length} new), ` +
            `${audit.resolved.length} resolved.`;
        }
        result.status = signal.aborted ? 'stopped' : 'done';
      } catch (error) {
        result.status = 'failed';
        result.message = error instanceof Error ? error.message : String(error);
      }
    }
  }
}
