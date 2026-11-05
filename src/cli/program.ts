import { Command, InvalidArgumentError } from 'commander';
import open from 'open';
import { UserError } from '../errors.js';
import { version } from '../version.js';
import { describeAudit, runAudit } from './commands/audit.js';
import { runConnectGoogle } from './commands/connect.js';
import { runCrawl } from './commands/crawl.js';
import { runInit } from './commands/init.js';
import { runSync } from './commands/sync.js';

/** Commands not built yet. Each one says which milestone it lands in. */
const stubs = [
  { name: 'mcp', description: 'Start the MCP server for Claude Desktop', milestone: 'M5' },
];

export function buildProgram(): Command {
  const program = new Command()
    .name('webmastery-console')
    .description(
      'Local-first website audit: Search Console history, crawl, checks and ranked findings.',
    )
    .version(version)
    .option('--home <folder>', 'folder for config and data (default: ~/.webmastery-console)');

  const home = () => program.opts<{ home?: string }>().home;

  /** Runs `work` with an AbortSignal that the first Ctrl+C aborts. */
  const stoppable = async (what: string, work: (signal: AbortSignal) => Promise<unknown>) => {
    const controller = new AbortController();
    const stop = () => {
      console.log(`Stopping after the current ${what}. Press Ctrl+C again to quit at once.`);
      controller.abort();
    };
    process.once('SIGINT', stop);
    try {
      await work(controller.signal);
    } finally {
      process.removeListener('SIGINT', stop);
    }
    return controller.signal.aborted;
  };

  /** Prints a UserError's message without a stack trace; lets anything else crash loudly. */
  const friendly =
    <A extends unknown[]>(action: (...args: A) => Promise<void> | void) =>
    async (...args: A) => {
      try {
        await action(...args);
      } catch (error) {
        if (error instanceof UserError) program.error(error.message);
        throw error;
      }
    };

  program
    .command('init')
    .description('Create the config file and database for a site')
    .requiredOption('--site <url>', 'site to audit, e.g. https://example.com/')
    .option('--brand <terms...>', 'brand terms, used to separate brand from non-brand queries')
    .option('--force', 'replace an existing config')
    .action(
      friendly((options: { site: string; brand?: string[]; force?: boolean }) => {
        const result = runInit({ ...options, home: home() });
        console.log(`Config:   ${result.configFile}`);
        console.log(`Database: ${result.dbFile} (schema version ${result.schemaVersion})`);
        console.log(`Site:     ${result.siteUrl}`);
      }),
    );

  program
    .command('connect')
    .description('Connect a data source')
    .command('google')
    .description('Connect Google Search Console with your own OAuth client or a service account')
    .option('--oauth-client <file>', 'OAuth client file for a "Desktop app" client')
    .option('--service-account <file>', 'service-account key file')
    .option('--property <property>', 'Search Console property, e.g. sc-domain:example.com')
    .action(
      friendly(
        async (options: { oauthClient?: string; serviceAccount?: string; property?: string }) => {
          const result = await runConnectGoogle(
            { ...options, home: home() },
            { log: (line) => console.log(line), openUrl: (url) => open(url) },
          );
          console.log(`Connected to Search Console property ${result.property}.`);
          console.log('Run "webmastery-console sync" to download its history.');
        },
      ),
    );

  program
    .command('sync')
    .description('Download Search Console history: 16 months the first time, then new days')
    .action(
      friendly(async () => {
        const stopped = await stoppable('day', (signal) =>
          runSync({ home: home(), report: (line) => console.log(line), signal }),
        );
        if (stopped) console.log('Stopped. Run "webmastery-console sync" again to continue.');
      }),
    );

  program
    .command('crawl')
    .description('Crawl the site; continues an unfinished crawl unless --new is given')
    .option('--new', 'start a new crawl instead of continuing an unfinished one')
    .option('--max-pages <n>', 'page limit for a new crawl (default: crawl.maxPages)', (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('Give a whole number.');
      return n;
    })
    .action(
      friendly(async (options: { new?: boolean; maxPages?: number }) => {
        const stopped = await stoppable('batch of pages', (signal) =>
          runCrawl({
            home: home(),
            report: (line) => console.log(line),
            signal,
            fresh: options.new,
            maxPages: options.maxPages,
          }),
        );
        if (stopped) console.log('Stopped. Run "webmastery-console crawl" again to continue.');
      }),
    );

  program
    .command('audit')
    .description(
      'Run every check on the latest crawl and Search Console data, and rank the findings',
    )
    .option('--all', 'list every finding, not just the top 20')
    .action(
      friendly(async (options: { all?: boolean }) => {
        const result = await runAudit({ home: home() });
        for (const line of describeAudit(result, options.all ? Infinity : 20)) {
          console.log(line);
        }
      }),
    );

  for (const { name, description, milestone } of stubs) {
    program
      .command(name)
      .description(description)
      .action(() => {
        program.error(`"${name}" is not implemented yet (milestone ${milestone}).`);
      });
  }

  return program;
}
