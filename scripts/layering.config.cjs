'use strict';
/**
 * layering.config.cjs — the agentfootprint layer table, as data.
 *
 * ONE owner for the fence. Three readers, none keeps a copy:
 *   - `.eslintrc.js`                        → `import/no-restricted-paths` zones (`layerZones`),
 *                                             resolved by `eslint-import-resolver.cjs`, which
 *                                             asks `resolveRelative` here — the checker's own law
 *   - `scripts/check-layering.mjs`          → the report, and `npm run check:layering` in CI
 *   - `test/architecture/layering.test.ts`  → the same analysis, inside the suite
 *
 * THE RULE — a file imports only files at its own layer or BELOW it. Every file has
 * exactly one layer: the most specific pattern that matches it (an exact path beats
 * `dir/**`; a deeper directory beats a shallower one; two equally specific patterns
 * with different layers are a config error). A file no pattern matches is an error,
 * not a default. Every top-level folder of `src/` sits at exactly ONE layer: a folder
 * whose files land on two layers fails the checker.
 *
 * Only RUNTIME edges are the law: an import that `ts.transpileModule` keeps, plus a
 * lazy `import()`. A type-only import (`import type`, an elided import, an
 * `import('x').T` type reference) is erased by tsc. ESLint's `import/no-restricted-paths`
 * cannot tell the two apart, so the upward type-only imports that exist today are named,
 * each with its reason, in TYPE_ONLY_ALLOWANCES — and that list only shrinks: the checker
 * fails on a type-only upward import that is not on it, and on an entry whose import is
 * gone or has become a runtime import.
 *
 * WHERE THIS TABLE COMES FROM. The design pass that measured the folder-level import
 * cycle (a value-level SCC of 23 of the 33 folder nodes, the root `src/*.ts` modules
 * counted as one) and the order that removes it. Every move that order asked for has
 * landed: each top-level folder sits at the layer it keeps, `src/lib/` holds the leaves
 * only, and no upward runtime edge is left — so the fence is CLOSED. UPWARD_ALLOWANCES
 * stays empty (the checker refuses an entry), and a value-level folder cycle fails.
 *
 *   L0  leaves          imports nothing above itself: lib, events, bridge, maps, recipes, time
 *   L1  vocabularies    the one law each spells: semantics, redaction, thinking, classify,
 *                       ontology, cache, trust-boundaries
 *   L2  ports           provider-contract (what a provider implements), memory
 *   L3  stores, folds   artifacts, integrity, influence-core, rag, resilience, security
 *   L4                  identity, answer-validation, observability, tool-lint
 *   L5  the trace       recorders, debug
 *   L6                  locales, reliability, strategies
 *   L7  tools           tools (a tool's declaration, its asks and argument law, ToolProvider)
 *   L8  context         injection-engine
 *   L9  the agent       core
 *   L10 lenses          answer-account, time-travel, trace-toolpack, core-flow
 *   L11                 hosting, context-bisect, context-ledger, bug-report, patterns
 *   L12                 mcp, recorded-chat
 *   L13 implementations adapters
 *   L14                 tool-providers, embedders
 *   L15 entry points    src/*.ts barrels and doors/ — may import anything, hold no logic
 *                       (BARREL_FILES: `export … from` statements only)
 */

const fs = require('fs');
const path = require('path');

