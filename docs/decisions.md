# Decisions

A dated log of decisions that shape scope, schema, the check contract or how the project is run. Newest first. Each entry says what was decided and why.

## 2026-11-06

**v0.1 ships six MCP tools** (resolves the open question): `whats_wrong`, `explain_finding`, `plan_sprint`, `query_data`, `audit_status` and `run_audit`. The spec's tool table gains `explain_finding`, `audit_status` and `run_audit` and marks which tools ship in v0.1; the other spec tools wait for the data they need (fix lifecycle, logs, report, update annotations). Why: `plan_sprint` and `query_data` are cheap with data already stored and answer common questions; `draft_fix` is covered for now by `explain_finding`, which returns any fix a finding has. JK chose this (option B).

**MCP replies mark third-party text as untrusted** (resolves the open item). Each reply keeps our own words (dates, counts, check descriptions) outside, and puts findings, evidence rows, query results, skip reasons and progress lines in an `<untrusted-data source="...">` block as JSON. Every `<` inside is written as `\u003c` (still valid JSON for the same text), so nothing can close the block early. The server's instructions and the block itself tell Claude to treat it as data, never as instructions. Why: findings quote search queries and page text, and `query_data` can return the full 788-character instruction-style "query" in kupka.ca's data.

**`query_data` is read-only three ways:** a read-only connection, `PRAGMA query_only`, and only a single statement that returns rows and changes nothing (so `ATTACH`, writes and `PRAGMA` writes are refused). Results stop at a row limit (default 100, at most 500). Known limit: a very slow query cannot be interrupted and holds the server until it finishes. Why: Claude writes this SQL, so the database must be safe from it by construction.

**`run_audit` runs in the background inside the MCP server**, through the same job queue as the CLI, and returns at once; `audit_status` reports its progress. One run at a time; if Claude Desktop closes mid-way, the current step stops cleanly and the next run resumes it. The MCP server writes nothing but protocol to standard output; progress goes to standard error. Why: a sync or crawl takes minutes and tool calls time out; standard output carries the MCP connection.

**`audit_status` gives both the synced days and the first day with search data.** Why: kupka.ca has 494 synced days but search data only from 2026-07-19, which is why the 90-day checks say "there are 108"; showing only the synced count would contradict the skip reason.

**Checks can say "not enough data": `SkipCheck`** (check contract change, rule 6). A check whose data is connected but too thin throws `SkipCheck` with a reason; the engine lists it as skipped, like a missing data source, so it resolves nothing. Why: kupka.ca has 108 days of Search Console data, and the 90-vs-90-day checks need 180; returning no findings would look exactly like "all fine". JK approved.

**Comparison windows for search performance.** `traffic-decay` and `nonbrand-decline-hidden` compare the last 90 days with the 90 before; `ctr-erosion` compares 28 with 28; `striking-distance` and `cannibalisation` look at the last 28 days. Each window is a threshold (`windowDays`), so a young site can shorten it. Why: one 28-day window is too noisy to call a decline, but CTR shifts show up within weeks. JK approved.

**Search query text is untrusted** (check contract rule 7). Findings quote queries through `quoteQuery`: line breaks and control characters removed, at most 80 characters. Keys use `queryKey`, a hash, never the text. The full text stays in the database and the evidence. Why: kupka.ca's real Search Console data holds a 731-character "query" that is a set of instructions aimed at an AI; once M5 hands findings to Claude Desktop, query text is a prompt-injection route. M5 must also mark query text as untrusted data when the MCP tools return it. JK approved.

**Certainty for query-level findings falls with the anonymised share.** `striking-distance`, `cannibalisation` and `nonbrand-decline-hidden` use certainty × (1 − `anonymisedPenalty` × share), where share is the period's anonymised click share (at least 0.5 if a day hit the row cap) and `anonymisedPenalty` defaults to 0.5. Why: the spec discounts certainty when much of the query data is hidden; page-level checks use page totals, which include anonymised clicks, so they need no discount.

**Striking distance values the gain at the site's own top-3 click-through rate** (last 90 days, positions 1–3), or at a default of 15% (`defaultTopCtr`) when the site has fewer than 100 clicks there. Why: a published industry curve would be a number no stored data can back; the site's own curve can be, and the default is a stated, overridable assumption in the method text.

## 2026-11-05

