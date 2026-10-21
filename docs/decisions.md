# Decisions

A dated log of decisions that shape scope, schema, the check contract or how the project is run. Newest first. Each entry says what was decided and why.

## 2026-10-21

**Line endings are LF everywhere.** A `.gitattributes` file stores and checks out text files with LF on every OS (except Windows scripts, which use CRLF). Why: the project is developed on Windows but used on macOS and Linux too, and mixed endings create noisy diffs.

**Secrets and local data are never committed.** API keys, OAuth clients, tokens, SQLite databases and crawler storage are all covered by `.gitignore`. Any example config is committed as `.env.example` or similar, with empty values. Why: this is a public repo, and a leaked key or user database cannot be fully removed from git history.

**The repo is the source of truth.** `docs/spec.md` is the repo copy of the product spec. When the spec changes, update this file. Any claude.ai Project uses repo files as knowledge, never the other way round. Why: one place to look, and no drift between build context and planning context.

**Stack: TypeScript on Node, SQLite, Crawlee, MCP over stdio.** Why: npx distribution and the MCP SDK are TypeScript-first; SQLite keeps all user data in one local file; Crawlee's on-disk queue makes long crawls resumable.

**Jobs run from a SQLite table, not Redis or an external queue.** Why: keeps the tool to one local file and no extra services, while still letting crawls and syncs survive restarts.

**v0.1 scope is Search Console, a static crawler, 31 checks and four MCP tools.** No dashboard, report export, JS rendering or extra data sources yet. Why: ship something useful early, then build on a proven check contract. See `docs/v0.1-plan.md`.

**Every check follows `docs/check-contract.md`.** Checks are read-only, offline and evidence-backed; ranking happens in the engine. Why: hundreds of checks need one consistent, testable shape, and traceability is a core promise.

## Open

- Google sign-in approach: users bring their own OAuth client, or a shared client with Google app verification (decide before M2)
- npm package name
- Licence
- Minimum Node version
