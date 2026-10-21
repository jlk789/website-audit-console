# Website Audit Console — Product Spec

Oct 21, 2026 · @JK

## Overview

The Website Audit Console is a free, open-source audit tool that runs entirely on the user's machine and ranks every finding by the business value at stake. It pulls Search Console history, crawls the site, adds field Core Web Vitals and server logs, stores everything in one local database, and runs hundreds of checks.

Three principles shape every feature:

- **Local-first.** No data leaves the user's PC except calls to the APIs they choose to enable. Leave a key empty and that service switches off.
- **Traceable.** Every check is either deterministic or labelled as judgement, and every number links back to the rows that produced it.
- **Closed loop.** Findings are not the end point. The console records fixes and measures whether they worked.

It ships as a GitHub repo, runs via npx or Docker, and works as an MCP server inside Claude Desktop.

## Data sources

Twelve sources feed one local database. Only the crawler and Search Console are required; every other source is switched on by adding its key or file.

| Source | What it adds | Required | Where you find this |
| --- | --- | --- | --- |
| Google Search Console | Query × page history, kept locally beyond Google's 16-month limit; URL inspection | Yes | In Google Cloud Console, create a project and enable the Search Console API. Create OAuth credentials, or a service account added as a user on your Search Console property. |
| Site crawler | 10,000+ pages, raw HTML and rendered DOM, mobile and desktop user agents | Yes | Built in. Set your start URL and crawl limits in the config. |
| CrUX API | Field LCP, INP, CLS, TTFB per URL and origin | No | In the same Google Cloud project, enable the Chrome UX Report API and create an API key. Free. |
| PageSpeed Insights | Lab data for pages too low-traffic for CrUX | No | Enable the PageSpeed Insights API in Google Cloud and create an API key (the CrUX key can be reused). Free. |
| Server logs | Googlebot, Bingbot and AI-bot hits per URL (file import, parsed locally) | No | Download access logs from your host's control panel, your server's log folder, or your CDN's log export. Ask your developer or host if you don't have access. |
| GA4 | Conversions and revenue per landing page | No | Enable the Google Analytics Data API in Google Cloud. Add the service account as a Viewer under GA4 Admin → Property access management, and copy your property ID. |
| Bing Webmaster Tools | Bing clicks, index status, crawl errors; IndexNow submission | No | Verify your site in Bing Webmaster Tools, then generate an API key under Settings → API access. For IndexNow, generate a key and host its key file at your site root. |
| DataForSEO | Keyword volumes, competitors, SERP features, AI Overview presence, content gaps | No | Sign up at dataforseo.com and copy your API login and password from the dashboard. Paid, pay-as-you-go. |
| Majestic | Trust Flow, backlinks, link prospects | No | Requires a Majestic plan that includes API access. Copy the API key from your Majestic account. Paid. |
| Google update feed | Dated core and spam updates for chart annotations | No | Pulled automatically from Google's Search Status Dashboard. No key needed. |
| Deploy hooks | Release dates from Git tags, CI or a manual log | No | Point the config at your Git repo or add a webhook to your CI pipeline. Or log releases by hand in the dashboard. |
| User notes | Free-text annotations on any date | No | Add them in the dashboard or through Claude. |

The console reports the share of clicks hidden by Search Console's anonymised queries. That keeps users from over-reading query-level findings.

## Provider matrix

Market data and link data come through provider adapters, so users connect whichever vendor they already pay for. Each check declares the capability it needs, and the config maps a provider to each capability.

