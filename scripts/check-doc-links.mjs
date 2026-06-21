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
import { readFileSync } from 'node:fs';
import { relative, dirname, resolve } from 'node:path';
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
for (const f of walk(DOCS_ROOT)) anchorsByRoute.set(fileToRoute(f), headingSlugs(readFileSync(f, 'utf8')));

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

const fmt = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
console.log(`Checked ${fmt(sources.length, 'doc')} (${fmt(idMap.size, 'doc id')}, ${fmt(routes.size, 'route')}).`);
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
