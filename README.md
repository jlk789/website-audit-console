# Website Audit Console

A free, local-first website audit tool. It syncs your Google Search Console history, crawls your site, keeps everything in one SQLite file on your machine, runs checks, and ranks findings by the value at stake. It runs from `npx` and works as an MCP server in Claude Desktop.

The npm package and command are called `webmastery-console`.

## Status

Pre-release. v0.1 is being built (see [docs/v0.1-plan.md](docs/v0.1-plan.md)). The CLI lists its commands, but none of them work yet.

## Principles

- **Local-first.** Your data never leaves your machine except in calls to APIs you enable. No telemetry.
- **Traceable.** Every finding points to the stored data that produced it.
- **Off means off.** Leave a key empty and that service is switched off.

## Developing

You need Node.js 22.12 or later and Git.

### Windows (PowerShell)

```powershell
git clone https://github.com/jlk789/website-audit-console.git
cd website-audit-console
npm install
npm run build
npx . --help
```

### macOS and Linux

```bash
git clone https://github.com/jlk789/website-audit-console.git
cd website-audit-console
npm install
npm run build
npx . --help
```

### Scripts

| Script | Does |
| --- | --- |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm run typecheck` | Type-checks `src/` and `test/` without writing files |
| `npm run lint` | Runs ESLint and checks formatting with Prettier |
| `npm run format` | Fixes formatting with Prettier |
| `npm test` | Runs the Vitest suite |

## Docs

- [Product spec](docs/spec.md)
- [v0.1 plan](docs/v0.1-plan.md)
- [Check contract](docs/check-contract.md)
- [Decisions](docs/decisions.md)
