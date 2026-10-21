# Decisions

A dated log of decisions that shape scope, schema, the check contract or how the project is run. Newest first. Each entry says what was decided and why.

## 2026-10-21

**Config and data live in a home folder: `~/.webmastery-console/` by default.** It holds `config.json` and `data.db` (later also tokens and crawler storage). `--home <folder>` or `WEBMASTERY_CONSOLE_HOME` overrides it. Why: Claude Desktop starts the MCP server from a folder we don't control, so a fixed default lets it always find the data, and it keeps keys and user data out of git repos.

**Schema conventions.** `STRICT` tables; ISO 8601 UTC text for times and `YYYY-MM-DD` for GSC dates; booleans as INTEGER 0/1; text UUIDs for crawl and check-run ids (matching `crawlId: string` in the check contract), integers elsewhere. Status and state columns have no `CHECK` list. Why: STRICT catches type bugs early; a `CHECK` list of allowed values can only be changed by rebuilding the table, which the additive-migrations rule forbids.

**Schema changes from the v0.1 plan.** `gsc_sync_state` has one row per property, search type and *day* (not per property), holding row-cap hits and the anonymised-click share for that day. The GSC tables carry `search_type` in their primary keys. `finding_lifecycle` has `effort_hours_override`. Why: M2 must store row-cap hits and anonymised share per day; adding a column to a primary key later means rebuilding the table; the spec makes effort editable per finding, and that edit must survive across runs.

**Migrations are TypeScript modules holding SQL**, applied in order inside one `IMMEDIATE` transaction and recorded in `schema_migrations`. The database migrates itself on open. Why: `tsc` does not copy `.sql` files into `dist/`, and the immediate lock stops two processes applying the same migration.

**Jobs use leases and step checkpoints.** A runner claims a job with one atomic `UPDATE` and holds a 30-second lease renewed by a heartbeat. Each step writes its data and its checkpoint in one transaction, so a killed job resumes exactly from its last step. `attempts` counts starts (5 maximum) and fences writes from a runner that lost its lease; a clean stop (Ctrl+C) hands its attempt back. Why: exact resume with no external queue, and no risk of two runners writing the same job.

**`better-sqlite3` may not run install scripts** (`allowScripts` in `package.json` denies it). Why: version 13 ships prebuilt binaries for Windows, macOS and Linux (x64 and arm64) inside the package. npm flags it only because it contains a `binding.gyp`, and a future npm release will block unreviewed scripts anyway; the deny records that we rely on the prebuilt binary and never compile. If a platform without a prebuilt binary is ever needed, revisit this.

**`npm test` builds first.** The kill-and-resume test runs a worker in a separate Node process, which imports the compiled code in `dist/`. Why: proves resume after a real hard kill on every OS, without adding `tsx`, which would bring `esbuild` and its install script.

**npm package and command name: `webmastery-console`.** The repo keeps its name. The package is `"private": true` until a licence is chosen, so it cannot be published by accident. Why: JK's choice; the name was free on npm.

**Minimum Node version: 22.12.** CI tests Node 22 and 24 on Windows, macOS and Linux. Why: Node 20 reached end of life in April 2026, and commander 15 and Vitest 5 both need 22.12 or later.

**TypeScript is held at 6.0.x.** Why: TypeScript 7 is out, but typescript-eslint supports only versions below 6.1. Revisit when typescript-eslint supports 7.

**Build and tooling: plain `tsc` to `dist/`, ESLint with typescript-eslint, Prettier, Vitest, commander for the CLI.** Prettier skips Markdown and `package.json`. Why: no bundler keeps the build boring and ESM-only; Prettier ends style debates; docs are hand-formatted; npm rewrites `package.json` in its own layout.

**Relative imports use the `.js` extension.** The check contract example now imports `'../types.js'`. Why: with ESM and `NodeNext` resolution, Node needs the extension at runtime, and TypeScript maps `.js` to the `.ts` source.

**Line endings are LF everywhere.** A `.gitattributes` file stores and checks out text files with LF on every OS (except Windows scripts, which use CRLF). Why: the project is developed on Windows but used on macOS and Linux too, and mixed endings create noisy diffs.

**Secrets and local data are never committed.** API keys, OAuth clients, tokens, SQLite databases and crawler storage are all covered by `.gitignore`. Any example config is committed as `.env.example` or similar, with empty values. Why: this is a public repo, and a leaked key or user database cannot be fully removed from git history.

**The repo is the source of truth.** `docs/spec.md` is the repo copy of the product spec. When the spec changes, update this file. Any claude.ai Project uses repo files as knowledge, never the other way round. Why: one place to look, and no drift between build context and planning context.

**Stack: TypeScript on Node, SQLite, Crawlee, MCP over stdio.** Why: npx distribution and the MCP SDK are TypeScript-first; SQLite keeps all user data in one local file; Crawlee's on-disk queue makes long crawls resumable.

**Jobs run from a SQLite table, not Redis or an external queue.** Why: keeps the tool to one local file and no extra services, while still letting crawls and syncs survive restarts.

**v0.1 scope is Search Console, a static crawler, 31 checks and four MCP tools.** No dashboard, report export, JS rendering or extra data sources yet. Why: ship something useful early, then build on a proven check contract. See `docs/v0.1-plan.md`.

**Every check follows `docs/check-contract.md`.** Checks are read-only, offline and evidence-backed; ranking happens in the engine. Why: hundreds of checks need one consistent, testable shape, and traceability is a core promise.

## Open

- Google sign-in approach: users bring their own OAuth client, or a shared client with Google app verification (decide before M2)
- Licence (needed by M6; the package stays private until then)
- MCP tools: `docs/spec.md` lists 10 tools, `docs/v0.1-plan.md` ships 4, and 3 of those (`explain_finding`, `audit_status`, `run_audit`) are not in the spec (resolve before M5)
