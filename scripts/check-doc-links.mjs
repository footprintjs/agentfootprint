/**
 * Internal-link checker for the Fumadocs site (docs-next/content/docs).
 *
 * ANTI-STALE CONTRACT: every internal reference in a hand-written doc must resolve, and
 * every "#anchor" must point at a real heading. A moved page or a reworded heading
 * therefore CANNOT leave a dead link behind — `npm run check:links` fails CI first.
 *
 * Internal links come in two forms:
 *   • doc:<id>[#anchor]  — the PREFERRED, taxonomy-proof form (resolved by the build via
 *                          lib/remark-doc-links.mjs). Checked against the doc-id index.
 *   • /docs/...[#anchor] — a real path (e.g. linking into the auto-generated /api tree).
 *                          Checked against the route set.
 * Legacy/relative forms (../guides/x, /agentfootprint/x) are reported as broken — they
 * should have been converted to doc:<id>.
 *
 * Scope: hand-written .mdx (the auto-generated /api tree is a valid TARGET but not scanned
 * as a SOURCE — gen-fumadocs-api.mjs owns its links).
 *
 * Usage:  node scripts/check-doc-links.mjs [--strict]
 *   exit 0 = clean · exit 1 = broken links (always) or broken anchors (--strict)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(new URL(import.meta.url).pathname);
const DOC_IDS = pathToFileURL(resolve(HERE, '..', 'docs-next', 'lib', 'doc-ids.mjs')).href;
const { buildIdMap, buildRouteSet, walk, fileToRoute, headingSlugs, DOCS_ROOT, BASE_URL } =
  await import(DOC_IDS);

const STRICT = process.argv.includes('--strict');
const APP_ROUTES = new Set(['/', BASE_URL]); // legit non-doc-page targets (homepage etc.)

const idMap = buildIdMap();
const routes = buildRouteSet();
const sources = walk(DOCS_ROOT).filter(
  (f) => !relative(DOCS_ROOT, f).replace(/\\/g, '/').startsWith('api/'),
);
const anchorsByRoute = new Map(); // real-path anchor lookups
for (const f of walk(DOCS_ROOT))
  anchorsByRoute.set(fileToRoute(f), headingSlugs(readFileSync(f, 'utf8')));

const LINK_RE = /\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const brokenPaths = [];
const brokenAnchors = [];

for (const file of sources) {
  const content = readFileSync(file, 'utf8');
  const selfRoute = fileToRoute(file);
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(lines[i]))) {
      const raw = m[1];
      if (/^(https?:|mailto:|tel:|data:)/i.test(raw)) continue;
      if (/\.(png|svg|jpe?g|webp|gif|ico|pdf|mp4)$/i.test(raw)) continue;
      const where = `${relative(DOCS_ROOT, file)}:${i + 1}`;
      const [pathPart, anchor] = raw.split('#');

      let route, anchorSet;
      if (raw.startsWith('doc:')) {
        const id = pathPart.slice('doc:'.length);
        const entry = idMap.get(id);
        if (!entry) {
          brokenPaths.push({ where, raw, note: `unknown doc id "${id}"` });
          continue;
        }
        route = entry.route;
        anchorSet = entry.anchors;
      } else if (pathPart === '' || pathPart === undefined) {
        route = selfRoute; // pure "#anchor"
        anchorSet = anchorsByRoute.get(selfRoute);
      } else if (pathPart.startsWith('/')) {
        route = pathPart.replace(/\/$/, '') || '/';
        if (!routes.has(route) && !APP_ROUTES.has(route)) {
          brokenPaths.push({ where, raw, note: `no page at ${route}` });
          continue;
        }
        anchorSet = anchorsByRoute.get(route);
      } else {
        brokenPaths.push({ where, raw, note: 'relative/legacy link — convert to doc:<id>' });
        continue;
      }

      if (anchor && anchorSet && !anchorSet.has(anchor)) {
        brokenAnchors.push({ where, raw, note: `no #${anchor} on ${route}` });
      }
    }
  }
}

// Marketing TSX links bypass the MDX resolver, but they still point into the same docs route set.
// Scan the home/features/walkthrough sources so a moved guide cannot silently break a homepage CTA.
const MARKETING_ROOTS = [
  resolve(HERE, '..', 'docs-next', 'app', '(home)'),
  resolve(HERE, '..', 'docs-next', 'components', 'home'),
];
const SITE_HEADER = resolve(HERE, '..', 'docs-next', 'components', 'SiteHeader.tsx');
const marketingSources = [SITE_HEADER];
const walkTsx = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTsx(full);
    else if (name.endsWith('.tsx')) marketingSources.push(full);
  }
};
for (const root of MARKETING_ROOTS) walkTsx(root);

const DOC_LITERAL_RE = /(?:href|link)\s*[:=]\s*['"](\/docs[^'"\s]*)['"]/g;
let marketingLinks = 0;
for (const file of marketingSources) {
  const content = readFileSync(file, 'utf8');
  DOC_LITERAL_RE.lastIndex = 0;
  let match;
  while ((match = DOC_LITERAL_RE.exec(content))) {
    marketingLinks++;
    const raw = match[1];
    const [pathPart, anchor] = raw.split('#');
    const route = pathPart.replace(/\/$/, '') || '/';
    const line = content.slice(0, match.index).split('\n').length;
    const where = `${relative(resolve(HERE, '..'), file)}:${line}`;
    if (!routes.has(route)) {
      brokenPaths.push({ where, raw, note: `no page at ${route}` });
      continue;
    }
    const anchorSet = anchorsByRoute.get(route);
    if (anchor && anchorSet && !anchorSet.has(anchor)) {
      brokenAnchors.push({ where, raw, note: `no #${anchor} on ${route}` });
    }
  }
}

// ---------------------------------------------------------------------------
// README front-door gate. The repo-root README links into the LIVE docs site by
// ABSOLUTE URL (https://footprintjs.github.io/agentfootprint/<route>) — outside
// the doc:<id> resolver, so a taxonomy move silently 404s the project's front
// page (exactly the Starlight→Fumadocs regression this guards against). Re-derive
// the same route set and fail on any doc-site URL whose path is not a real page.
// Only the agentfootprint DOC SITE is checked; sibling github.io sites (footPrint,
// agentThinkingUI, the org root) and `agentfootprint-lens` are other repos — the
// mandatory `/agentfootprint/` boundary in the regex skips them.
const README = resolve(HERE, '..', 'README.md');
const README_LINK_RE = /https:\/\/footprintjs\.github\.io\/agentfootprint\/([^\s)"'<>]*)/g;
let readmeLinks = 0;
try {
  const readmeLines = readFileSync(README, 'utf8').split('\n');
  for (let i = 0; i < readmeLines.length; i++) {
    README_LINK_RE.lastIndex = 0;
    let m;
    while ((m = README_LINK_RE.exec(readmeLines[i]))) {
      readmeLinks++;
      const where = `README.md:${i + 1}`;
      const [pathPart, anchor] = m[1].split('#');
      const route = '/' + pathPart.replace(/\/$/, ''); // strip trailing slash; '' -> site root '/'
      if (!routes.has(route) && !APP_ROUTES.has(route)) {
        brokenPaths.push({ where, raw: m[0], note: `no page at ${route}` });
        continue;
      }
      const anchorSet = anchorsByRoute.get(route);
      if (anchor && anchorSet && !anchorSet.has(anchor)) {
        brokenAnchors.push({ where, raw: m[0], note: `no #${anchor} on ${route}` });
      }
    }
  }
} catch (err) {
  brokenPaths.push({
    where: 'README.md',
    raw: README,
    note: `could not read README (${err.code ?? err.message})`,
  });
}

const fmt = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
console.log(
  `Checked ${fmt(sources.length, 'doc')} (${fmt(idMap.size, 'doc id')}, ${fmt(
    routes.size,
    'route',
  )}).`,
);
console.log(`Checked ${fmt(readmeLinks, 'README doc-site link')} against the live route set.`);
console.log(`Checked ${fmt(marketingLinks, 'marketing doc link')} against the live route set.`);
if (brokenPaths.length) {
  console.error(`\n✗ ${fmt(brokenPaths.length, 'broken link')}:`);
  for (const b of brokenPaths) console.error(`  ${b.where}  ${b.raw}   [${b.note}]`);
}
if (brokenAnchors.length) {
  console.error(`\n${STRICT ? '✗' : '⚠'} ${fmt(brokenAnchors.length, 'broken anchor')}:`);
  for (const b of brokenAnchors) console.error(`  ${b.where}  ${b.raw}   [${b.note}]`);
}
if (!brokenPaths.length && !brokenAnchors.length) console.log('✓ all internal links resolve.');

process.exit(brokenPaths.length > 0 || (STRICT && brokenAnchors.length > 0) ? 1 : 0);
