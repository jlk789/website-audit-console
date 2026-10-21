import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { ConfigError } from '../config/load.js';
import { runInit } from './commands/init.js';

// Same relative path from src/cli/ and dist/cli/.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Commands not built yet. Each one says which milestone it lands in. */
const stubs = [
  { name: 'sync', description: 'Sync Google Search Console history', milestone: 'M2' },
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

  program
    .command('init')
    .description('Create the config file and database for a site')
    .requiredOption('--site <url>', 'site to audit, e.g. https://example.com/')
    .option('--brand <terms...>', 'brand terms, used to separate brand from non-brand queries')
    .option('--force', 'replace an existing config')
    .action((options: { site: string; brand?: string[]; force?: boolean }) => {
      try {
        const result = runInit({ ...options, home: program.opts<{ home?: string }>().home });
        console.log(`Config:   ${result.configFile}`);
        console.log(`Database: ${result.dbFile} (schema version ${result.schemaVersion})`);
        console.log(`Site:     ${result.siteUrl}`);
      } catch (error) {
        if (error instanceof ConfigError) program.error(error.message);
        throw error;
      }
    });

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
