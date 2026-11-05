import { notFoundWithHistory } from './hosts-and-404s/404-with-history.js';
import { httpNotRedirected } from './hosts-and-404s/http-not-redirected.js';
import { serverErrors } from './hosts-and-404s/server-errors.js';
import { soft404 } from './hosts-and-404s/soft-404.js';
import { trailingSlashDuplicates } from './hosts-and-404s/trailing-slash-duplicates.js';
import { wwwApexBothResolve } from './hosts-and-404s/www-apex-both-resolve.js';
import { chain } from './redirects/chain.js';
import { deepToHomepage } from './redirects/deep-to-homepage.js';
import { internalLinksToRedirects } from './redirects/internal-links-to-redirects.js';
import { loop } from './redirects/loop.js';
import { temporaryWithTraffic } from './redirects/temporary-with-traffic.js';
import { toError } from './redirects/to-error.js';
import type { CheckDefinition } from './types.js';

/** Every check `audit` runs. Keep in step with the check table in docs/v0.1-plan.md. */
export const checks: CheckDefinition[] = [
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
