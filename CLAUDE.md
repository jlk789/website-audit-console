# Website Audit Console

A free, local-first website audit tool. It syncs Google Search Console history, crawls the site, stores everything in one SQLite file on the user's machine, runs checks, and ranks findings by value at stake. It runs from npx or Docker and works as an MCP server in Claude Desktop.

- Repo: https://github.com/jlk789/website-audit-console (public)
- Local path: `C:\Users\james\Documents\Claude\Projects\website-audit-console`

## Read these first

| File | What it is |
| --- | --- |
| `docs/spec.md` | The full product spec: data sources, provider matrix, ranking, check catalogue, dashboard, MCP tools |
| `docs/v0.1-plan.md` | What v0.1 includes, milestones M0–M6 with "done when" criteria, schema, the 31 checks |
| `docs/check-contract.md` | The TypeScript interface every check implements, and its rules |
| `docs/decisions.md` | Dated log of decisions and open questions |

The repo is the source of truth. If these files disagree with each other, flag it to JK rather than picking one silently.

## Where we are

- Building v0.1. M0 (scaffold) done 2026-10-21. M1 (config, database, jobs) done 2026-10-21: `init` writes the config and database, migrations create all v0.1 tables, and a hard-killed job resumes exactly (CI on Windows, macOS and Linux, Node 24 and 26). Current milestone: **M2 (Search Console sync)**, blocked on the Google sign-in decision.
- Decided: npm package `webmastery-console` (private until a licence is chosen), Node 24 minimum.
- Open decisions (see `docs/decisions.md`): Google sign-in approach (needed before M2), licence (needed by M6), MCP tool list in spec vs plan (before M5). Ask JK when a task depends on one; don't decide it yourself.

## Principles (non-negotiable)

1. **Local-first.** User data never leaves the machine except in calls to APIs the user has enabled. No telemetry, no analytics, no phoning home.
2. **Traceable.** Every finding points to the evidence rows that produced it. Never write a number into a finding that cannot be traced to stored data.
3. **Labelled.** Every check is either `deterministic` or `judgement`. Judgement checks must explain their reasoning.
4. **Off means off.** An empty key in config disables that service. Checks that need it are skipped and reported as "needs a provider", never errored.
5. **Closed loop.** Findings have a lifecycle (open → fixed → verifying → verified/regressed). Design every table with that in mind, even before v0.2 builds it.

## Stack

- TypeScript, Node 24 or later, ESM only
- SQLite via `better-sqlite3` (one file, WAL mode)
- Crawlee for crawling (Cheerio crawler in v0.1; Playwright added for JS rendering later)
- `@modelcontextprotocol/sdk`, stdio transport
- `zod` for config and data validation
- Vitest for tests
- Jobs live in a SQLite `jobs` table. No Redis, no external queue.

## Repo layout

```
src/
  cli/          # npx entry: init, sync, crawl, audit, mcp
  config/       # config schema (zod), loading, key handling
  db/           # schema, migrations, query helpers
  jobs/         # SQLite-backed job runner, resumable
  connectors/   # one folder per source: gsc/, crawler/, later crux/, bing/ ...
  checks/       # one file per check, grouped by category folder
  engine/       # check runner, ranking, finding diffing
  mcp/          # MCP server and tool definitions
test/
  fixtures/     # fixture sites and seeded databases
docs/
  spec.md
  v0.1-plan.md
  check-contract.md
  decisions.md
.gitignore      # keys, tokens, databases, crawler storage
.gitattributes  # LF line endings everywhere
```

## Working with JK

- JK runs all `npm` install and `git` write commands himself. Give exact PowerShell commands, one per line, with a short note on what each does. He is rusty with git, so spell out branch, add, commit and push steps.
- Plan before building. For each milestone, propose the plan, the files you'll create and the commands JK will run, and wait for his go-ahead.
- JK develops on Windows. Test paths, native modules and installs on Windows first. Use `path.join`, never hard-coded `/`.
- Record any decision that changes scope, schema or the check contract in `docs/decisions.md` (newest first) with the date and reason.
- When a milestone's "done when" criteria pass, update "Where we are" in this file.

## Rules for code

- Every check follows `docs/check-contract.md` exactly. Do not invent new fields on `Finding` without updating the contract first.
- Checks are read-only and make no network calls. Connectors fetch; checks reason over stored data.
- Never log, print or commit API keys, OAuth clients or tokens. Keep anything secret in paths already covered by `.gitignore`; add new patterns there before creating new secret files. Example config files use empty values.
- Every check ships with a fixture test that proves it fires on a broken case and stays quiet on a clean one.
- Prefer small, boring, readable code. A new contributor should understand any check in under five minutes.
- Migrations are additive. Never drop or rename a column that holds user history.

## Definition of done for any task

- Types pass, lint passes, tests pass on Windows and macOS/Linux.
- New checks are listed in `src/checks/index.ts` and in the check table in `docs/v0.1-plan.md`.
- User-facing behaviour changes are reflected in `README.md`.
- Spec changes are made in `docs/spec.md` and noted in `docs/decisions.md`.
