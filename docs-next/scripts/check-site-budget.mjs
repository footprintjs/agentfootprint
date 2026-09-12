import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const outputRoot = path.resolve(process.argv[2] ?? 'out');
const projectRoot = path.resolve(import.meta.dirname, '..');
const failures = [];
const routeInitialAssets = new Map();

const ROUTES = [
  {
    name: 'home',
    file: 'index.html',
    limits: { js: 235_000, css: 34_000, html: 30_000, requests: 20 },
    imagePreloads: { count: 2, bytes: 50_000 },
  },
  {
    name: 'features',
    file: 'features/index.html',
    limits: { js: 225_000, css: 25_000, html: 45_000, requests: 21 },
  },
  {
    name: 'docs',
    file: 'docs/index.html',
    limits: { js: 235_000, css: 20_000, html: 50_000, requests: 22 },
  },
  {
    name: 'skills guide',
    file: 'docs/build/skills-explained/index.html',
    limits: { js: 240_000, css: 20_000, html: 80_000, requests: 24 },
  },
];

const SEARCH_LIMITS = { raw: 12_000_000, gzip: 2_000_000, records: 2_000 };
// Raised for 9.57.0. The generated API reference had been three releases
// stale (the 9.53.0 semantics surface was never regenerated), so this
// release's regeneration added 25 pages at once and the export crossed both
// ceilings — 6,514 files and 127.13 MB of duplicate sibling RSC payloads.
// The ceiling is a RATCHET against growth nobody noticed, and this growth is
// API pages the generator already owed; raising it is the honest response,
// reverting to a lying API reference is not. Headroom is deliberately thin
// so the next unnoticed jump still trips it.
// Raised for 9.74.0 — and the RATCHET WORKED, but nobody was watching it.
// The 132 MB ceiling was first crossed on 2026-08-26 (132.68 MB), which means
// the docs site stopped deploying two days and three releases before anyone
// noticed: 9.72.0 and 9.73.0 both shipped to npm while the published site sat
// stale, because this job fails independently of the publish job and its red
// was nobody's notification. The measured history, from the CI logs:
//   2026-08-26  132.68 MB  first crossing — site goes stale from here
//   9.72.0      133.73 MB
//   9.73.0      133.73 MB
//   9.74.0      133.97 MB  (+0.24 MB — the Foundry/Azure doc pages)
// So 1.73 MB of the overage predates this release and 0.24 MB is its own.
// The growth is real prose on real pages, amplified the way this metric always
// amplifies: every route's RSC payload re-embeds the shared nav/ToC tree, so a
// few KB of new headings is multiplied across 627 sibling pairs.
// Raising it is the honest response — a stale published site is a worse lie
// than a bigger export — but a ceiling that goes red unwatched is only half a
// ratchet, so the real follow-up is making this job's failure visible.
// Raised for 9.78.0 — the SAME failure, a second time, exactly as the block
// above predicted. That follow-up ("making this job's failure visible") was
// never built, so nothing watched the ratchet again: on 9.76.0 all FOUR
// ceilings in this file crossed at once, and the published site then sat stale
// through 9.76.1, 9.77.0 and 9.78.0 while every npm publish went green, because
// Deploy Docs fails independently of Publish to npm. Measured, from the CI logs
// of the Deploy Docs runs themselves:
//   9.75.0   2026-08-28 14:47   672.11 MB   6,684 files   134.02 MB dup   403.7 KB demo   GREEN
//   9.76.0   2026-08-28 16:32   724.51 MB   6,994 files   144.99 MB dup   405.1 KB demo   <- all four cross
//   9.76.1   2026-08-28 17:38   724.52 MB   6,994 files   145.00 MB dup   405.1 KB demo
//   9.77.0   2026-08-30 04:47   730.04 MB   7,024 files   146.20 MB dup   406.0 KB demo
//   9.78.0   2026-08-30 06:29   749.05 MB   7,134 files   150.29 MB dup   408.9 KB demo
// 9.76.0 is +52.40 MB and +310 files by itself. A docs route is 9 files, so
// that is ~34 new routes — the runbook-as-tool family: one hand-written page
// plus the API-reference pages the generator derives from the new exports in
// dist/ at build time. And a docs route costs ~1.07 MB of export on its own:
// index.html (avg 427 KB) + index.txt + __next._full.txt (223 KB each, and
// byte-identical to each other) + the /docs layout segment, which is a
// byte-identical 165 KB copy of the shared nav tree written into EVERY route
// directory. That is the amplification this metric always shows: a new page
// pays ~1 MB for itself, and again a little inside every other page's embedded
// nav. The remaining three releases are the ordinary version of the same thing.
// Raising is the honest response — a stale published site is a worse lie than a
// bigger export — and the headroom stays deliberately thin (~2%, roughly one
// release of growth at the rate above), so the next unnoticed jump still trips
// it. What is different this time is that the jump can no longer go unnoticed:
// .github/workflows/publish.yml runs this exact check inside the job the npm
// publish `needs:`, so a red budget now blocks a release, and ci.yml's docs job
// runs it on every push and PR so the red lands in the check people already
// read. Those two workflow comments state precisely what that does and does not
// guarantee. Whether to keep raising or to shrink the export is still open —
// the 261.85 MB of exact-duplicate content this export contains (35.1% of it,
// 110.40 MB of which is that one 165 KB layout segment, repeated 669 times) is
// where any trim starts.
//
// LOWERED for 9.81.0 — the first entry in this block that goes DOWN, because the
// trim the paragraph above was waiting for happened. It started where that
// paragraph said to start: with the duplicates. Next writes a
// `__next._full.txt` beside every route's `index.txt`, byte-identical to it —
// the whole-page RSC payload under the segment-cache name `/_full` — and in a
// STATIC EXPORT nothing ever fetches it. docs-next/scripts/prune-export.mjs
// deletes it as the build's `postbuild` step, so every path that builds this
// export (docs.yml, ci.yml, publish.yml, a laptop) ships and measures the same
// pruned tree. That script carries the three independent lines of evidence, the
// risk of a future Next changing its mind, and the symptom that would show it
// had. Read it before changing anything here.
//
// Measured on this commit, same build, immediately before and after that step:
//                       before        after
//   export bytes        756.31 MB     604.44 MB   (-151.87 MB, -20.1%)
//   export files        7,174         6,498       (-676)
//   duplicateRscBytes   151.87 MB     0 B         (676 pairs -> 0)
//   demo async gzip     408.9 KB      408.9 KB    (unchanged, and see below)
//
// The ceilings come down with it, because headroom the prune buys is not
// headroom to spend. Leaving 765 MB standing over a 604 MB export would have
// bought 160 MB of silence — three 9.76.0-sized releases — and this file's whole
// history is about growth that nobody was watching. The new numbers keep the
// same deliberately thin ~2% the raises used, which at today's per-route cost
// (~0.85 MB and 8 files, down from ~1.07 MB and 9) is about fourteen new docs
// routes before somebody has to look again.
//
// duplicateRscBytes STAYS a live check, at a measured zero, on purpose. A metric
// that reaches zero and is then deleted cannot tell you when it comes back. Two
// things make it non-zero again and both deserve a stop: the prune stopped
// running (a dropped `postbuild`, or someone building with `npx next build`
// instead of `npm run build`), or Next changed what it writes and the pruner's
// byte-identity test no longer matches it. First case, run
// `npm run prune:export`; second case, re-read the evidence at the top of
// prune-export.mjs before assuming anything is still safe to delete.
// Raised for 9.87.1: export 615.74 MB / 6,581 files / 911 search records at the
// last green publish (9.86.1) -> 621.21 MB / 6,617 files / 917 records on the
// 9.87.0 release commit, which failed this gate and therefore never reached
// npm. The growth is six new routes — the time-travel guide
// (docs/debug/time-travel.mdx) and the API routes for milestoneStops,
// milestoneStopsStrategy, milestoneOf and their types — at ~0.91 MB and 6
// files per route, which is the per-route cost the paragraph above measured.
// The old ceilings had 1.26 MB and 3 files of headroom left: the ~2% margin
// had been spent one route at a time across 9.86.x with nobody re-reading this
// comment. Same rule as every raise here: ~2% over the measured export, so
// about fourteen more routes before somebody has to look again — and the
// thing to look at then is the per-route cost, not the ceiling.
//
// Raised for 9.88.0: measured export 658.46 MB / 6,851 files on this release
// commit, up from the 634.00 MB / 6,750 file ceiling above — which itself had
// no headroom left for this release's growth. The growth is 29 new API doc
// routes for the receipt-at-the-stop exports — epochAt, epochLocations,
// keyedFold, messageDigestInput, receiptAt, receiptHash, servedAt,
// servedViews, and milestoneOf/milestoneStops/milestoneStopsStrategy (the
// 9.87.0 exports whose API pages had never actually been generated until this
// build caught them up) — plus their eleven interface/type-alias/variable
// pages, at the same ~0.91 MB and 6 files per route this file has measured
// since 9.87.1. Same rule as every raise here: ~2% over the measured export,
// so roughly fourteen more routes before somebody has to look again — and the
// thing to look at then is still the per-route cost, not the ceiling.
const OUTPUT_LIMITS = { bytes: 672_000_000, files: 6_990, duplicateRscBytes: 0 };
// Raised for 9.61.0: 394.1 KB → 400.3 KB. The skill-graph demo imports
// `defineTool` from 'agentfootprint', so the library's MAIN ENTRY and its
// whole transitive graph ride this chunk — and this release added the
// Context Integrity family (five checks, the assertion algebra, the
// disposition ledger) to that graph. The growth is real library surface,
// not chunking noise: the payload is the same 16 async assets, each a
// little heavier.
//
// Worth stating plainly, because the number is the evidence: the integrity
// family is NOT tree-shaken out for a browser consumer who enables none of
// it. `zero-delta` is a promise about what a run DOES, never about what a
// bundle WEIGHS, and these are different axes. Making the checks reachable
// only through a dynamic import is the fix if this keeps climbing.
//
// Headroom stays deliberately thin (the ratchet's whole point), so the next
// unnoticed jump still trips it.
//
// Raised for 9.78.0: 403.7 KB → 408.9 KB measured, still across the same 16
// async assets, so this is the 9.61.0 story repeating rather than a chunking
// change — three more families landed in the main entry's transitive graph
// (9.76.0 runbookAsTool, 9.77.0 and 9.78.0 the integrity rows) and the demo
// imports `defineTool` from 'agentfootprint', so it carries them:
//   9.75.0  403.7 KB  GREEN      9.76.0  405.1 KB  <- crosses, by 0.1 KB
//   9.76.1  405.1 KB             9.77.0  406.0 KB
//   9.78.0  408.9 KB
// Crossing by 0.1 KB blocked the deploy for four days just as thoroughly as
// crossing by 50 MB would have — a gate nobody watches fails the same whether
// it misses by a hair or a mile, which is the argument for the publish-path
// gate now wired in .github/workflows/publish.yml. The fix named in 9.61.0
// (reach the checks only through a dynamic import) is still the fix if this
// keeps climbing.
//
// NOT lowered for 9.81.0, unlike the three above it. The export prune deletes
// whole .txt payloads and touches no chunk, so this measured 408.9 KB before it
// and 408.9 KB after — same 16 async assets, same bytes. The ceiling is already
// ~1% over that, which is as tight as the others now are; moving it would be
// pretending the prune bought headroom here that it did not.
//
// Raised for 9.88.0: 408.9 KB -> 416.4 KB measured, still the same 16 async
// assets. The demo imports `defineTool` from 'agentfootprint', so the receipt
// family (composeRequest, epochs, keyedFold, receipt, servedView) rides the
// main entry's transitive graph the same way the 9.61.0/9.78.0 families did —
// this is that story again, not a chunking change. Fix, if this keeps
// climbing, is still the one named in 9.61.0: reach the checks only through a
// dynamic import.
//
// Raised for 9.92.1: 416.4 KB -> 421.0 KB measured (the 9.92.0 publish failed
// this gate by 0.4 KB, exactly the 9.87.0 shape). 9.92.0's tool-resolution
// family (toolClaimants, mergeWire, resolveTool, the two events) rides the same
// main-entry graph as the receipt family because the demo imports
// `defineTool`. Set ~2% over the measurement, as the others are. This is the
// FOURTH time this ceiling has moved for a library family the demo never calls;
// the dynamic-import fix from 9.61.0 is now overdue, and the next raise should
// be that fix instead.
//
// LOWERED for 9.94.0 — the fix the four paragraphs above kept naming, and one
// they could not have named. Measured on this commit, same build:
//   before  421.3 KB  16 async assets   library chunk 199.6 KB
//   after   382.4 KB  15 async assets   library chunk 171.4 KB
// Two root causes, both in the library, so every browser consumer gets the same
// cut (a plain `import { Agent, defineTool }`: 219.3 KB -> 199.7 KB gzip):
//   1. `.selfExplain()`'s trace toolpack — 47 KB minified, the largest module in
//      the package — was on the DEFAULT graph: `AgentBuilder` imported it for a
//      list of eleven names it reserves at build. It is now reached through an
//      `import()` on the first iteration the skill is active (`selfExplain.ts` ·
//      `lazilyMountedTraceTools`), and the names live in a module of their own.
//   2. `sideEffects` NEVER REACHED THE ESM BUILD. A bundler reads that flag from
//      the closest package.json, and `dist/esm/package.json` was a bare
//      `{"type":"module"}` — so every module under dist/esm was presumed to run
//      something at load, kept whenever a barrel named it, and a dynamic
//      `import()` of a module a barrel also re-exports (the toolpack, through
//      the `/observe` door the lens imports) landed in the parent chunk instead
//      of its own. scripts/postbuild-esm.mjs now carries the root list across,
//      rebased; the list was widened only where it is TRUE (the root entry and
//      the injection-engine barrel, each of which imports a module-level
//      registration), and test/lib/trace-toolpack/browserGraph.test.ts proves
//      at the graph that every registration still survives.
//
// THE LAW this number ratchets from here on: AN OPTIONAL FAMILY IS LOADED WHEN
// ITS OPTION IS ENABLED, NEVER BEFORE — and the demo bundle measures the
// library's DEFAULT graph, not its whole surface. A family that only exists
// behind a builder option or a tool declaration reaches the bundle through
// `import()` at the point that option is enabled, where the enabling path is
// already async (a tool provider's `list()`, a tool's `execute`, a run). The
// families this release could NOT move, and why, so the next raise is argued
// on the record and not rediscovered: the integrity checks (~5 KB gzip upper
// bound) run inside SYNCHRONOUS helpers of four stages — `callLLM.ts` ·
// `postValidate`, `route.ts` · `judgeEvidence`/`judgeClaims`, the column/lookup/
// claim helpers in `toolCalls.ts`, `buildToolsSlot.ts` — and one of them
// (`wireViolationsOf`) runs unconditionally; the observability recorders
// (~30 KB minified: BoundaryRecorder, FlowchartRecorder, the voice templates)
// sit behind `enable.flowchart()` / `enable.localObservability()`, which return
// their handle SYNCHRONOUSLY, and behind `build()`'s voice defaults. Moving
// either means a public sync path becomes async — a behaviour change, not a
// packaging one. When this number climbs again, the question is which family
// walked onto the default graph and whether its option's path is async; the
// per-module answer is `DOCS_WEBPACK_STATS=1 EXPORT=true npm run build` then
// `node scripts/demo-chunk-modules.mjs`. Ceiling ~2% over the measurement, as
// every entry above.
//
// Raised after 9.94.1 — the lens catch-up — and this is NOT the law above
// breaking: no library family walked onto the default graph. What moved is the
// pins in docs-next/package.json, which had sat at agentfootprint-lens ^0.31.1
// / footprint-explainable-ui ^0.28.0 / footprintjs ^9.10.0 since the 9.x door
// renames, twenty lens releases behind. The consequence was worse than bytes:
// the site's own demos had never shown the Served tab, the Served graph,
// Bookmarks or the tag picker (lens 0.47–0.52) — the site documented a lens it
// did not run — and every demo bundle carried TWO footprintjs engines, the
// root's 9.21.1 (the library's peer, through `agentfootprint: file:..`) and
// docs-next's own 9.10.0, because two node_modules directories are two module
// paths whatever the two versions say. Measured on this commit, same build,
// three ways (`DOCS_WEBPACK_STATS=1 EXPORT=true npm run build`, then
// `node scripts/demo-chunk-modules.mjs`, split by footprintjs path):
//   old pins                        382.4 KB  15 assets  fp 9.10.0 (76 mod) + 9.21.1 (76 mod)
//   new pins, two engines           517.8 KB  18 assets  fp 9.23.1 (18 mod) + 9.21.1 (88 mod)
//   new pins, ONE engine (shipped)  514.0 KB  18 assets  fp 9.21.1 (94 mod)
// The one-engine rule lives in next.config.mjs (`footprintjsAliases`: every
// browser request for footprintjs or one of its doors is pointed at the root's
// copy, doors read from the package's own `exports`). Its byte saving is 3.8 KB
// — 9.23.1 tree-shakes to 18 modules where 9.10.0 brought all 76 — its value is
// that a trace the library writes and the lens reads share one class, one
// symbol, one WeakMap. So +131.6 KB is the lens itself, 0.31.1 -> 0.52.1, and
// TWO lens-side defects make it that large for a demo that mounts no <Lens>:
//   1. agentfootprint-lens declares no `sideEffects`, and `SkillGraphFlow` is
//      exported ONLY from its root barrel — so this demo's one import keeps
//      every chunk of the barrel: Lens, Served, Bookmarks, time-travel.
//   2. `BugReportButton.tsx` does `import * as afObserve from
//      'agentfootprint/observe'` and hands the NAMESPACE OBJECT to a reader —
//      webpack must keep every export of `/observe`, which is how the trace
//      toolpack (155 KB pre-minify, the family the paragraph above moved off
//      the default graph), context-bisect (178 KB), af time-travel (109 KB)
//      and bug-report are back on this chunk: af's share went 1.20 MB -> 3.72 MB
//      pre-minify, all of it reached through the lens, none through the demo.
// Both are fixed in the lens, not here, and the next move of this number
// should be that fix DOWN, not another raise: a `sideEffects` flag (or a door
// that exports `SkillGraphFlow` alone) and named imports from `/observe`.
// Ceiling ~2% over the 514.0 KB measurement, as every entry above.
//
// CORRECTED the same day, before this ever shipped: the 514.0 KB above was the
// current Lens with NO sideEffects flag and a bug-report button that imported
// the whole /observe door. agentfootprint-lens 0.52.2 declared the flag (audited
// across all 196 modules, pinned by a packaging test) and opens that door on
// click. Re-measured on 0.52.2: 413.8 KB gzip across 15 async assets, ONE
// footprintjs — i.e. 31 KB ABOVE the 382.4 KB two-engine/old-Lens baseline for
// the whole Served tab, Served graph, bookmarks and tag picker the site now
// actually shows. Set ~2% over that. The three-way story: 382.4 (old Lens, two
// engines) → 514.0 (current Lens, no flag) → 413.8 (current Lens, flagged).
const DEMO_ASYNC_GZIP_LIMIT = 422_000;

function formatBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function fail(message) {
  failures.push(message);
  console.error(`  FAIL ${message}`);
}

function assertAtMost(label, value, limit) {
  if (value > limit) fail(`${label}: ${formatBytes(value)} exceeds ${formatBytes(limit)}`);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}

function resolveOutputAsset(url) {
  const pathname = decodeURIComponent(url.split(/[?#]/, 1)[0] ?? '').replace(/^\/+/, '');
  if (!pathname) return undefined;

  const candidates = [path.join(outputRoot, pathname)];
  const nextIndex = pathname.indexOf('_next/');
  if (nextIndex >= 0) candidates.push(path.join(outputRoot, pathname.slice(nextIndex)));
  const segments = pathname.split('/');
  if (segments.length > 1) candidates.push(path.join(outputRoot, ...segments.slice(1)));

  return candidates.find((candidate) => candidate.startsWith(outputRoot) && existsSync(candidate));
}

function gzipFile(file) {
  return gzipSync(readFileSync(file), { level: 9 }).byteLength;
}

function requiredOutputAsset(url, label) {
  const file = resolveOutputAsset(url);
  if (!file) fail(`${label}: cannot resolve exported asset ${url}`);
  return file;
}

function uniqueAssetBytes(urls, label, gzip = true) {
  const files = new Set(urls.map((url) => requiredOutputAsset(url, label)).filter(Boolean));
  return [...files].reduce((sum, file) => sum + (gzip ? gzipFile(file) : statSync(file).size), 0);
}

function analyzeRoute(route) {
  const htmlFile = path.join(outputRoot, route.file);
  if (!existsSync(htmlFile)) {
    fail(`${route.name}: missing ${route.file}`);
    return;
  }

  const html = readFileSync(htmlFile, 'utf8');
  const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)].map((match) => match[0]);
  const modernScripts = scriptTags.filter((tag) => !/\bnomodule\b/i.test(tag));
  const legacyScripts = scriptTags.filter((tag) => /\bnomodule\b/i.test(tag));
  const styles = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)].map((match) => match[0]);
  const imagePreloadTags = [...html.matchAll(/<link\b[^>]*\brel=["']preload["'][^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attribute(tag, 'as')?.toLowerCase() === 'image');

  const scriptUrls = modernScripts.map((tag) => attribute(tag, 'src')).filter(Boolean);
  const legacyUrls = legacyScripts.map((tag) => attribute(tag, 'src')).filter(Boolean);
  const styleUrls = styles.map((tag) => attribute(tag, 'href')).filter(Boolean);
  const jsBytes = uniqueAssetBytes(scriptUrls, `${route.name} script`);
  const legacyJsBytes = uniqueAssetBytes(legacyUrls, `${route.name} legacy script`);
  const cssBytes = uniqueAssetBytes(styleUrls, `${route.name} stylesheet`);
  const htmlBytes = gzipSync(html, { level: 9 }).byteLength;
  const criticalRequests = 1 + new Set(scriptUrls).size + new Set(styleUrls).size + imagePreloadTags.length;

  routeInitialAssets.set(
    route.name,
    new Set([...scriptUrls, ...styleUrls].map(resolveOutputAsset).filter(Boolean)),
  );

  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  if (h1Count !== 1) fail(`${route.name}: expected exactly one H1, found ${h1Count}`);

  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const missingDimensions = images.filter((tag) => !attribute(tag, 'width') || !attribute(tag, 'height'));
  if (missingDimensions.length > 0) {
    fail(`${route.name}: ${missingDimensions.length}/${images.length} images lack intrinsic width and height`);
  }

  console.log(
    `${route.name.padEnd(12)} HTML ${formatBytes(htmlBytes)}, modern JS ${formatBytes(jsBytes)}, ` +
      `CSS ${formatBytes(cssBytes)}, ${criticalRequests} critical requests` +
      (legacyJsBytes ? ` (${formatBytes(legacyJsBytes)} legacy noModule JS excluded)` : ''),
  );
  assertAtMost(`${route.name} HTML gzip`, htmlBytes, route.limits.html);
  assertAtMost(`${route.name} modern JS gzip`, jsBytes, route.limits.js);
  assertAtMost(`${route.name} CSS gzip`, cssBytes, route.limits.css);
  if (criticalRequests > route.limits.requests) {
    fail(`${route.name} critical requests: ${criticalRequests} exceeds ${route.limits.requests}`);
  }

  if (route.imagePreloads) {
    let preloadBytes = 0;
    for (const tag of imagePreloadTags) {
      const candidates = [attribute(tag, 'href')];
      const srcSet = attribute(tag, 'imagesrcset');
      if (srcSet) {
        candidates.push(...srcSet.split(',').map((candidate) => candidate.trim().split(/\s+/, 1)[0]));
      }
      const sizes = candidates
        .filter(Boolean)
        .map((url) => requiredOutputAsset(url, `${route.name} image preload`))
        .filter(Boolean)
        .map((file) => statSync(file).size);
      preloadBytes += sizes.length > 0 ? Math.max(...sizes) : 0;
    }
    console.log(`  image preloads: ${imagePreloadTags.length}, up to ${formatBytes(preloadBytes)} transferred`);
    if (imagePreloadTags.length > route.imagePreloads.count) {
      fail(`${route.name} image preloads: ${imagePreloadTags.length} exceeds ${route.imagePreloads.count}`);
    }
    assertAtMost(`${route.name} image preload bytes`, preloadBytes, route.imagePreloads.bytes);
  }
}

function countSearchRecords(index) {
  if (Array.isArray(index)) return index.length;
  if (Array.isArray(index?.internalDocumentIDStore?.internalIdToId)) {
    return index.internalDocumentIDStore.internalIdToId.length;
  }
  if (Number.isInteger(index?.docs?.count)) return index.docs.count;
  if (index?.docs?.docs && typeof index.docs.docs === 'object') return Object.keys(index.docs.docs).length;
  return undefined;
}

function analyzeSearch() {
  const file = path.join(outputRoot, 'static.json');
  if (!existsSync(file)) {
    fail('search: missing static.json');
    return;
  }
  const raw = readFileSync(file);
  const gzip = gzipSync(raw, { level: 9 }).byteLength;
  const index = JSON.parse(raw);
  const records = countSearchRecords(index);
  const documentCount = Number.isInteger(index?.docs?.count) ? index.docs.count : undefined;
  console.log(
    `search       ${formatBytes(raw.byteLength)} raw, ${formatBytes(gzip)} gzip, ` +
      `${records === undefined ? 'unknown' : records.toLocaleString()} records`,
  );
  assertAtMost('search raw', raw.byteLength, SEARCH_LIMITS.raw);
  assertAtMost('search gzip', gzip, SEARCH_LIMITS.gzip);
  if (records === undefined || records < 1) {
    fail('search records: unrecognized or empty search-index shape');
  } else if (records > SEARCH_LIMITS.records) {
    fail(`search records: ${records.toLocaleString()} exceeds ${SEARCH_LIMITS.records.toLocaleString()}`);
  }
  const internalCount = index?.internalDocumentIDStore?.internalIdToId?.length;
  if (Number.isInteger(internalCount) && documentCount !== undefined && internalCount !== documentCount) {
    fail(`search records disagree: id store has ${internalCount}, docs store has ${documentCount}`);
  }
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, files);
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

function analyzeOutput() {
  const files = walk(outputRoot);
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  let duplicateRscBytes = 0;
  let duplicatePairs = 0;

  for (const fullFile of files) {
    if (path.basename(fullFile) !== 'index.txt') continue;
    const sibling = path.join(path.dirname(fullFile), '__next._full.txt');
    if (!existsSync(sibling)) continue;
    const left = readFileSync(fullFile);
    const right = readFileSync(sibling);
    if (left.equals(right)) {
      duplicatePairs += 1;
      duplicateRscBytes += Math.min(left.byteLength, right.byteLength);
    }
  }

  console.log(`export       ${formatBytes(totalBytes)} across ${files.length.toLocaleString()} files`);
  console.log(`  duplicate sibling RSC payloads: ${duplicatePairs} pairs, ${formatBytes(duplicateRscBytes)}`);
  assertAtMost('export bytes', totalBytes, OUTPUT_LIMITS.bytes);
  if (files.length > OUTPUT_LIMITS.files) fail(`export files: ${files.length.toLocaleString()} exceeds ${OUTPUT_LIMITS.files.toLocaleString()}`);
  assertAtMost('duplicate sibling RSC bytes', duplicateRscBytes, OUTPUT_LIMITS.duplicateRscBytes);
}

function analyzeDeferredDemo() {
  const manifestFile = path.join(projectRoot, '.next/react-loadable-manifest.json');
  if (!existsSync(manifestFile)) {
    fail('deferred demo: missing React loadable manifest');
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const entry = Object.entries(manifest).find(([key]) => key.includes('SkillGraphTryItInner'))?.[1];
  if (!entry?.files) {
    fail('deferred demo: SkillGraphTryItInner is not listed in the React loadable manifest');
    return;
  }
  const files = [...new Set(entry.files.map((file) => path.join(outputRoot, '_next', file)))];
  for (const file of files) {
    if (!existsSync(file)) fail(`deferred demo: manifest asset is missing: ${path.relative(outputRoot, file)}`);
  }
  const existingFiles = files.filter((file) => existsSync(file));
  const bytes = existingFiles.reduce((sum, file) => sum + gzipFile(file), 0);
  const initialSkillsAssets = routeInitialAssets.get('skills guide') ?? new Set();
  const eagerFiles = existingFiles.filter((file) => initialSkillsAssets.has(file));
  console.log(`deferred demo ${formatBytes(bytes)} gzip across ${existingFiles.length} async assets`);
  if (eagerFiles.length > 0) {
    fail(`deferred demo: ${eagerFiles.length} async assets also appear in the skills page's initial tags`);
  }
  assertAtMost('deferred demo async payload', bytes, DEMO_ASYNC_GZIP_LIMIT);
}

if (!existsSync(outputRoot)) {
  console.error(`Static export not found: ${outputRoot}`);
  process.exit(1);
}

console.log(`Checking static-site budgets in ${outputRoot}`);
for (const route of ROUTES) analyzeRoute(route);
analyzeSearch();
analyzeOutput();
analyzeDeferredDemo();

if (failures.length > 0) {
  console.error(`\nSite budget failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}.`);
  process.exit(1);
}

console.log('\nSite budget passed.');