/** @type {ReadonlyArray<{ rank: number, name: string, files: string[] }>} */
const LAYERS = [
  {
    rank: 0,
    name: 'leaves',
    files: [
      // The leaves every layer agrees on: loose files, `claim/`, `context-contract/`.
      'src/lib/**',
      'src/events/**',
      'src/bridge/**',
      'src/maps/**',
      'src/recipes/**',
      // The time layer: one owner of every time grammar, imports nothing outside itself.
      'src/time/**',
    ],
  },
  {
    rank: 1,
    name: 'vocabularies',
    files: [
      // The semantic-result vocabulary and the coverage primitives (absent, coverage, period),
      // with the tool-result envelope grammar and the outcome words: one law, one folder.
      'src/semantics/**',
      'src/redaction/**',
      'src/thinking/**',
      'src/classify/**',
      'src/ontology/**',
      'src/cache/**',
      'src/trust-boundaries/**',
    ],
  },
  { rank: 2, name: 'ports', files: ['src/provider-contract/**', 'src/memory/**'] },
  {
    rank: 3,
    name: 'stores and folds',
    files: [
      'src/artifacts/**',
      'src/integrity/**',
      'src/influence-core/**',
      'src/rag/**',
      'src/resilience/**',
      'src/security/**',
    ],
  },
  {
    rank: 4,
    name: 'identity and validation',
    files: [
      'src/identity/**',
      'src/answer-validation/**',
      'src/observability/**',
      'src/tool-lint/**',
    ],
  },
  { rank: 5, name: 'the trace channel', files: ['src/recorders/**', 'src/debug/**'] },
  {
    rank: 6,
    name: 'rules over the trace',
    files: ['src/locales/**', 'src/reliability/**', 'src/strategies/**'],
  },
  {
    rank: 7,
    name: 'tools',
    // Declaring a tool, its asks and its argument law, the chain a call walks, and the
    // `ToolProvider` seam: the agent, the injection engine, MCP and the toolpack all read it.
    files: ['src/tools/**'],
  },
  { rank: 8, name: 'context assembly', files: ['src/injection-engine/**'] },
  { rank: 9, name: 'the agent', files: ['src/core/**'] },
  {
    rank: 10,
    name: 'lenses over a run',
    files: [
      'src/answer-account/**',
      'src/time-travel/**',
      'src/trace-toolpack/**',
      'src/core-flow/**',
    ],
  },
  {
    rank: 11,
    name: 'hosts and offline analysis',
    files: [
      'src/hosting/**',
      'src/context-bisect/**',
      'src/context-ledger/**',
      'src/bug-report/**',
      'src/patterns/**',
    ],
  },
  { rank: 12, name: 'protocol and replay', files: ['src/mcp/**', 'src/recorded-chat/**'] },
  { rank: 13, name: 'provider implementations', files: ['src/adapters/**'] },
  { rank: 14, name: 'tool providers', files: ['src/tool-providers/**', 'src/embedders/**'] },
  { rank: 15, name: 'entry points', files: ['src/*.ts', 'src/doors/**'] },
];

/**
 * Folders whose files import, at runtime, only files of the same folder.
 *
 * `lib` — the leaves every layer agrees on (its loose files, `claim/`, `context-contract/`)
 * import nothing in `src/` outside themselves. A type-only import is erased and is not an
 * edge (`lib/conventions.ts` names `events/types.ts` · `ContextSlot`).
 *
 * `time` — the time layer (instants, ranges, zones, the run clock, the readers) is
 * self-contained: every layer that speaks about time imports it, and it imports none of them.
 *
 * @type {ReadonlyArray<{ name: string, files: string[] }>}
 */
const CLOSED_FOLDERS = [
  { name: 'lib', files: ['src/lib/**'] },
  { name: 'time', files: ['src/time/**'] },
];

/**
 * The files that must be barrels: every top-level statement is an `export … from '…'`.
 * No declaration, no expression, and no `import` — a side-effect import in a barrel is
 * dropped by bundlers that trust package.json `sideEffects`, so a registration placed
 * there silently does not happen (the self-explain port, packet 10).
 *
 * @type {ReadonlyArray<string>}
 */
const BARREL_FILES = ['src/*.ts', 'src/doors/**'];

