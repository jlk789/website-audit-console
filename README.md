# Website Audit Console

A free, local-first website audit tool. It syncs your Google Search Console history, crawls your site, keeps everything in one SQLite file on your machine, runs checks, and ranks findings by the value at stake. It runs from `npx` and works as an MCP server in Claude Desktop.

The npm package and command are called `webmastery-console`.

## Status

Pre-release. v0.1 is being built (see [docs/v0.1-plan.md](docs/v0.1-plan.md)). Only `init` works so far; the other commands say which milestone they arrive in.

## Getting started

```bash
webmastery-console init --site https://example.com/ --brand example
```

This writes a config file and creates the local database. `--brand` takes one or more brand terms, used later to separate brand from non-brand searches. Run `init` again with `--force` to replace the config.

### Where your data lives

Everything is kept in one folder on your machine:

| OS | Default folder |
| --- | --- |
| Windows | `C:\Users\<you>\.webmastery-console\` |
| macOS and Linux | `~/.webmastery-console/` |

It holds `config.json` (your settings) and `data.db` (the SQLite database). To use a different folder, pass `--home <folder>` to any command or set the `WEBMASTERY_CONSOLE_HOME` environment variable.

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
| `npm test` | Builds, then runs the Vitest suite (one test runs the compiled code in `dist/`) |

## Docs

- [Product spec](docs/spec.md)
- [v0.1 plan](docs/v0.1-plan.md)
- [Check contract](docs/check-contract.md)
- [Decisions](docs/decisions.md)