| Provider | Keyword volume | Competitors and gaps | Live SERP and features | AI search visibility | Backlinks | Authority metric | API access |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DataForSEO | Yes | Yes | Yes | Yes | Yes | Own rank score | Pay-as-you-go; backlinks need a monthly minimum |
| SE Ranking | Yes | Yes | Yes | Yes | Yes | Domain Trust | Paid add-on or standalone Data API |
| Ahrefs | Yes | Yes | Yes | Partial (Brand Radar) | Yes | Domain Rating | Higher tiers or Enterprise only |
| Semrush | Yes | Yes | Yes | Partial | Yes | Authority Score | Higher tiers, paid in API units |
| Serpstat | Yes | Yes | Yes | No | Yes | Serpstat Page Rank | Included in paid plans |
| SISTRIX | Yes | Yes | Yes | Partial | Yes | Visibility Index | Paid plans, credit-based |
| Moz | Yes | Partial | Partial | No | Yes | Domain Authority | Separate paid API plans |
| Majestic | No | No | No | No | Yes (deepest history) | Trust Flow, Citation Flow | Paid plan with API units |
| SerpApi / Serper | No | No | Yes | Partial (AI Overview capture) | No | None | Pay per search |
| Bing Webmaster Tools | Yes (Bing) | No | No | No | Own site only | None | Free |
| Google Ads API | Ranges unless spending | No | No | No | No | None | Free with an Ads account |
| Search Console | Own impressions only | No | No | No | No (no links API) | None | Free |
| Open PageRank | No | No | No | No | No | Open PageRank score | Free |

**Free tier.** Bing Webmaster Tools, Google Ads API, Search Console and Open PageRank together let the console run with zero paid keys. Checks that need a missing capability are skipped and listed as "needs a provider" rather than failing.

**Authority metrics.** Trust Flow, Domain Rating, Domain Authority and the rest use different scales. The console labels every authority figure with its source and never compares figures from different providers.

This matrix is approximate. Coverage and API terms change often, so verify each row against the vendor's API docs before release.

## Audit model and ranking

Findings are ranked by value at stake per hour of effort, with a severity floor that keeps site-breaking issues on top regardless of the maths.

```latex
\text{Priority} = \frac{\text{value at stake} \times \text{expected yield} \times \text{certainty}}{\text{effort hours}}
```

- **Value at stake** is clicks by default. With GA4 connected, it becomes conversions or revenue per landing page, so a pricing page outranks ten blog posts.
- **Expected yield** starts from defaults per check type. The fix verification loop then recalibrates it from the user's own before/after results.
- **Certainty** is high for deterministic checks and lower for judgement checks. It is also discounted when the anonymised-query share is high.
- **Effort hours** are editable per finding, so teams can reflect their own stack.

**Severity floor.** A short list of critical findings always sits above ranked findings: site-wide noindex, robots.txt blocking the site, a canonical pointing every page to one URL, an expired certificate, or a sudden indexed-page collapse.

**Check labels.** Every check carries one of two labels. Deterministic checks are rule-based and reproducible. Judgement checks (content quality, trust signals, AI readiness) show their reasoning and the data they used.

## Check catalogue

The catalogue covers 21 categories. Checks added in this revision are marked **New**.

| Category | Checks | Status |
| --- | --- | --- |
| Indexing | Noindex, canonicals, sitemaps, site-wide indexing alarm; index bloat ratio (indexed pages vs pages earning clicks) | Core + New |
| Crawl efficiency | Crawl budget waste, pages Googlebot never visits, bot hits on blocked URLs, crawl frequency by template | New (logs) |
| Crawl traps | Parameter explosion, faceted navigation, infinite calendars, session IDs, crawlable internal search | New |
| Redirects | Chains, loops, deep pages sent to homepage, temporary redirects on pages with traffic | Core |
| Host variants and soft 404s | http/https, www/apex, soft-404 handling, 404 triage with 301 map | Core |
| Search performance | CTR erosion, traffic decay, striking distance, cannibalisation, non-brand decline hidden by brand | Core |
| Content quality | Thin pages, near-duplicates (simhash), boilerplate-heavy templates, stale content | New |
| Trust signals | Author pages, visible dates, Organization and Person schema, About and contact pages | New (judgement) |
| Page experience | Field CWV, PSI lab fallback, oversized and legacy images, render-blocking and uncached assets | Core + New |
| Third-party scripts | Script weight and main-thread time by vendor, linked to INP | New |
| Mobile parity | Content, links and structured data missing from the mobile render | New |
| JavaScript rendering | Canonical, title, noindex or content changed by JS | Core |
| International | Hreflang validation, cross-host canonicals | Core |
| AI search | AI search vs training bot access, AI Overview presence, agent readiness, llms.txt, Bing and IndexNow coverage | Core + New |
| Structured data | Validation, ecommerce product pages, image and video sitemaps | Core + New |
| Social and sharing | Open Graph and social card tags | New |
| Pagination | Paginated series, rel links, deep paginated orphans | New |
| Internal linking | Orphans, link depth, link suggestions, folder-to-folder equity flow | Core |
| Security and hygiene | Mixed content, HSTS, security headers, certificate expiry, broken outbound links | New |
| Local SEO | LocalBusiness schema, NAP consistency (off by default) | New |
| Accessibility and on-page | Accessibility basics, titles, headings, meta descriptions | Core |