**Two more evidence helpers in the check contract (M4b):** `sitemapEntries(url)` (the sitemap files listing a URL) and `robots(origin)` (the robots.txt status and every line, as a LEFT JOIN so a file with no lines still returns its status). Why: the sitemap and robots.txt checks cite these rows; additive, like the others. JK approved.

**`audit` folds repetitive checks in its printout.** Without `--all`, a check with more than 3 findings shows its top finding and "...and N more like this", and the list stops at 20 entries. Every finding is still stored separately. Why: on kupka.ca, `indexing.indexable-not-in-sitemap` finds 13 tag pages, which buried the other findings; keeping one finding per page keeps keys, evidence and fixes per page. JK approved.

**`indexing.robots-blocks-site` judges robots.txt as Googlebot.** It reuses the crawler's RFC 9309 matcher with the `googlebot` token, so a site that blocks only this crawler is not flagged. A robots.txt that answers 5xx or 429, or not at all, is flagged with lower certainty (0.8), since Google retries before treating the site as blocked.

**M4 is built in three PRs:** M4a (contract changes, engine, `audit`, and the 12 redirects and hosts-and-404s checks), M4b (14 indexing checks), M4c (5 search-performance checks). Why: 31 checks in one PR is too much to review, and M4a proves the whole pipeline on its own. JK's choice.

**Check contract changes.** (1) `CheckDefinition.thresholds` holds each check's default thresholds; config overrides them with `"checks": { "<id>": { "<name>": n } }`, and an unknown id or name stops the audit. Why: rule 7 put numbers in thresholds, but the contract had nowhere to declare their defaults. (2) `snapshot.propertyId`, and a rule to filter Search Console tables by it. Why: the example joined Search Console data with no property filter. (3) `ReadOnlyDb` and `EvidenceBuilder` are now defined. (4) A new capability, `brand-terms`. Why: the non-brand check can't work without brand terms and should be skipped with a reason, not return nothing. (5) Rule 2 now says the engine runs every evidence query (read-only, must run, at least one returns rows) and rule 4 says to use `metric: 'none'` without Search Console rather than claiming 0 clicks. JK approved all five.

**Two indexing checks use stand-ins until URL Inspection data exists** (spec change). `indexing.indexed-pages-collapse`: the number of pages earning Search Console impressions falls sharply. `indexing.index-bloat-ratio`: indexable crawled pages compared with pages earning clicks. Why: v0.1 has no index counts; a labelled stand-in is more useful than a check that is always skipped. Both say in their description that they are stand-ins. JK's choice.

**Ranking ties go to the easier fix** (spec change): expected yield × certainty ÷ effort, then the number of URLs affected, then check id and key. Why: priority is value × yield × certainty ÷ effort, and on a small site most findings are worth 0 clicks, so without a tie-breaker their order is arbitrary. JK's choice.

**How runs are compared.** Each check's findings are compared with the latest run in which that check ran, by key. Open findings are stored as `new` or `persisting`; an issue open last time and gone now is stored in this run as `resolved`, with its old evidence (old crawls are kept, so it still runs). A skipped or failed check resolves nothing. `finding_lifecycle` records first and last seen, `fixed` when a run stops finding the issue, and `regressed_at` if it returns; verification waits for v0.2. Why: a run is self-describing, and disconnecting a source never "fixes" findings. JK approved.

**The crawler also visits canonical targets** (queue source `canonical`), but only from pages that return 200. Why: on kupka.ca, 3 pages pointed their canonical at URLs the crawl never fetched, so canonical checks couldn't judge them. Search engines ignore the canonical on an error page; following it led the first real audit to a soft-404 finding for `/404`, a page nothing links to, via the canonical in kupka.ca's 404 template.

**Audits run as an `audit` job, saved in one step.** Checks read through a second, read-only SQLite connection, so a write throws. Why: M5's `run_audit` can queue it like sync and crawl, and an interrupted audit leaves nothing half-written.

## 2026-10-30

**The crawler is our own: Node's `fetch` plus `cheerio`, not Crawlee** (replaces Crawlee in the stack decision below). Why: the plan requires every redirect hop recorded with its own status, and `fetch` with `redirect: 'manual'` gives each hop directly, while Crawlee's HTTP client follows redirects itself. Crawlee also keeps its request queue in its own folder on disk, a second store of state outside `data.db` and the job runner, which already passes a hard-kill resume test. And it brings a large dependency tree and fakes browser fingerprints by default, where we want an honest user agent. Cost: we write concurrency, timeouts and one retry ourselves (small). JS rendering, when it comes, uses Playwright directly. JK's choice.

