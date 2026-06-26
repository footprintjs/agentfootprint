/**
 * Single source of truth for site-wide SEO constants — consumed by the root metadata,
 * sitemap, robots, OG image, JSON-LD, and per-page canonical tags.
 *
 * `url` is the FULL deployed origin INCLUDING the GitHub-Pages project base path, so
 * absolute links built as `SITE.url + path` are correct regardless of Next's basePath
 * handling. Keep this in sync with next.config `basePath` at deploy.
 */
export const SITE = {
  url: 'https://footprintjs.github.io/agentfootprint',
  name: 'agentfootprint',
  title: 'agentfootprint — the explainable AI-agent framework',
  tagline: 'Inject less. Trace more.',
  description:
    'agentfootprint is the explainable agent framework for TypeScript. Every run records its own causal trace, so when your AI agent answers wrong you backtrack to the exact context that caused it — and prove the fix by re-running without it. Built on footprintjs.',
  author: 'Sanjay', // display byline ("Created by Sanjay")
  authorName: 'Sanjay Krishna Anbalagan', // full legal name — copyright line + schema (matches LICENSE + npm author)
  authorUrl: 'https://github.com/sanjay1909', // primary profile — footer rel=author link + JSON-LD Person.url
  // every profile that is verifiably the SAME person — JSON-LD Person.sameAs. This is the signal
  // search engines use to reconcile "Sanjay Krishna Anbalagan" into one entity = creator.
  authorSameAs: [
    'https://github.com/sanjay1909',
    'https://www.linkedin.com/in/sanjay-krishna-anbalagan/',
    'https://x.com/1909sanjay',
    'https://sanjay1909.github.io/',
  ],
  publisher: 'footprintjs',
  repo: 'https://github.com/footprintjs/agentfootprint',
  license: 'https://github.com/footprintjs/agentfootprint/blob/main/LICENSE',
  org: 'https://github.com/footprintjs',
  core: 'https://github.com/footprintjs/footPrint', // the footprintjs library repo (note the capital P — footprintjs/footprintjs 404s)
  npm: 'https://www.npmjs.com/package/agentfootprint',
  keywords: [
    'agentfootprint',
    'footprintjs',
    'AI agent framework',
    'LLM agent framework',
    'TypeScript agent framework',
    'explainable AI agents',
    'agent observability',
    'agent debugging',
    'context engineering',
    'ReAct agent',
    'LLM tracing',
    'causal trace',
    'agent context bug',
    'why did my agent answer wrong',
    'Sanjay agentfootprint',
  ],
} as const;

/** Build an absolute site URL from a root-relative path (`/docs/...`). */
export const abs = (path: string) => `${SITE.url}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Deploy base path (GitHub-Pages project sub-path). Empty in local dev. Set via
 * NEXT_PUBLIC_BASE_PATH at the static-export build. Next prepends basePath to
 * <Link>/<Image>, but NOT to raw <img src> or client `fetch()` — so use `asset()`
 * for public/ assets and prefix any hand-built fetch URL (e.g. the static search index).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const asset = (path: string) => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
