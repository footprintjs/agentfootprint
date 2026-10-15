'use strict';
/**
 * layering.config.cjs — the agentfootprint layer table, as data.
 *
 * ONE owner for the fence. Two readers, neither keeps a copy:
 *   - `scripts/check-layering.mjs`          → the report, and `npm run check:layering` in CI
 *   - `test/architecture/layering.test.ts`  → the same analysis, inside the suite
 *
 * THE RULE — a file imports only files at its own layer or BELOW it. Every file has
 * exactly one layer: the most specific pattern that matches it (an exact path beats
 * `dir/**`; a deeper directory beats a shallower one; two equally specific patterns
 * with different layers are a config error). A file no pattern matches is an error,
 * not a default.
 *
 * Only RUNTIME edges are the law: an import that `ts.transpileModule` keeps, plus a
 * lazy `import()`. A type-only import (`import type`, an elided import, an
 * `import('x').T` type reference) is erased by tsc and is reported for information only.
 *
 * WHERE THIS TABLE COMES FROM. The design pass that measured the folder-level import
 * cycle (a value-level SCC of 23 of the 33 folder nodes, the root `src/*.ts` modules
 * counted as one — `--json` reports it as `folderCycles`) and the order that removes it. The
 * table below is that order written against TODAY's paths: a top-level folder is placed
 * at the layer it keeps, and each `src/lib/<sub>/` feature package is placed at the
 * layer it will hold as a top-level folder of its own. A file that a later change
 * MOVES to another folder sits, until then, at its current folder's layer — so the edges
 * that move removes are named below, and the change that frees them deletes them.
 *
 *   L0  leaves          imports nothing above itself: `lib/` (its loose files, `claim/`,
 *                       `context-contract/`), events, bridge, maps, recipes, time
 *   L1  vocabularies    the one law each spells: semantics, redaction, thinking, classify,
 *                       ontology, cache, trust-boundaries
 *   L2  ports           provider-contract (what a provider implements), memory
 *   L3  stores, folds   artifacts, integrity, influence-core, rag (+ lib/rag), resilience, security
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
 *   L15 entry points    src/*.ts barrels and doors/ — may import anything
 *
 * UPWARD_ALLOWANCES names every upward runtime edge that exists today, file → file. The
 * checker fails on an upward edge NOT on the list, and on a listed edge that is no longer
 * an upward runtime edge; `test/architecture/layering.test.ts` pins the list's length, so
 * the list can only shrink. A change that moves a file deletes the entries the move frees
 * and lowers that number; it never adds an entry. An entry names a FILE PAIR, not the
 * names imported across it: a new upward import between two already-listed files passes.
 */

const fs = require('fs');
const path = require('path');

/** @type {ReadonlyArray<{ rank: number, name: string, files: string[] }>} */
const LAYERS = [
  {
    rank: 0,
    name: 'leaves',
    files: [
      'src/lib/*.ts',
      'src/lib/claim/**',
      'src/lib/context-contract/**',
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
      'src/lib/rag/**',
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
 * Folders whose files import, at runtime, only files of the same folder set. Off until the
 * change that makes the law true turns it on.
 *
 * `lib` — the leaves every layer agrees on (its loose files, `claim/`, `context-contract/`)
 * import nothing in `src/` outside themselves. Its feature subfolders are not part of the set:
 * each sits at its own layer until it leaves `lib/` for a top-level folder of its own.
 *
 * `time` — the time layer (instants, ranges, zones, the run clock, the readers) is
 * self-contained: every layer that speaks about time imports it, and it imports none of them.
 *
 * @type {ReadonlyArray<{ name: string, files: string[] }>}
 */
const CLOSED_FOLDERS = [
  {
    name: 'lib (the leaves)',
    files: ['src/lib/*.ts', 'src/lib/claim/**', 'src/lib/context-contract/**'],
  },
  { name: 'time', files: ['src/time/**'] },
];

/**
 * Every upward runtime edge that exists today, file → file (`[from, to]`, repo-relative).
 * Generated once from the measured tree (`node scripts/check-layering.mjs --allowances`
 * prints the current list in this shape); from then on it is edited by hand and only shrinks.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
const UPWARD_ALLOWANCES = [];

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

module.exports = {
  LAYERS,
  CLOSED_FOLDERS,
  UPWARD_ALLOWANCES,
  globToRegExp,
  compileLayers,
  rankOf,
  listSourceFiles,
};
