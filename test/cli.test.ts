import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/program.js';

describe('cli', () => {
  it('lists every v0.1 command in help', () => {
    const help = buildProgram().helpInformation();
    for (const name of ['init', 'sync', 'crawl', 'audit', 'mcp']) {
      expect(help).toContain(name);
    }
  });

  it('reports the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(buildProgram().version()).toBe(pkg.version);
  });

  it('fails clearly on a command that is not built yet', async () => {
    const program = buildProgram()
      .exitOverride()
      .configureOutput({ writeErr: () => {} });
    await expect(program.parseAsync(['sync'], { from: 'user' })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('milestone M2'),
    });
  });
});