**How a crawl works.** One `crawl` job per crawl. Set-up (one step): fetch robots.txt for the site's origin, read the sitemaps it lists (or `/sitemap.xml`), and fill `crawl_queue` with the start URL, sitemap URLs, pages with Search Console history, and probes. Then batches of `concurrency × 5` URLs, each saved with its newly found links in one step; a killed crawl re-fetches at most the batch in flight. Breadth-first: URLs no link has reached yet wait until every link-reachable URL is done, so `depth` is the shortest click path (NULL means no crawled link leads there). Scope is the site's exact origin. robots.txt is obeyed for that origin only; requests to other hosts are limited to the homepage probes and redirect hops. A finished crawl is kept as a snapshot; `crawl --new` marks an unfinished one `abandoned`.

**Schema additions for the crawler (migration 2).** New tables `crawl_queue` (every URL found, how, its depth and whether it was visited; also how a crawl resumes), `robots_files` (status and raw text per origin, because a 5xx robots.txt blocks the whole site), and `sitemaps` (each file's status, where it was found and its URL count). New `pages` columns `robots_blocked` and `fetch_error`. Why: resume needs the URL list in SQLite; checks need to cite the robots.txt status and sitemap fetch results, which the v0.1 tables had no place for.

**A job runner only claims job types it has a handler for.** Before, any runner took the oldest job of any type and failed it permanently if it had no handler, so `crawl` would have killed a paused `sync`. Why: `sync` and `crawl` each run their own runner, and either may find the other's job waiting.

**The README's OAuth route now treats Testing mode as the normal starting point, with publishing optional.** Users add themselves as a test user and leave the optional Branding fields (logo, links, authorised domains) empty. Why: on the first real setup (kupka.ca), filling in those fields demanded domain verification and kept Branding from saving, which greys out **Publish app**; Testing mode worked straight away. The cost is a sign-in that expires after 7 days, which `sync` already explains. The logo and links belong to the future shared, verified client, which should live in its own Google Cloud project.

## 2026-10-21

**How Search Console sync works.** `connect google` copies the user's credential file into `<home>/secrets/` and stores the sign-in in `<home>/tokens/`, both readable only by the user. `sync` finds the latest day with final data, then fetches every day of the 16 months before it that has no `gsc_sync_state` row, newest first, saving each day (rows plus sync state) in one transaction. Each day makes two paged requests: page totals and query + page, capped at 50,000 rows (Google's daily limit per search type). Uses `google-auth-library` (its OAuth and JWT classes only, never auto-detection) and plain `fetch`, not the large `googleapis` package. Why: the per-day unit makes resume and incremental sync the same thing, never touching unfinished days keeps data lag out of trends, and newest-first means a partly finished backfill already holds the most useful data.

**User-fixable errors fail jobs at once.** A `UserError` (bad option, expired sign-in, missing permission) fails a job without retries and is shown without a stack trace. Rate limits and server errors are retried with backoff, then the job is retried. Why: retrying an expired sign-in five times only delays the message the user needs.

**Google sign-in: users bring their own credentials in v0.1, either their own OAuth client or a service account. A shared, Google-verified client comes in a later version.** Why: both work today with no Google review, and the spec already promises both. A shared client would need Google's verification for the `webmasters.readonly` scope (homepage, privacy policy, demo video, a wait of days to weeks), would show an "unverified app" warning and a 100-user cap until then, and would put every user's backfill on one project quota. It can be added later without changing anything existing users set up. Risks to handle in M2: an OAuth client left in "Testing" mode expires its sign-in after 7 days, and some organisations block service-account key files.

**Minimum Node version raised to 24** (replaces the 22.12 decision below). CI now tests Node 24 and 26 on Windows, macOS and Linux. Why: Node 22 ships npm 10, which ignores `better-sqlite3`'s bundled binary and compiles it from source; on Windows that fails without Visual Studio's C++ tools, and most users won't have them. npm 11 (Node 24 and later) uses the bundled binary. Node 22 reaches end of life in April 2027. The bundled binary uses N-API, so one file works across Node versions.

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

- Shared, Google-verified OAuth client: when to start verification, and on which domain (after v0.1)
- Licence (needed by M6; the package stays private until then)