/**
 * CLOSED — must stay empty. It once named every upward runtime edge, file → file, and
 * shrank to nothing as the moves landed. The checker now refuses ANY entry: a new upward
 * runtime import is fixed by moving code, never by naming it here.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
const UPWARD_ALLOWANCES = [];

// ── type-only upward imports ─────────────────────────────────────────────────

const PAYLOAD_TYPES =
  "the event registry (`events/payloads.ts`) names this folder's payload types; declaring each " +
  'payload beside its event instead is a separate design, not yet made.';
const PORT_TYPES_FROM_CACHE =
  "the cache layer names the provider port's types (`LLMRequest`, `LLMResponse`, `LLMMessage`, " +
  '`LLMProvider`, `PricingTable`). `cache/` sits at L1 although its lowest run-time importer is ' +
  'the injection engine (L8), so ranking it above `provider-contract/` would retire this entry.';
const PORT_TYPES_FROM_THINKING =
  '`provider-contract/requestRefusal.ts` imports `thinking/` at run time (its refusal ' +
  'errors), so thinking sits below the port whose types it names.';
const SELF_EXPLAIN_TYPES =
  'the agent, its builder and the self-explain port (`core/agent/selfExplainPort.ts`) name the ' +
  "extension's option and binding types; the implementation reaches the builder only by " +
  'registering through `trace-toolpack/selfExplainHost.ts` (PR #131).';
const KNOWN_WORDS =
  "the served-event redaction keeps only the library's own words (`LibraryWord`), a union " +
  'built from closed string unions such as this one; the generated word record is checked ' +
  'exactly against it, so a word added here does not compile until it is listed.';

/**
 * Upward imports that are TYPE-ONLY (erased by tsc: no runtime edge) but that
 * `import/no-restricted-paths` would flag, file → file, each with its reason. The ESLint
 * zones cut exactly these pairs. The checker fails on an upward type-only import NOT on
 * the list, on an entry whose import is gone, has turned into a runtime import or is no
 * longer upward, and on a duplicate; `test/architecture/layering.test.ts` pins the length,
 * so the list can only shrink.
 *
 * @type {ReadonlyArray<{ from: string, to: string, reason: string }>}
 */
