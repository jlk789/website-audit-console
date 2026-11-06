import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from '../../config/load.js';
import { configPath, resolveHome } from '../../config/paths.js';
import { createServer } from '../../mcp/server.js';

/**
 * Serves the MCP tools over standard input and output until Claude Desktop
 * closes the connection. Standard output carries the protocol, so nothing
 * else may write to it: progress goes to standard error, which Claude
 * Desktop keeps in its MCP log.
 */
export async function runMcp(options: { home?: string }): Promise<void> {
  const home = resolveHome(options.home);
  readConfig(configPath(home)); // Fails at start, with a clear message, if there is no config.

  const controller = new AbortController();
  const { server, runner } = createServer({
    home,
    signal: controller.signal,
    report: (line) => process.stderr.write(`${line}\n`),
  });

  const stop = async () => {
    controller.abort();
    await runner.idle(); // The current crawl batch or sync day finishes and is saved.
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stdin.once('end', stop);

  await server.connect(new StdioServerTransport());
}
