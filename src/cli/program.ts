import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import open from 'open';
import { UserError } from '../errors.js';
import { runConnectGoogle } from './commands/connect.js';
import { runInit } from './commands/init.js';
import { runSync } from './commands/sync.js';

// Same relative path from src/cli/ and dist/cli/.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Commands not built yet. Each one says which milestone it lands in. */
const stubs = [
  { name: 'crawl', description: 'Crawl the site', milestone: 'M3' },
  { name: 'audit', description: 'Run checks and rank findings', milestone: 'M4' },
  { name: 'mcp', description: 'Start the MCP server for Claude Desktop', milestone: 'M5' },
];

export function buildProgram(): Command {
  const program = new Command()
    .name('webmastery-console')
    .description(
      'Local-first website audit: Search Console history, crawl, checks and ranked findings.',
    )
    .version(pkg.version)
    .option('--home <folder>', 'folder for config and data (default: ~/.webmastery-console)');

  const home = () => program.opts<{ home?: string }>().home;

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
        const controller = new AbortController();
        const stop = () => {
          console.log('Stopping after the current day. Press Ctrl+C again to quit at once.');
          controller.abort();
        };
        process.once('SIGINT', stop);
        try {
          await runSync({
            home: home(),
            report: (line) => console.log(line),
            signal: controller.signal,
          });
        } finally {
          process.removeListener('SIGINT', stop);
        }
        if (controller.signal.aborted) {
          console.log('Stopped. Run "webmastery-console sync" again to continue.');
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
