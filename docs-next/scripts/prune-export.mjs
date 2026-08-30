// Prunes the static export of RSC payloads nothing ever asks for.
//
// Runs as docs-next's `postbuild`, so it is part of the build rather than a step
// somebody has to remember to add: every place that builds this export —
// .github/workflows/docs.yml (deploy), ci.yml (per-push gate), publish.yml
// (release gate), and `npm run build` on a laptop — gets the same pruned tree,
// and therefore the same numbers out of `npm run check:site-budget`.
//
// WHAT IT REMOVES. Next writes one `__next._full.txt` per exported route,
// byte-identical to that route's `index.txt`. It is the whole page's RSC payload
// under the segment-cache name `/_full` (see collect-segment-data.js in next/dist:
// "Also output the entire full page data response"). In a STATIC EXPORT nothing
// requests it. Measured on this export at 9.81.0: 676 files, 151.87 MB — a fifth
// of the whole site, and the entirety of check-site-budget.mjs's
// duplicateRscBytes.
//
// WHY IT IS SAFE HERE — three independent lines, each re-checked before the first
// deletion, none of them "the docs say so":
//
//   1. Driven in a real browser. The export was served under its GitHub-Pages base
//      path and exercised: initial load of /docs/, three client-side navigations,
//      every sidebar link hovered so the router prefetched. 175 requests, 107 of
//      them .txt. `__next._full.txt` was fetched ZERO times; `index.txt` once (the
//      router's full-page fallback when the segment cache lacks the target route);
//      the other 106 were the six segment files the router does use —
//      __next._tree.txt, __next._head.txt, __next._index.txt, __next.docs.txt,
//      __next.docs.$oc$slug.txt, __next.docs.$oc$slug.__PAGE__.txt. Those STAY.
//   2. The router chunk agrees. It builds `index.txt` explicitly (appends
//      "index.txt" to a trailing-slash pathname, ".txt" otherwise) and knows the
//      segment keys "/_tree", "/_head", "/_index" and PAGE_SEGMENT_KEY. The string
//      `_full` occurs in no router chunk at all — its only appearances anywhere in
//      _next/ are inside syntax-highlighting grammars (`clearflag_full` in PHP's
//      imap list, `create_full_put_path` in nginx, `default_fulltext_language` in
//      T-SQL). Server-side, `/_full` has exactly two consumers, both of which
//      inject a runtime `<script>fetch(...)</script>` from a RUNNING Next server
//      (client-resume for fallback routes, and the dev-only instant-test shell).
//      A static export has no server to inject either one.
//   3. No HTML in the export references `_full.txt`. Zero files, zero matches.
//
// THE RISK, stated plainly. This is a claim about Next 16.2.9's client, not a
// contract. A future Next could start requesting `/_full` from the client — that
// is what the segment name is FOR — and an upgrade would land it silently, because
// nothing in the export declares the dependency. The failure mode is soft: the
// fetch 404s, the router cannot satisfy the navigation from prefetched data, and
// it falls back to `mpaNavigation` — a full page load. Slower, a white flash, lost
// scroll position. Nothing 500s, nothing renders wrong, no page becomes
// unreachable. That softness is the danger: it degrades quietly.
//
// HOW YOU WOULD KNOW IT HAD HAPPENED. Any one of these:
//   - On the published site, DevTools → Network shows 404s for
//     `<route>/__next._full.txt` while clicking between docs pages.
//   - A click between two docs pages reloads the document. Machine-checkable:
//     `performance.getEntriesByType('navigation').length` should stay at 1 across
//     any number of in-site clicks. If it climbs, the router went MPA.
//   - This script's own log stops saying what it used to. A Next upgrade that
//     changes the shape shows up as a different pair count, or as the
//     "not byte-identical" warning below — which keeps the file rather than
//     guessing.
//   - `duplicateRscBytes` in check-site-budget.mjs goes non-zero again. That
//     metric is deliberately kept live at a measured zero: it is what notices if
//     these payloads come back, or if this step stops running.
//
// TO REVERT: `DOCS_KEEP_FULL_RSC=1 npm run build`, or drop the `postbuild` hook in
// package.json. The next build re-emits every file — nothing here is destructive
// to the repo, only to `out/`, which is generated.

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const DUPLICATE_OF = 'index.txt';
const PRUNED_BASENAME = '__next._full.txt';

const outputRoot = path.resolve(process.argv[2] ?? 'out');

function formatBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, files);
    else if (entry.isFile() && entry.name === PRUNED_BASENAME) files.push(file);
  }
  return files;
}

// `next build` only writes out/ when EXPORT=true, so a plain build has nothing to
// prune. Not an error — say so and leave.
if (!existsSync(outputRoot)) {
  console.log(`No static export at ${outputRoot} — nothing to prune.`);
  process.exit(0);
}

if (process.env.DOCS_KEEP_FULL_RSC === '1') {
  console.log(`DOCS_KEEP_FULL_RSC=1 — keeping every ${PRUNED_BASENAME}; the export ships as Next wrote it.`);
  process.exit(0);
}

const candidates = walk(outputRoot);
let prunedFiles = 0;
let prunedBytes = 0;
const kept = [];

for (const file of candidates) {
  const sibling = path.join(path.dirname(file), DUPLICATE_OF);
  // Only ever delete a PROVEN duplicate — the same predicate check-site-budget.mjs
  // uses for duplicateRscBytes, so the two can never disagree about what is dead.
  // Anything that fails it is a shape change worth a human look, so it survives.
  if (!existsSync(sibling) || !readFileSync(file).equals(readFileSync(sibling))) {
    kept.push(path.relative(outputRoot, file));
    continue;
  }
  prunedBytes += statSync(file).size;
  rmSync(file);
  prunedFiles += 1;
}

console.log(
  `Pruned ${prunedFiles.toLocaleString()} ${PRUNED_BASENAME} file${prunedFiles === 1 ? '' : 's'} ` +
    `(${formatBytes(prunedBytes)}) from ${outputRoot}`,
);

if (kept.length > 0) {
  console.warn(
    `\n  ${kept.length} ${PRUNED_BASENAME} file${kept.length === 1 ? '' : 's'} were NOT byte-identical to their ` +
      `${DUPLICATE_OF} sibling and were KEPT.\n  Next may have changed what this payload is. Re-check the three ` +
      `lines of evidence at the top of this file before assuming it is still dead weight:\n` +
      kept.slice(0, 10).map((file) => `    ${file}`).join('\n') +
      (kept.length > 10 ? `\n    … and ${kept.length - 10} more` : ''),
  );
}