## Fix workflow and verification

Every finding moves through a tracked lifecycle, and the console measures whether each fix worked. This is the feature most audit tools lack.

1. **Open.** The finding is ranked and comes with drafted fix assets: 301 maps, JSON-LD, internal link suggestions, hreflang sets.
2. **Fixed.** The user marks it fixed, or the next crawl detects the change automatically. The date is logged.
3. **Verifying.** The console re-checks the page on the next crawl and starts a measurement window (default 28 days).
4. **Verified or regressed.** It compares before and after for the metric that check targets: clicks, CTR, CWV, index status or bot hits. Results are shown with a confidence note.

Verified results feed back into each check type's expected yield. Over time, the ranking reflects what actually moved the needle on that site.

## Monitoring, annotations and history

The console treats each crawl as a snapshot and reports what changed, not only what is wrong.

- **Change monitoring.** Diffs titles, H1s, canonicals, robots directives, status codes and template structure between crawls, with alerts on changes to pages with traffic.
- **Annotations.** Traffic charts show Google core and spam updates, deploys, and user notes, so a decay finding arrives with context.
- **Long-term history.** Search Console data stays in the local database after Google drops it at 16 months. This becomes a reason to keep the console running.

## Dashboard and reports

The Summary page answers "how is the site doing and what changed" in one screen.

- **Summary:** one-line verdict, health score history, index bloat ratio, what broke and what changed since the last audit, and fixes awaiting verification.
- **Findings:** the ranked list with the severity floor pinned on top, filterable by category, label and status.
- **Fix tracker:** open, fixed, verifying, verified and regressed findings with before/after charts.
- **Annotated traffic:** clicks and conversions over time with update, deploy and note markers.
- **Link graph:** internal link network and folder-to-folder equity flow.
- **Crawl and bots:** log-based crawl activity by bot and template.
- **Reports:** client-ready HTML export, with an optional "results achieved" section built from verified fixes.

Light and dark mode; works on a phone.

## MCP tools for Claude Desktop

Tools are designed around the questions users ask, not around database tables. Each returns a compact answer with links to the supporting rows.

| Tool | Answers |
| --- | --- |
| `whats_wrong` | What are the top findings right now, severity floor first? |
| `plan_sprint` | What should I fix with N hours this sprint? |
| `explain_drop` | Why did this page or folder lose traffic, with annotations and diffs? |
| `what_changed` | What changed since the last crawl or a given date? |
| `draft_fix` | Generate the 301 map, JSON-LD or link suggestions for a finding |
| `mark_fixed` | Log a fix and start verification |
| `did_it_work` | Before/after results for fixed findings |
| `bot_activity` | How are Googlebot and AI bots crawling the site? |
| `export_report` | Build the client HTML report |
| `query_data` | Read-only SQL for anything the other tools miss |

## Install, config and runtime

The console runs anywhere Node runs, and long crawls survive restarts.

- **npx** on the user's own machine for quick starts.
- **Docker** with a job runner for scheduled crawls, log imports and verification windows.
- **Claude Desktop:** add the server under Settings → Developer → Edit Config, then restart Claude.
- **Keys:** one entry per service in the config. Leave a key empty to switch that service off.
- **Logs:** point the config at a log folder or drop files in; parsing stays local.

Open questions:

- [ ] Which log formats to support at launch (Apache, Nginx, Cloudflare, CDN exports)?
- [ ] Default measurement window per check type for verification
- [ ] Starting effort-hour estimates per check
- [ ] Licence for the repo
