import { readFileSync } from 'node:fs';
import { Command } from 'commander';

// Same relative path from src/cli/ and dist/cli/.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Each command lands in its milestone. Until then it says which one. */
const commands = [
  { name: 'init', description: 'Create a config file for a site', milestone: 'M1' },
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
    .version(pkg.version);

  for (const { name, description, milestone } of commands) {
    program
      .command(name)
      .description(description)
      .action(() => {
        program.error(`"${name}" is not implemented yet (milestone ${milestone}).`);
      });
  }

  return program;
}