const TYPE_ONLY_ALLOWANCES = [
  {
    from: 'src/artifacts/datasetResult.ts',
    to: 'src/tools/tools.ts',
    reason:
      'the dataset adapter wraps any `Tool` and runs it with its `ToolExecutionContext`, both ' +
      'named by type.',
  },
  {
    from: 'src/cache/CacheDecisionSubflow.ts',
    to: 'src/injection-engine/types.ts',
    reason:
      'the cache decision reads the active injections by type (`ActiveInjection`, `Injection`); ' +
      'the injection engine imports the cache at run time (its `define*` factories).',
  },
  {
    from: 'src/cache/CacheDecisionSubflow.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_CACHE,
  },
  {
    from: 'src/cache/cacheRecorder.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_CACHE,
  },
  {
    from: 'src/cache/cacheStrategyFor.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_CACHE,
  },
  {
    from: 'src/cache/strategies/AutomaticCacheStrategy.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_CACHE,
  },
  {
    from: 'src/cache/strategies/BreakpointCacheStrategy.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_CACHE,
  },
  {
    from: 'src/cache/strategies/NoOpCacheStrategy.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_CACHE,
  },
  {
    from: 'src/cache/types.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_CACHE,
  },
  {
    from: 'src/core/Agent.ts',
    to: 'src/trace-toolpack/selfExplain.ts',
    reason: SELF_EXPLAIN_TYPES,
  },
  {
    from: 'src/core/agent/AgentBuilder.ts',
    to: 'src/trace-toolpack/selfExplain.ts',
    reason: SELF_EXPLAIN_TYPES,
  },
  {
    from: 'src/core/agent/selfExplainPort.ts',
    to: 'src/trace-toolpack/selfExplain.ts',
    reason: SELF_EXPLAIN_TYPES,
  },
  {
    from: 'src/events/dispatcher.ts',
    to: 'src/redaction/served.ts',
    reason:
      'the dispatcher holds and applies `EventServing`, the served-event policy the redaction ' +
      'layer owns (`EventDispatcher · useServing`, `dispatchForRun`).',
  },
  { from: 'src/events/payloads.ts', to: 'src/artifacts/capability.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/artifacts/types.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/core/agent/arguments/rows.ts', reason: PAYLOAD_TYPES },
  {
    from: 'src/events/payloads.ts',
    to: 'src/core/agent/assessment/types.ts',
    reason: PAYLOAD_TYPES,
  },
  { from: 'src/events/payloads.ts', to: 'src/core/agent/findings/types.ts', reason: PAYLOAD_TYPES },
  {
    from: 'src/events/payloads.ts',
    to: 'src/integrity/disposition/types.ts',
    reason: PAYLOAD_TYPES,
  },
  { from: 'src/events/payloads.ts', to: 'src/integrity/finding/types.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/memory/define.types.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/provider-contract/types.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/semantics/toolEffects.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/semantics/types.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/thinking/replay.ts', reason: PAYLOAD_TYPES },
  { from: 'src/events/payloads.ts', to: 'src/thinking/types.ts', reason: PAYLOAD_TYPES },
  {
    from: 'src/recipes/types.ts',
    to: 'src/core/agent/AgentBuilder.ts',
    reason:
      'a recipe is typed as a function over the `AgentBuilder` it configures; `/recipes` is ' +
      'authoring-time vocabulary with no run entry point.',
  },
  {
    from: 'src/recorders/core/CheckInRecorder.ts',
    to: 'src/core/checkin.ts',
    reason: 'the check-in recorder records the `CheckInRequest` the agent raises, named by type.',
  },
  {
    from: 'src/recorders/core/replayHooks.ts',
    to: 'src/core/agent/receipt/receipt.ts',
    reason: 'the replay hooks read the `Receipt` the agent mints, named by type.',
  },
  {
    from: 'src/recorders/observability/recordRun.ts',
    to: 'src/core/runner.ts',
    reason:
      '`recordRun` takes any `Runner` (declared in core) as a parameter type; the agent imports ' +
      'the recorders at run time.',
  },
  {
    from: 'src/redaction/knownStrings.ts',
    to: 'src/core/agent/evidence/types.ts',
    reason: KNOWN_WORDS,
  },
  {
    from: 'src/redaction/knownStrings.ts',
    to: 'src/injection-engine/skillGraph.ts',
    reason: KNOWN_WORDS,
  },
  {
    from: 'src/redaction/knownStrings.ts',
    to: 'src/injection-engine/skillGuard.ts',
    reason: KNOWN_WORDS,
  },
  {
    from: 'src/redaction/knownStrings.ts',
    to: 'src/injection-engine/types.ts',
    reason: KNOWN_WORDS,
  },
  {
    from: 'src/reliability/failFastRecord.ts',
    to: 'src/core/agent/types.ts',
    reason: "the fail-fast record's keys are checked against `AgentState` (`satisfies keyof`).",
  },
  {
    from: 'src/thinking/dispatch.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_THINKING,
  },
  {
    from: 'src/thinking/replay.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_THINKING,
  },
  {
    from: 'src/thinking/replayHistory.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_THINKING,
  },
  {
    from: 'src/thinking/thinkingHandlerFor.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_THINKING,
  },
  {
    from: 'src/thinking/thinkingModeFor.ts',
    to: 'src/provider-contract/types.ts',
    reason: PORT_TYPES_FROM_THINKING,
  },
  {
    from: 'src/tool-lint/analyze.ts',
    to: 'src/tools/tools.ts',
    reason: 'the build-time lint reads a tool catalog (`Tool`) by type.',
  },
  {
    from: 'src/tools/runChain.ts',
    to: 'src/core/agent/middleware/types.ts',
    reason:
      'the chain walker names the middleware and outcome types declared in core; moving them ' +
      'into `tools/` is the follow-up the `tools/` move left open (PR #130).',
  },
  {
    from: 'src/tools/tools.ts',
    to: 'src/core/checkin.ts',
    reason:
      '`Tool.checkIn` names `CheckInDemand`, declared in `core/checkin.ts`, the leaf that owns ' +
      'every check-in type and imports nothing at run time; moving that leaf down is the ' +
      'follow-up the `tools/` move left open (PR #130).',
  },
];

// ── matching ─────────────────────────────────────────────────────────────────

/** `**` crosses directories, `*` does not. Repo-relative, forward-slash paths only. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else re += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

/** Higher = more specific: segments before the first wildcard, and exact paths beat globs. */
function specificity(glob) {
  const segs = glob.split('/');
  const firstWild = segs.findIndex((s) => s.includes('*'));
  return firstWild === -1 ? 1000 + segs.length : firstWild;
}

