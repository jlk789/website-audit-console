# Website Audit Console

A free, local-first website audit tool. It syncs your Google Search Console history, crawls your site, keeps everything in one SQLite file on your machine, runs checks, and ranks findings by the value at stake. It runs from `npx` and works as an MCP server in Claude Desktop.

The npm package and command are called `webmastery-console`.

## Status

Pre-release. v0.1 is being built (see [docs/v0.1-plan.md](docs/v0.1-plan.md)). `init`, `connect google` and `sync` work so far; the other commands say which milestone they arrive in.

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

It holds `config.json` (your settings) and `data.db` (the SQLite database), and once you connect Google, `secrets/` (your credential file) and `tokens/` (your sign-in). To use a different folder, pass `--home <folder>` to any command or set the `WEBMASTERY_CONSOLE_HOME` environment variable.

## Connecting Google Search Console

The console reads Search Console with read-only access, using credentials you create in your own Google Cloud project. Nothing passes through anyone else's servers. Pick one of the two routes below; both take about ten minutes and are free.

| Route | Best for |
| --- | --- |
| **OAuth client** | Most people. You sign in once in your browser. Works for any property your Google account can see. |
| **Service account** | Servers, Docker and scheduled syncs. No browser sign-in, but you must be able to add users to the Search Console property, and some company Google accounts block service-account keys. |

### Both routes start the same way

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (for example "webmastery-console").
2. Open the [Google Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com) page, check your new project is selected at the top, and click **Enable**.

### Route 1: OAuth client

3. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and click **Get started**. Enter an app name (it can't contain "Google"), pick your own email as the support email, choose **External** as the audience, enter your email as the contact, and finish.

   Leave the optional **Branding** fields empty: logo, home page, privacy policy, terms of service and authorised domains. Filling any of them in makes Google ask you to verify the domain, and a logo sends the app to Google for review. None of them are needed for an app only you use.
4. Go to **Audience → Test users → Add users** and add the Google account that can see your site in Search Console.
5. Go to **Clients → Create client**, choose **Desktop app**, click **Create**, then **Download JSON**.
6. Run:

   ```bash
   webmastery-console connect google --oauth-client path/to/client_secret_XXXX.json
   ```

   Your browser opens at Google's sign-in page. Choose the account you added as a test user. Because the app is yours and unverified, Google shows "Google hasn't verified this app": click **Continue** (on some screens, **Advanced** and then **Go to (your app name)** first). The console only asks for read-only Search Console access.

**Testing mode signs you out every 7 days.** While the app's publishing status is "Testing", Google ends the sign-in after 7 days. `sync` then stops with a message saying so; run `connect google` again to sign back in. To avoid this, go to **Audience** and click **Publish app**. Google only allows that once the Branding page saves, so if **Publish app** is greyed out, open **Branding**, check the app name and support email are filled in and the optional fields are empty, and click **Save**. If you plan to sync on a schedule, Route 2 avoids sign-ins altogether.

### Route 2: Service account

3. Open **IAM & Admin → Service Accounts → Create service account**. Give it a name; it needs no roles.
4. Open the new account, go to **Keys → Add key → Create new key**, choose **JSON**, and download it. If Google says key creation is disabled by an organisation policy, use Route 1 instead.
5. In [Search Console](https://search.google.com/search-console), open your property, go to **Settings → Users and permissions → Add user**, and add the service account's email address (it ends in `iam.gserviceaccount.com`) with **Restricted** permission.
6. Run:

   ```bash
   webmastery-console connect google --service-account path/to/key.json
   ```

### After connecting

`connect google` copies your credential file into the home folder, so you can delete the downloaded copy. It then picks the Search Console property that matches your site, preferring a domain property (`sc-domain:example.com`). If it can't tell which one you mean, it lists them; run it again with `--property "<property>"`.

If it says your account can't see a matching property, the Google account you signed in with doesn't have access to the site in Search Console. Either sign in with the account that owns the property, or have that account add yours under **Settings → Users and permissions → Add user** (**Restricted** is enough).

## Syncing Search Console

```bash
webmastery-console sync
```

The first sync downloads the last 16 months, one day at a time, which can take a while for a large site. Later syncs download only the days you don't have yet. Days are never deleted, so your history keeps growing after Google drops data older than 16 months.

Press **Ctrl+C** to stop after the current day; run `sync` again to continue where it stopped.

For each day the console also stores:

- **Anonymised share:** the share of clicks Search Console hides by anonymising rare queries. Query-level findings are less certain on days where it is high.
- **Row cap:** Search Console keeps at most 50,000 query rows per day. Days that reach the cap are flagged, because some queries are missing.

## Principles

- **Local-first.** Your data never leaves your machine except in calls to APIs you enable. No telemetry.
- **Traceable.** Every finding points to the stored data that produced it.
- **Off means off.** Leave a key empty and that service is switched off.

## Developing

You need Node.js 24 or later and Git.

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
