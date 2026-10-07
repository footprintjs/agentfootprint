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
    name: 'context story',
    file: 'context-engineering/index.html',
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

// RAISED 2026-10-07 (search gzip), for the recordings performance packet:
// owner-approved raise under the 2026-09-27 ruling; docs-site cleanup planned.
// CI measured the branch with EXPORT=true at 2.21 MB gzip (8.98 MB raw, 1,125
// records) against the 2.205 MB ceiling: the packed-recording section of the
// recordings page (pack, read back, the expansion bound), the transformHash
// paragraph of the time-travel page, and the two new API pages. ~2% over the
// measurement, the rule every raise here follows.
// RAISED 2026-09-30 (search gzip): the publish run for the time-axis and
// person-values release measured 2.16 MB gzip across 1,058 records against a
// 2.155 MB ceiling, so the package was tagged but not published. ~2% over the
// measurement, the rule every raise here follows. Owner-approved raise;
// docs-site cleanup planned.
const SEARCH_LIMITS = { raw: 12_000_000, gzip: 2_255_000, records: 2_000 };
// Search gzip raised 2.11 -> 2.155 MB (2026-09-27) — growth this release can
// name: the answer's standing (`assessAnswer()` / `agent.assessment()`), its
// section on the recordings page and its Agent API entry. Measured with
// EXPORT=true on the change: 2,111,307 B gzip (8.54 MB raw, 1,023 records),
// 1.3 KB over the old ceiling; CI measured the same 2.11 MB. ~2% headroom, as
// every raise here.
// Search gzip raised 2.06 -> 2.11 MB (2026-09-25). The docs/guides/ migration is
// complete: the last guides (streaming, recorders, security, prompt-injection,
// adapters, AgentCore, instructions, quick-start) were folded into existing
// site pages and the folder was deleted, which measured 2.07 MB gzip over 1,020
// records. ~2% headroom, deliberately thin — nothing is left to migrate, so
// the next raise should be growth a release can name.
// Earlier: raised 2.00 -> 2.06 MB (2026-09-25) when the tool-catalog lint guide
// and the audit-bundle threat model moved from docs/guides/ onto the site.
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
// Context walkthrough + regenerated 9.98.0 dataset/reference API documentation:
// measured 6,998 exported files (the new story route contributes eight). Keep
// twelve files of headroom; byte, per-route and duplicate-payload limits stay put.
// RAISED for 9.101.1 — files only. The findings ledger (9.101.0, steps 2 and 3)
// added public exports whose generated API-reference routes took the export to
// 7,102 files (CI measured, 648.21 MB, duplicate RSC pairs 0); the bytes ceiling
// still holds. 9.101.0's publish workflow failed on this line before publishing,
// so that version never reached npm and 9.101.1 is the same library. The new
// files ceiling keeps the same thin ~2% headroom over what was measured.
// RAISED for 9.113.0 — bytes and files. Measured on the release commit with
// EXPORT=true: 672.17 MB across 7,249 files (duplicate RSC pairs 0), against
// 672.00 MB / 7,250 — the byte ceiling had 0.17 MB too little, the file ceiling
// one file of room. The growth since 9.101.1 is the API-reference routes of
// 9.102–9.113 (9.113.0 alone adds TryInsteadTool and UnsettledByAbsenceRow and
// regenerates the pages whose source moved) plus the pages the 9.102–9.112
// features added. Same rule as every raise here: ~2% over the measured export
// (686 MB, 7,400 files); the thing to watch is still the per-route cost.
// RAISED for describedResult() — bytes only. Measured with EXPORT=true on the
// change: 686.02 MB across 7,313 files (duplicate RSC pairs 0), against the
// 9.118.1 tree measured the same way, same machine, the same day: 682.99 MB
// across 7,295 files. The ceiling was 0.02 MB short. The +3.03 MB is two new
// API routes (describedResult 0.80 MB, DescribedResultDeclaration 0.80 MB;
// the nested camelCase shapes are inlined on purpose so they add no more),
// their two entries in the nav tree all 781 routes embed (+344 B per copy of
// the 153.6 KB tree, in each route's payload files and page), and the docs
// that change adds: the result-helper table with the three captured model
// views on the Tools page, and the Described tool results page. The shrinks
// on offer would have deleted exactly that — the docs the change exists to
// add, or the declaration type every other mint exports — so this is the
// raise, with the measurement beside it. The file ceiling still holds (7,313
// of 7,400). Search gzip still holds too, but thinly: 2,107,287 of 2,110,000
// bytes. Same rule as every raise here: ~2% over the measured export.
// RAISED 2026-09-28 for the merge of honesty step 6 (the answer layer, 9.124.0)
// into step 7b (the results layer) — files only; owner-approved raise;
// docs-site cleanup planned. Measured after a clean rebuild (out/ and .next/
// removed first), EXPORT=true: 699.52 MB across 7,410 files, duplicate RSC
// pairs 0 — each layer alone fitted (7,383 files on step 7b), together they
// cross by 10 API pages. ~2% over the measured file count, the rule every
// raise here follows. Bytes still hold, thinly (699.52 of 700 MB).
// RAISED 2026-09-28, bytes, for the same merge: CI measured 701.60 MB across
// 7,411 files (the local clean build read 699.52 MB). Owner-approved raise
// (owner confirmed 2026-09-28); docs-site cleanup planned. ~2% over the CI
// measurement, the rule every raise here follows.
// LOWERED 2026-09-29, bytes: 716 MB -> 210 MB — the docs-site cleanup the two
// raises above were waiting for. Measured: every page of the export carried the
// whole sidebar tree, and the tree listed each of the ~680 generated API
// symbols (Fumadocs files the unlisted API root under `fallback`, which it
// serializes too), so a 12 KB API page shipped ~890 KB and a guide page ~1 MB.
// The layout now passes each page a tree without the symbol pages
// (lib/api-tree.mjs · splitApiTree; scripts/test/api-tree.test.mjs): guide
// pages get the guides, API pages get the API kinds, each kind's index page
// lists its symbols, and every symbol keeps its URL. Clean rebuild with
// EXPORT=true: 205.33 MB across 7,450 files (was 699.52 MB). ~2% over, as every
// ceiling here — a growth past it is a real regression, not this tree again.
// RAISED 2026-09-29, files only, for the declared dataset time axis — PENDING
// OWNER APPROVAL (a separate commit so it can be dropped). Measured: 7,612
// files, 206.19 MB, duplicate RSC pairs 0 (EXPORT=true, fresh worktree). The
// change adds nine public symbols (DatasetTimeAxis, readTimeAxis,
// describeTimeAxis, timeAxisIssues, TimeAxisReading, TimeAxisUnit,
// TimeAxisAggregate, TIME_AXIS_UNITS, TIME_AXIS_AGGREGATES), ~7 export files
// per API route; main already sat ~11 files under the old ceiling, so even one
// new symbol page with its siblings crosses it. ~2% over the measurement.
// RAISED 2026-09-30, bytes and files, for the time layer (steps T1-T5b):
// owner-approved raise. Measured after a clean rebuild (out/ and .next/
// removed first), EXPORT=true: 214.38 MB across 8,107 files, duplicate RSC
// pairs 0. The layer adds 54 generated API pages (the clock, the reader port
// and resolver, the time ask and its MCP elicitation, a tool's period forms
// and facts, the ledger rows, the axis view) plus the hand-written Time guide
// page, ~6 export files per API route. ~2% over the measurement, the rule
// every raise here follows.
// RAISED 2026-10-07, bytes, for the recordings performance packet (incremental
// receipts, the event tail that keeps a run's start, packed recordings and the
// bound on what a packed one may expand to): owner-approved raise under the
// 2026-09-27 ruling; docs-site cleanup planned. CI measured the branch with
// EXPORT=true at 219.04 MB across 8,206 files (duplicate RSC pairs 0), 0.34 MB
// over the old ceiling: two generated API pages (transformHashOf,
// TRANSFORM_HASH_PREFIX) and the packed-recording sections of the recordings
// and time-travel pages. ~2% over the measurement, the rule every raise here
// follows.
const OUTPUT_LIMITS = { bytes: 223_400_000, files: 8_270, duplicateRscBytes: 0 };
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
//
// RAISED for 9.105.0 (2026-09-17, owner's call), and measured. 413.8 KB was
// the flagged Lens before the findings ledger existed. Five minors of
// DEFAULT-GRAPH wiring since — the ledger (9.101.0), served from the ledger
// (9.101.1), the hold (9.102.0), the answer ask (9.103.0), the judge (9.104.0)
// and tool choice (9.105.0) — took the demo chunk to 422.4 KB: builder
// validation, the charts' mappers, the stages' gates and the registry's event
// strings, none of it movable behind an import() (the armed tails already are:
// judge.ts and toolChoice/compose.ts load lazily and are NOT in these assets;
// the last 0.4 KB is the wiring that decides whether to load them). Ceiling
// ~2% over the 422.4 KB measurement, as every entry above; the next move is a
// measured shrink or the next family, never a raise for a single feature.
//
// RAISED again (2026-09-25, owner's call — a stopgap) to 441 KB when the
// 9.114.2 findings fix (4025063: one answer-text scanner, findings/answerText.ts)
// took the demo chunk from under 431.0 KB to 432.4 KB gzip, with the scanner
// wired on the default graph although only `.findings()` agents use it.
//
// LOWERED to 436 KB (2026-09-25): the owed shrink landed. The scanner now
// sits behind `findings/peel.ts`, loaded through import() by callLLM and route
// only under the arm — the judge.ts / toolChoice/compose.ts pattern — and
// test/lib/trace-toolpack/browserGraph.test.ts pins it off the root sync
// closure. Measured 430.4 KB gzip across 17 async assets (from 433.5 KB); the
// same day's AnswerAccount release (#17, 9.116.0) then grew the default graph
// by 1.5 KB, re-measured together at 431.9 KB. Ceiling ~1% over that — thinner
// than the ~2% rule above, because the stopgap is paid back, not kept.
//
// RAISED to 450 KB (2026-09-27) — owner-approved raise 2026-09-27; docs-site
// cleanup planned by the owner. The growth is the honesty inputs layer
// (`askOrAssume`, honesty step 3, #26). Measured by CI's docs job with
// EXPORT=true, 17 async assets every time:
//   before  ceiling 436.0 KB; main at the merge base (cfcebe11)   434.7 KB
//           the branch before the import() split (8e6ae1a7)       441.8 KB
//   after   the split, main merged in (d8d7d689)                  441.1 KB
// The layer's run-time half already loads through import() under the arm
// (`arguments/dispatch.ts`, `arguments/serve.ts`, `arguments/subflow.ts`,
// `arguments/resolve.ts`, `middleware/rewrites.ts` — none of them in the
// demo's assets). That split took the branch from 441.8 to 441.1 KB while main
// grew 0.5 KB under it (449193f0 measured 434.2 KB). What cannot move is the
// half a SYNCHRONOUS door needs: `core/tools.ts` · `defineTool` validates
// `askOrAssume` rules at definition (`arguments/declare.ts` ·
// `assertAskOrAssume`), so declare.ts, rows.ts (the checkpoint check
// `validateCheckpoint` runs), the mount, the arm and the turn stamp stay on the
// default graph: +6.4 KB over the merge base. The full list is in
// src/core/agent/arguments/README.md, "What a plain agent carries". A local
// EXPORT=true build of d8d7d689 measured 439.8 KB. Local builds read about
// 1.3 KB under CI on this number (dd076f68 saw 1.5 KB), so CI's figure is the
// basis. Ceiling ~2% over CI's 441.1 KB, as every raise here.
//
// RAISED to 460 KB (2026-09-28) — owner-approved raise; docs-site cleanup
// planned. The growth is the footprintjs 9.28.0 dependency bump (resume walks
// the real chart), which the demo's engine carries on the default graph. A
// local EXPORT=true build of the 9.125.0 library on footprintjs 9.28.0
// measured 450.7 KB gzip across 17 async assets against the 450.0 KB ceiling.
// The same branch's compaction-summary fix adds ~0.1 KB gzip to the demo's
// modules (`evidenceIndex`, `composeRequest`, each minified alone), so the
// branch reads ~450.8 KB locally; local builds read ~1.3 KB under CI, so CI
// should land near 452 KB. Ceiling ~2% over that.
//
// RAISED to 481 KB (2026-09-30) — owner-approved raise; docs-site cleanup
// planned. The growth is the time layer (`.time()`, PR #42), and the shrink
// came FIRST. The branch as opened measured 480.3 KB on CI (478.7 KB in a
// local EXPORT=true build) because its run-time half sat on the default graph:
// seed and ToolCalls imported the resolver, the period conversions, the drift
// check and the row builders statically, and the coverage `Period:` line
// imported the renderer. The clean shrink moved all of it behind `import()`
// under the arm — `core/agent/stages/timeLayer.ts` (seed's clock stamp and
// reading, ToolCalls' dispatch moment, `clock-on-resume`), prepareFinal's
// in-zone line loading `core/time/present.ts` and handing coverage a bound
// renderer — and split each time module a synchronous door shares with the
// run into its record half and its engine (`resolveRecord.ts` / `resolve.ts`,
// `periodForm.ts` / `convert.ts`, `rows.ts` / `rowsBuild.ts`, `ask.ts` /
// `readingAsk.ts`): a bundler puts a whole FILE on the sync graph when any
// sync module imports it, so a lazy function sharing a file with a sync one
// rides along. Local EXPORT=true build, 17 async assets every time:
//   main at a04f07c4                                      456.6 KB
//   the branch as opened (5f7a7a2e)                       478.7 KB  (CI 480.3)
//   after the shrink                                      470.3 KB  (CI ~471.9)
// What cannot move is what a SYNCHRONOUS door needs before any run starts:
// `defineTool({ period })` judges period forms at definition
// (`arguments/declare.ts` -> `core/time/periodForm.ts`), `requestInput` and
// the resume door judge a time `format` (`core/inputRequest.ts` ->
// `core/time/ask.ts`, with the catalog `locales/timeAsk.ts`), the checkpoint
// door checks time rows (`runCheckpoint.ts` · `validateCheckpoint`, also the
// hosting envelopes' sync validators -> `core/time/rows.ts`,
// `resolveRecord.ts`), and `.time()` reads its options at build (`clock.ts`),
// with their leaves (`instant.ts`, `zone.ts`, `range.ts`, `duration.ts`,
// `reader.ts`). Moving any of them makes a public sync door async — a
// behaviour change, not a packaging one. The law is pinned at the graph by
// test/lib/trace-toolpack/browserGraph.test.ts (the time layer's case) and
// listed in src/core/time/README.md, "What a plain agent carries". Ceiling ~2%
// over CI's expected ~471.9 KB (local builds read ~1.6 KB under CI on this
// branch: 478.7 vs 480.3), as every raise here.
// 2026-10-02: footprintjs 9.29.0 (copy-on-write commit) adds its own engine
// code to the demo chunk (`privatise`, `detachBase`): CI measured 482.1 KB
// against 481.0 (main 480.7); local EXPORT=true builds read 480.8 on 9.28.0 and
// 482.2 on 9.29.0, a +1.4 KB move from the dependency alone — nothing on the
// agentfootprint side to shrink. Raised ~2% over the new measurement; owner-
// approved raise (2026-09-27 ruling: raise when it bites, docs-site cleanup
// planned).
const DEMO_ASYNC_GZIP_LIMIT = 492_000;

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
  const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)].map(
    (match) => match[0],
  );
  const modernScripts = scriptTags.filter((tag) => !/\bnomodule\b/i.test(tag));
  const legacyScripts = scriptTags.filter((tag) => /\bnomodule\b/i.test(tag));
  const styles = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)].map(
    (match) => match[0],
  );
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
  const criticalRequests =
    1 + new Set(scriptUrls).size + new Set(styleUrls).size + imagePreloadTags.length;

  routeInitialAssets.set(
    route.name,
    new Set([...scriptUrls, ...styleUrls].map(resolveOutputAsset).filter(Boolean)),
  );

  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  if (h1Count !== 1) fail(`${route.name}: expected exactly one H1, found ${h1Count}`);

  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const missingDimensions = images.filter(
    (tag) => !attribute(tag, 'width') || !attribute(tag, 'height'),
  );
  if (missingDimensions.length > 0) {
    fail(
      `${route.name}: ${missingDimensions.length}/${images.length} images lack intrinsic width and height`,
    );
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
        candidates.push(
          ...srcSet.split(',').map((candidate) => candidate.trim().split(/\s+/, 1)[0]),
        );
      }
      const sizes = candidates
        .filter(Boolean)
        .map((url) => requiredOutputAsset(url, `${route.name} image preload`))
        .filter(Boolean)
        .map((file) => statSync(file).size);
      preloadBytes += sizes.length > 0 ? Math.max(...sizes) : 0;
    }
    console.log(
      `  image preloads: ${imagePreloadTags.length}, up to ${formatBytes(
        preloadBytes,
      )} transferred`,
    );
    if (imagePreloadTags.length > route.imagePreloads.count) {
      fail(
        `${route.name} image preloads: ${imagePreloadTags.length} exceeds ${route.imagePreloads.count}`,
      );
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
  if (index?.docs?.docs && typeof index.docs.docs === 'object')
    return Object.keys(index.docs.docs).length;
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
    fail(
      `search records: ${records.toLocaleString()} exceeds ${SEARCH_LIMITS.records.toLocaleString()}`,
    );
  }
  const internalCount = index?.internalDocumentIDStore?.internalIdToId?.length;
  if (
    Number.isInteger(internalCount) &&
    documentCount !== undefined &&
    internalCount !== documentCount
  ) {
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

  console.log(
    `export       ${formatBytes(totalBytes)} across ${files.length.toLocaleString()} files`,
  );
  console.log(
    `  duplicate sibling RSC payloads: ${duplicatePairs} pairs, ${formatBytes(duplicateRscBytes)}`,
  );
  assertAtMost('export bytes', totalBytes, OUTPUT_LIMITS.bytes);
  if (files.length > OUTPUT_LIMITS.files)
    fail(
      `export files: ${files.length.toLocaleString()} exceeds ${OUTPUT_LIMITS.files.toLocaleString()}`,
    );
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
    if (!existsSync(file))
      fail(`deferred demo: manifest asset is missing: ${path.relative(outputRoot, file)}`);
  }
  const existingFiles = files.filter((file) => existsSync(file));
  const bytes = existingFiles.reduce((sum, file) => sum + gzipFile(file), 0);
  const initialSkillsAssets = routeInitialAssets.get('skills guide') ?? new Set();
  const eagerFiles = existingFiles.filter((file) => initialSkillsAssets.has(file));
  console.log(
    `deferred demo ${formatBytes(bytes)} gzip across ${existingFiles.length} async assets`,
  );
  if (eagerFiles.length > 0) {
    fail(
      `deferred demo: ${eagerFiles.length} async assets also appear in the skills page's initial tags`,
    );
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
  console.error(
    `\nSite budget failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}.`,
  );
  process.exit(1);
}

console.log('\nSite budget passed.');