function compileLayers(layers) {
  return layers.flatMap((layer) =>
    layer.files.map((glob) => ({
      glob,
      rank: layer.rank,
      re: globToRegExp(glob),
      spec: specificity(glob),
    })),
  );
}

const COMPILED = compileLayers(LAYERS);

/** The layer of a repo-relative file, or null when no pattern matches (a config error). */
function rankOf(relPath, compiled = COMPILED) {
  let best = null;
  for (const entry of compiled) {
    if (!entry.re.test(relPath)) continue;
    if (best === null || entry.spec > best.spec) best = entry;
    else if (entry.spec === best.spec && entry.rank !== best.rank) {
      throw new Error(
        `layering: "${relPath}" matches "${best.glob}" (L${best.rank}) and "${entry.glob}" (L${entry.rank}) equally`,
      );
    }
  }
  return best === null ? null : best.rank;
}

/** Every `.ts` file (no `.d.ts`) under `<root>/<dir>`, repo-relative and sorted. */
function listSourceFiles(root, dir = 'src') {
  const out = [];
  const walk = (at) => {
    for (const name of fs.readdirSync(at).sort()) {
      const full = path.join(at, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts'))
        out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(path.join(root, dir));
  return out;
}

/**
 * THE resolution law for a relative specifier: `<from's dir>/<spec>` with `.js` read as
 * `.ts`, then as a folder's `index.ts`. `isFile(repoRelativePath)` says whether a candidate
 * exists. Returns the repo-relative file, or null (a bare package, or nothing there). The
 * checker and the ESLint resolver both ask it, so the two cannot disagree about which file
 * an import names.
 */
function resolveRelative(from, spec, isFile) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(from), spec.replace(/\.js$/, ''));
  for (const candidate of [base + '.ts', base + '/index.ts'])
    if (isFile(candidate)) return candidate;
  return null;
}

// ── ESLint zones ─────────────────────────────────────────────────────────────

/**
 * `import/no-restricted-paths` zones for `.eslintrc.js`, derived from the table: one zone
 * per layer (its files may not import files of a higher layer), plus one zone per file that
 * carries a TYPE_ONLY_ALLOWANCES entry, with exactly its named targets cut out. `except` is
 * not used — eslint-plugin-import resolves it against each `from` entry, which cannot
 * express "this one importer, that one target".
 */
function layerZones(root) {
  const files = listSourceFiles(root);
  const rank = new Map();
  for (const f of files) {
    const r = rankOf(f);
    if (r === null) {
      throw new Error(
        `layering: ${f} is not in any layer. Add it to scripts/layering.config.cjs (LAYERS) — every src file has exactly one.`,
      );
    }
    rank.set(f, r);
  }
  const cuts = new Map();
  for (const a of TYPE_ONLY_ALLOWANCES) {
    if (!cuts.has(a.from)) cuts.set(a.from, new Set());
    cuts.get(a.from).add(a.to);
  }
  const abs = (f) => path.join(root, f);
  const top = Math.max(...LAYERS.map((l) => l.rank));
  const zones = [];
  for (let k = 0; k < top; k++) {
    const higher = files.filter((f) => rank.get(f) > k);
    const message = `L${k} may import only ${
      k === 0 ? 'L0' : `L0-L${k}`
    }: the layer table and the type-only allowances are in scripts/layering.config.cjs.`;
    const plain = [];
    for (const f of files.filter((x) => rank.get(x) === k)) {
      const cut = cuts.get(f);
      if (!cut) plain.push(f);
      else
        zones.push({ target: abs(f), from: higher.filter((h) => !cut.has(h)).map(abs), message });
    }
    if (plain.length > 0 && higher.length > 0)
      zones.push({ target: plain.map(abs), from: higher.map(abs), message });
  }
  return zones;
}

module.exports = {
  LAYERS,
  CLOSED_FOLDERS,
  BARREL_FILES,
  UPWARD_ALLOWANCES,
  TYPE_ONLY_ALLOWANCES,
  globToRegExp,
  compileLayers,
  rankOf,
  listSourceFiles,
  resolveRelative,
  layerZones,
};
