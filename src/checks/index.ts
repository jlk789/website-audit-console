import { notFoundWithHistory } from './hosts-and-404s/404-with-history.js';
import { httpNotRedirected } from './hosts-and-404s/http-not-redirected.js';
import { serverErrors } from './hosts-and-404s/server-errors.js';
import { soft404 } from './hosts-and-404s/soft-404.js';
import { trailingSlashDuplicates } from './hosts-and-404s/trailing-slash-duplicates.js';
import { wwwApexBothResolve } from './hosts-and-404s/www-apex-both-resolve.js';
import { canonicalAllToOne } from './indexing/canonical-all-to-one.js';
import { canonicalChain } from './indexing/canonical-chain.js';
import { canonicalToNon200 } from './indexing/canonical-to-non-200.js';
import { canonicalisedAwayWithClicks } from './indexing/canonicalised-away-with-clicks.js';
import { indexBloatRatio } from './indexing/index-bloat-ratio.js';
import { indexableNotInSitemap } from './indexing/indexable-not-in-sitemap.js';
import { indexedPagesCollapse } from './indexing/indexed-pages-collapse.js';
import { missingCanonical } from './indexing/missing-canonical.js';
import { noindexWithClicks } from './indexing/noindex-with-clicks.js';
import { robotsBlocksSite } from './indexing/robots-blocks-site.js';
import { sitemapNon200 } from './indexing/sitemap-non-200.js';
import { sitemapNonIndexable } from './indexing/sitemap-non-indexable.js';
import { sitemapUrlRobotsBlocked } from './indexing/sitemap-url-robots-blocked.js';
import { sitewideNoindex } from './indexing/sitewide-noindex.js';
import { chain } from './redirects/chain.js';
import { deepToHomepage } from './redirects/deep-to-homepage.js';
import { internalLinksToRedirects } from './redirects/internal-links-to-redirects.js';
import { loop } from './redirects/loop.js';
import { temporaryWithTraffic } from './redirects/temporary-with-traffic.js';
import { toError } from './redirects/to-error.js';
import type { CheckDefinition } from './types.js';

/** Every check `audit` runs. Keep in step with the check table in docs/v0.1-plan.md. */
export const checks: CheckDefinition[] = [
  // Indexing: severity floor
  sitewideNoindex,
  robotsBlocksSite,
  canonicalAllToOne,
  indexedPagesCollapse,
  // Indexing
  noindexWithClicks,
  canonicalToNon200,
  canonicalisedAwayWithClicks,
  canonicalChain,
  missingCanonical,
  sitemapNon200,
  sitemapNonIndexable,
  indexableNotInSitemap,
  sitemapUrlRobotsBlocked,
  indexBloatRatio,
  // Redirects
  chain,
  loop,
  deepToHomepage,
  temporaryWithTraffic,
  internalLinksToRedirects,
  toError,
  // Hosts and 404s
  httpNotRedirected,
  wwwApexBothResolve,
  trailingSlashDuplicates,
  notFoundWithHistory,
  soft404,
  serverErrors,
];
