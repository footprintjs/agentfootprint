/**
 * THE FENCE — tests for `scripts/check-layering.mjs`, `scripts/layering.config.cjs` and the
 * ESLint zones the table generates.
 *
 *   unit      the matcher (the most specific pattern wins, an equal tie is an error) and the
 *             one resolution law the checker and the lint share
 *   boundary  small fixture trees: every way the analysis must say FAIL, and the ways it must
 *             not; then THE NEGATIVE TEST — a deliberately upward edge in a tree placed by
 *             the REAL table fails the real checker
 *   scenario  THE REAL TREE: every file and every top-level folder sits at exactly one layer,
 *             no runtime import points up, UPWARD_ALLOWANCES is empty, every upward type-only
 *             import is named, `lib/` and `time/` are closed, `src/*.ts` and the doors are
 *             barrels, and no top-level folder is in a value-level cycle
 *   lint      the zones forbid exactly what the table forbids, and the rule is live
 *
 * WHAT A GREEN RUN PROVES: the tree is layered. No runtime import points up the table, and no
 * value-level cycle joins two top-level folders. The only upward imports are the type-only ones
 * named, with reasons, in TYPE_ONLY_ALLOWANCES, and that list only shrinks.
 * WHAT IT DOES NOT PROVE: that there is no file-level cycle inside one folder (`fileCycles`,
 * reported only), or that type-only edges form no folder cycle (`folderCyclesWithTypes`,
 * reported only).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

import { analyse, folderOf, format, readEdges } from '../../scripts/check-layering.mjs';
import layering from '../../scripts/layering.config.cjs';

const {
  LAYERS,
  CLOSED_FOLDERS,
  BARREL_FILES,
  UPWARD_ALLOWANCES,
  TYPE_ONLY_ALLOWANCES,
  compileLayers,
  rankOf,
  listSourceFiles,
  resolveRelative,
  layerZones,
} = layering;
const REPO = resolve(__dirname, '../..');

/**
 * THE RATCHET — the exact length of TYPE_ONLY_ALLOWANCES. The checker refuses an entry whose
 * import is gone, has become a runtime import or no longer points up; this refuses one that
 * was ADDED. A change that moves a type down deletes its entry and lowers this number in the
 * same commit; nothing raises it.
 */
const TYPE_ONLY_ALLOWANCE_COUNT = 43;

type Allowance = { from: string; to: string; reason: string };
type Edge = { from: string; to: string; kind: string; line: number };

// ── fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_LAYERS = [
  { rank: 0, name: 'low', files: ['src/low/**'] },
  { rank: 1, name: 'mid', files: ['src/mid/**', 'src/side/**'] },
  { rank: 2, name: 'high', files: ['src/high/**'] },
  { rank: 3, name: 'entry', files: ['src/*.ts'] },
];
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Build a tree of `{ 'src/low/a.ts': 'source' }` under a temp dir. */
function makeTree(tree: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'af-layering-'));
  made.push(root);
  for (const [file, source] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  return root;
}

/** Analyse a fixture tree under the fixture table, every list empty unless given. */
function run(tree: Record<string, string>, config: Record<string, unknown> = {}) {
  return analyse({
    root: makeTree(tree),
    config: {
      layers: FIXTURE_LAYERS,
      upwardAllowances: [],
      typeOnlyAllowances: [],
      closedFolders: [],
      barrelFiles: [],
      ...config,
    },
  });
}

const named = (from: string, to: string): Allowance => ({ from, to, reason: 'fixture' });

// ── unit: the matcher and the resolution law ─────────────────────────────────

describe('layering config — which layer a file is in', () => {
  const layers = compileLayers([
    { rank: 9, name: 'dir', files: ['src/core/**'] },
    { rank: 0, name: 'leaf', files: ['src/core/agent/coverage/emptiness.ts'] },
    { rank: 1, name: 'deeper dir', files: ['src/core/agent/coverage/**'] },
  ]);

  it('an exact path beats a directory glob, and a deeper directory beats a shallower one', () => {
    expect(rankOf('src/core/Agent.ts', layers)).toBe(9);
    expect(rankOf('src/core/agent/coverage/absent.ts', layers)).toBe(1);
    expect(rankOf('src/core/agent/coverage/emptiness.ts', layers)).toBe(0);
  });

  it('`*` stays inside one directory; `**` crosses them', () => {
    const entry = compileLayers([{ rank: 15, name: 'entry', files: ['src/*.ts'] }]);
    expect(rankOf('src/index.ts', entry)).toBe(15);
    expect(rankOf('src/core/Agent.ts', entry)).toBeNull();
  });

  it('two equally specific patterns at different layers are a config error, not a coin toss', () => {
    const tied = compileLayers([
      { rank: 1, name: 'a', files: ['src/x/**'] },
      { rank: 2, name: 'b', files: ['src/x/**'] },
    ]);
    expect(() => rankOf('src/x/a.ts', tied)).toThrow(/equally/);
  });

  it('a file no pattern matches has no layer (the analysis reports it)', () => {
    expect(rankOf('src/nowhere/a.ts', compileLayers(FIXTURE_LAYERS))).toBeNull();
  });
});

describe('layering config — which file an import names', () => {
  const known = new Set(['src/a/b.ts', 'src/c/index.ts']);
  const isFile = (f: string) => known.has(f);

  it('`.js` is read as `.ts`, then as a folder `index.ts`; a bare package or a missing file is null', () => {
    expect(resolveRelative('src/a/x.ts', './b.js', isFile)).toBe('src/a/b.ts');
    expect(resolveRelative('src/a/x.ts', '../c/index.js', isFile)).toBe('src/c/index.ts');
    expect(resolveRelative('src/a/x.ts', '../c', isFile)).toBe('src/c/index.ts');
    expect(resolveRelative('src/a/x.ts', 'footprintjs', isFile)).toBeNull();
    expect(resolveRelative('src/a/x.ts', './missing.js', isFile)).toBeNull();
  });
});

// ── boundary: fixture trees ──────────────────────────────────────────────────

describe('check-layering — what fails', () => {
  it('a downward value import is clean', () => {
    const r = run({
      'src/low/a.ts': 'export const a = 1;',
      'src/high/b.ts': "import { a } from '../low/a.js';\nexport const b = a;",
    });
    expect(r.ok).toBe(true);
    expect(r.upward).toEqual([]);
  });

  it('an upward value import fails, naming the line', () => {
    const r = run({
      'src/low/a.ts': "import { b } from '../high/b.js';\nexport const a = b;",
      'src/high/b.ts': 'export const b = 1;',
    });
    expect(r.ok).toBe(false);
    expect(r.upward).toMatchObject([{ from: 'src/low/a.ts', to: 'src/high/b.ts', line: 1 }]);
    expect(format(r)).toMatch(/NOT ALLOWED/);
  });

  it('an entry in UPWARD_ALLOWANCES fails — the fence is closed — and the edge it names still fails', () => {
    const r = run(
      {
        'src/low/a.ts': "import { b } from '../high/b.js';\nexport const a = b;",
        'src/high/b.ts': 'export const b = 1;',
      },
      { upwardAllowances: [['src/low/a.ts', 'src/high/b.ts']] },
    );
    expect(r.ok).toBe(false);
    expect(r.reopenedAllowances).toEqual([{ from: 'src/low/a.ts', to: 'src/high/b.ts' }]);
    expect(r.upward).toHaveLength(1);
    expect(format(r)).toMatch(/UPWARD_ALLOWANCES must stay empty/);
  });

  it('a lazy `import()` is an upward edge too', () => {
    const r = run({
      'src/low/a.ts': "export const load = () => import('../high/b.js');",
      'src/high/b.ts': 'export const b = 1;',
    });
    expect(r.ok).toBe(false);
    expect(r.upward[0]).toMatchObject({ kind: 'dynamic' });
  });

  const typeOnlyTree = {
    'src/low/a.ts':
      "import type { B } from '../high/b.js';\n" +
      "import { C } from '../high/c.js';\n" +
      'export type A = B | C;\n' +
      "export type D = import('../high/d.js').D;",
    'src/high/b.ts': 'export type B = 1;',
    'src/high/c.ts': 'export type C = 2;',
    'src/high/d.ts': 'export type D = 3;',
  };

  it('an upward type-only import that is not named fails — `import type`, an elided import, `import("x").T`', () => {
    const r = run(typeOnlyTree);
    expect(r.ok).toBe(false);
    expect(r.upward).toEqual([]);
    expect(r.typeUnnamed.map((e: Edge) => e.to).sort()).toEqual([
      'src/high/b.ts',
      'src/high/c.ts',
      'src/high/d.ts',
    ]);
    expect(format(r)).toMatch(/NOT NAMED/);
  });

  it('the same imports named in TYPE_ONLY_ALLOWANCES pass', () => {
    const r = run(typeOnlyTree, {
      typeOnlyAllowances: ['b', 'c', 'd'].map((x) => named('src/low/a.ts', `src/high/${x}.ts`)),
    });
    expect(r.ok).toBe(true);
    expect(r.typeUpward).toHaveLength(3);
    expect(r.typeUnnamed).toEqual([]);
  });

  it('an `index.ts` behind a folder specifier resolves', () => {
    const r = run({
      'src/low/a.ts': "import { b } from '../high/index.js';\nexport const a = b;",
      'src/high/index.ts': 'export const b = 1;',
    });
    expect(r.upward).toMatchObject([{ to: 'src/high/index.ts' }]);
  });

  it('a type-only allowance whose import is gone is stale, and stale fails — the list only shrinks', () => {
    const r = run(
      { 'src/low/a.ts': 'export const a = 1;', 'src/high/b.ts': 'export const b = 1;' },
      { typeOnlyAllowances: [named('src/low/a.ts', 'src/high/b.ts')] },
    );
    expect(r.ok).toBe(false);
    expect(r.staleTypeAllowances).toMatchObject([
      { why: 'no such type-only import exists any more' },
    ]);
  });

  it('a type-only allowance whose import became a runtime import is stale, and the edge fails as upward', () => {
    const r = run(
      {
        'src/low/a.ts': "import { b } from '../high/b.js';\nexport const a = b;",
        'src/high/b.ts': 'export const b = 1;',
      },
      { typeOnlyAllowances: [named('src/low/a.ts', 'src/high/b.ts')] },
    );
    expect(r.ok).toBe(false);
    expect(r.staleTypeAllowances[0].why).toMatch(/RUNTIME import now/);
    expect(r.upward).toHaveLength(1);
  });

  it('a type-only allowance for an import that is downward under the table is stale', () => {
    const r = run(
      {
        'src/high/a.ts': "import type { B } from '../low/b.js';\nexport type A = B;",
        'src/low/b.ts': 'export type B = 1;',
      },
      { typeOnlyAllowances: [named('src/high/a.ts', 'src/low/b.ts')] },
    );
    expect(r.ok).toBe(false);
    expect(r.staleTypeAllowances).toMatchObject([{ why: 'is no longer upward under the table' }]);
  });

  it('a stale entry gives its most basic reason: a downward pair is "no longer upward" even when the import is a runtime one', () => {
    const r = run(
      {
        'src/high/a.ts': "import { b } from '../low/b.js';\nexport const a = b;",
        'src/low/b.ts': 'export const b = 1;',
      },
      { typeOnlyAllowances: [named('src/high/a.ts', 'src/low/b.ts')] },
    );
    expect(r.staleTypeAllowances).toMatchObject([{ why: 'is no longer upward under the table' }]);
  });

  it('a type-only allowance that names a file no longer in the tree is stale', () => {
    const r = run(
      { 'src/low/a.ts': 'export const a = 1;' },
      { typeOnlyAllowances: [named('src/low/a.ts', 'src/high/gone.ts')] },
    );
    expect(r.ok).toBe(false);
    expect(r.staleTypeAllowances).toMatchObject([{ why: 'names a file that does not exist' }]);
  });

  it('a duplicated type-only allowance fails', () => {
    const r = run(
      {
        'src/low/a.ts': "import type { B } from '../high/b.js';\nexport type A = B;",
        'src/high/b.ts': 'export type B = 1;',
      },
      {
        typeOnlyAllowances: [
          named('src/low/a.ts', 'src/high/b.ts'),
          named('src/low/a.ts', 'src/high/b.ts'),
        ],
      },
    );
    expect(r.ok).toBe(false);
    expect(r.duplicateTypeAllowances).toHaveLength(1);
  });

  it('a file no layer pattern matches fails', () => {
    const r = run({ 'src/elsewhere/a.ts': 'export const a = 1;' });
    expect(r.ok).toBe(false);
    expect(r.unassigned).toEqual(['src/elsewhere/a.ts']);
  });

  it('a top-level folder whose files sit at two layers fails — a folder is exactly one layer', () => {
    const r = run(
      { 'src/low/a.ts': 'export const a = 1;', 'src/low/odd.ts': 'export const odd = 1;' },
      { layers: [...FIXTURE_LAYERS, { rank: 2, name: 'odd', files: ['src/low/odd.ts'] }] },
    );
    expect(r.ok).toBe(false);
    expect(r.splitFolders).toEqual([{ folder: 'low', layers: [0, 2] }]);
    expect(format(r)).toMatch(/split: src\/low\/ sits at L0, L2/);
  });

  it('a closed folder set refuses a runtime import out of it, even a downward one', () => {
    const r = run(
      {
        'src/mid/a.ts': "import { b } from '../low/b.js';\nexport const a = b;",
        'src/low/b.ts': 'export const b = 1;',
      },
      { closedFolders: [{ name: 'mid', files: ['src/mid/**'] }] },
    );
    expect(r.ok).toBe(false);
    expect(r.closedEscapes).toMatchObject([
      { from: 'src/mid/a.ts', to: 'src/low/b.ts', closed: 'mid' },
    ]);
  });

  it('a barrel holds only `export … from`: a declaration or a side-effect import fails, naming the line', () => {
    const r = run(
      {
        'src/index.ts':
          'export const x = 1;\n' +
          "import './low/a.js';\n" +
          "export { a } from './low/a.js';\n" +
          "export * from './low/a.js';\n" +
          "export type { A } from './low/a.js';\n",
        'src/low/a.ts': 'export const a = 1;\nexport type A = 1;',
      },
      { barrelFiles: ['src/*.ts'] },
    );
    expect(r.ok).toBe(false);
    expect(r.barrelStatements).toEqual([
      { file: 'src/index.ts', line: 1, text: 'export const x = 1;' },
      { file: 'src/index.ts', line: 2, text: "import './low/a.js';" },
    ]);
  });

  it('a barrel of `export … from` statements only passes', () => {
    const r = run(
      {
        'src/index.ts': "// a comment is not a statement\nexport { a } from './low/a.js';\n",
        'src/low/a.ts': 'export const a = 1;',
      },
      { barrelFiles: ['src/*.ts'] },
    );
    expect(r.ok).toBe(true);
    expect(r.barrelStatements).toEqual([]);
  });

  it('a value-level cycle between two folders of ONE layer fails, naming its members', () => {
    const r = run({
      'src/mid/a.ts': "import { b } from '../side/b.js';\nexport const a = () => b;",
      'src/side/b.ts': "import { a } from '../mid/a.js';\nexport const b = () => a;",
    });
    expect(r.upward).toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.folderCycles).toEqual([['mid', 'side']]);
    expect(r.fileCycles).toHaveLength(1);
    expect(format(r)).toMatch(/folder cycle: mid, side/);
  });

  it('a folder cycle that closes only through a type-only edge is reported, not failed', () => {
    const r = run({
      'src/mid/a.ts': "import { b } from '../side/b.js';\nexport type A = 1;\nexport const a = b;",
      'src/side/b.ts':
        "import type { A } from '../mid/a.js';\nexport type B = A;\nexport const b = 1;",
    });
    expect(r.ok).toBe(true);
    expect(r.folderCycles).toEqual([]);
    expect(r.folderCyclesWithTypes).toEqual([['mid', 'side']]);
  });

  it('the root `src/*.ts` modules are one folder node, `(root)`', () => {
    const r = run(
      {
        'src/index.ts': "export { a } from './low/a.js';",
        'src/low/a.ts': "import type { C } from '../conventions.js';\nexport const a: C = 1;",
        'src/conventions.ts': 'export type C = 1;',
      },
      { typeOnlyAllowances: [named('src/low/a.ts', 'src/conventions.ts')] },
    );
    expect(r.ok).toBe(true);
    expect(r.folderCyclesWithTypes).toEqual([['(root)', 'low']]);
  });

  it('a relative import that names no file fails — an edge cannot drop out unseen', () => {
    const r = run({
      'src/low/a.ts': "import { b } from '../high/missing.js';\nexport const a = b;",
    });
    expect(r.ok).toBe(false);
    expect(r.unresolved).toEqual([{ from: 'src/low/a.ts', spec: '../high/missing.js', line: 1 }]);
  });

  it('a relative import of another file that exists (a `.json` module) is not an edge and not unresolved', () => {
    const r = run({
      'src/low/a.ts': "import data from './data.json';\nexport const a = data;",
      'src/low/data.json': '{}',
    });
    expect(r.ok).toBe(true);
    expect(r.unresolved).toEqual([]);
  });
});

// ── boundary: THE NEGATIVE TEST, under the real table ────────────────────────

describe('check-layering — a deliberately upward edge, placed by the REAL table', () => {
  const clean = {
    'src/memory/store.ts': 'export const store = 1;\n',
    'src/core/agent.ts':
      "import { store } from '../memory/store.js';\nexport const agent = store;\n",
  };
  const upward = {
    ...clean,
    'src/events/probe.ts':
      "import { agent } from '../core/agent.js';\nexport const probe = agent;\n",
  };
  // The real layers, closed folders, barrels and UPWARD_ALLOWANCES; only the type-only names,
  // which list files of this repository, are left out of a tree that does not hold them.
  const realTable = { typeOnlyAllowances: [] };

  it('fails the analysis for that one reason (events is L0, core is L9)', () => {
    const control = analyse({ root: makeTree(clean), config: realTable });
    expect(control.ok).toBe(true);
    const r = analyse({ root: makeTree(upward), config: realTable });
    expect(r.ok).toBe(false);
    expect(r.upward).toMatchObject([
      { from: 'src/events/probe.ts', to: 'src/core/agent.ts', fromRank: 0, toRank: 9, line: 1 },
    ]);
    expect([
      r.unassigned,
      r.splitFolders,
      r.reopenedAllowances,
      r.typeUnnamed,
      r.closedEscapes,
      r.barrelStatements,
      r.folderCycles,
      r.unresolved,
    ]).toEqual([[], [], [], [], [], [], [], []]);
  });

  it('fails the CLI that CI runs: the clean tree exits 0, the same tree plus the edge exits 1 naming it NOT ALLOWED', () => {
    const cli = (tree: Record<string, string>) =>
      spawnSync(
        process.execPath,
        [
          join(REPO, 'scripts', 'check-layering.mjs'),
          '--root',
          makeTree(tree),
          '--no-type-allowances',
        ],
        { encoding: 'utf8' },
      );
    const control = cli(clean);
    expect(control.status, control.stdout).toBe(0);
    expect(control.stdout.trimEnd().endsWith('OK')).toBe(true);
    const failed = cli(upward);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toMatch(
      /events\/probe\.ts:1 \(L0\) -> core\/agent\.ts \(L9\)\s+\[NOT ALLOWED\]/,
    );
    expect(failed.stdout.trimEnd().endsWith('FAIL')).toBe(true);
  });
});

// ── scenario: the real tree ──────────────────────────────────────────────────

describe('check-layering — this repository', () => {
  const result = analyse({ root: REPO });
  const files: string[] = listSourceFiles(REPO);
  // Read once, while the suite collects: re-reading 900 files inside a test risks its timeout
  // under the coverage run.
  const edges = readEdges(REPO, files) as Edge[];

  it('every src file is placed in exactly one layer', () => {
    expect(result.unassigned).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.files).toBe(files.length);
  });

  it('every top-level folder is exactly one layer', () => {
    expect(result.splitFolders).toEqual([]);
    const layersOf = new Map<string, Set<number>>();
    for (const f of files) {
      const folder = folderOf(f);
      if (!layersOf.has(folder)) layersOf.set(folder, new Set());
      layersOf.get(folder)!.add(rankOf(f));
    }
    const split = [...layersOf].filter(([, ranks]) => ranks.size !== 1).map(([folder]) => folder);
    expect(split).toEqual([]);
    expect(layersOf.size).toBe(result.folders);
  });

  it('no runtime import points up the table, and UPWARD_ALLOWANCES is empty — the fence is closed', () => {
    expect(result.upward.map((e: Edge) => `${e.from} -> ${e.to}`)).toEqual([]);
    expect(UPWARD_ALLOWANCES).toEqual([]);
    expect(result.reopenedAllowances).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('no top-level folder is in a value-level cycle', () => {
    expect(result.folderCycles).toEqual([]);
  });

  it('every upward type-only import is named and every name is live; the list has exactly TYPE_ONLY_ALLOWANCE_COUNT entries — it only shrinks', () => {
    expect(result.typeUnnamed.map((e: Edge) => `${e.from}:${e.line} -> ${e.to}`)).toEqual([]);
    expect(result.staleTypeAllowances).toEqual([]);
    expect(result.duplicateTypeAllowances).toEqual([]);
    expect(TYPE_ONLY_ALLOWANCES).toHaveLength(TYPE_ONLY_ALLOWANCE_COUNT);
  });

  it('every type-only allowance points UP the table and says why', () => {
    for (const a of TYPE_ONLY_ALLOWANCES as ReadonlyArray<Allowance>) {
      expect(rankOf(a.to), `${a.from} -> ${a.to}`).toBeGreaterThan(rankOf(a.from));
      expect(a.reason.length, `${a.from} -> ${a.to}`).toBeGreaterThan(20);
    }
  });

  it('src/lib/** and src/time/** import nothing outside themselves at run time; time/ not even by type, lib/ by type only the one named edge', () => {
    expect(CLOSED_FOLDERS).toEqual([
      { name: 'lib', files: ['src/lib/**'] },
      { name: 'time', files: ['src/time/**'] },
    ]);
    expect(result.closedEscapes).toEqual([]);
    const outOf = (dir: string) =>
      edges
        .filter((e) => e.from.startsWith(dir) && !e.to.startsWith(dir))
        .map((e) => `${e.kind}: ${e.from} -> ${e.to}`);
    expect(outOf('src/time/')).toEqual([]);
    // Erased by tsc, and named in src/lib/README.md: the slot vocabulary the protocol keys use.
    expect(outOf('src/lib/')).toEqual(['type: src/lib/conventions.ts -> src/events/types.ts']);
  });

  it('src/*.ts and the doors are barrels: `export … from` statements and nothing else', () => {
    expect(BARREL_FILES).toEqual(['src/*.ts', 'src/doors/**']);
    expect(files.filter((f) => folderOf(f) === '(root)').length).toBeGreaterThan(0);
    expect(result.barrelStatements).toEqual([]);
  });

  it('nothing below adapters/ imports it, by value or by type — the ports live in provider-contract/', () => {
    const adaptersRank = rankOf('src/adapters/llm/MockProvider.ts');
    const into = [...result.upward, ...result.typeUpward]
      .filter((e: Edge) => e.to.startsWith('src/adapters/'))
      .map((e: Edge) => `${e.from} -> ${e.to}`);
    expect(adaptersRank).toBe(13);
    expect(into).toEqual([]);
  });

  it('the layer ranks are 0..15, each used once, in order', () => {
    expect(LAYERS.map((l: { rank: number }) => l.rank)).toEqual([...Array(16).keys()]);
  });
});

// ── lint: the ESLint zones agree with the table ──────────────────────────────

describe('the ESLint zones', () => {
  const files: string[] = listSourceFiles(REPO);
  const zones = layerZones(REPO) as Array<{ target: string | string[]; from: string[] }>;
  const rel = (abs: string) =>
    abs
      .slice(REPO.length + 1)
      .split('\\')
      .join('/');

  it('every file below the top layer is the target of exactly one zone', () => {
    const targeted = zones.flatMap((z) => [z.target].flat().map(rel)).sort();
    const top = Math.max(...LAYERS.map((l: { rank: number }) => l.rank));
    expect(targeted).toEqual(files.filter((f) => rankOf(f) < top).sort());
  });

  it('forbid exactly the pairs the table forbids: every upward import not named as type-only', () => {
    const forbidden = new Set<string>();
    for (const z of zones)
      for (const t of [z.target].flat())
        for (const f of z.from) forbidden.add(`${rel(t)} -> ${rel(f)}`);
    const names = new Set(
      (TYPE_ONLY_ALLOWANCES as ReadonlyArray<Allowance>).map((a) => `${a.from} -> ${a.to}`),
    );
    const rank = new Map(files.map((f) => [f, rankOf(f) as number]));
    let expected = 0;
    const missing: string[] = [];
    for (const a of files) {
      for (const b of files) {
        const key = `${a} -> ${b}`;
        if (rank.get(b)! <= rank.get(a)! || names.has(key)) continue;
        expected++;
        if (!forbidden.has(key)) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
    expect(forbidden.size).toBe(expected);
  });

  it('the lint is LIVE: an upward import is an error, value or type; a downward or named one is not (the real config, run for real)', async () => {
    const eslint = new ESLint({ cwd: REPO });
    const lint = async (code: string, file: string) =>
      (await eslint.lintText(code, { filePath: join(REPO, file) }))[0].messages
        .filter((m) => m.ruleId === 'import/no-restricted-paths')
        .map((m) => m.ruleId);
    const upValue = "import { Agent } from '../core/Agent.js';\nexport const x = Agent;\n";
    const upType = "import type { Agent } from '../core/Agent.js';\nexport type X = Agent;\n";
    const upFolder = "import * as ie from '../injection-engine/index.js';\nexport const y = ie;\n";
    expect(await lint(upValue, 'src/lib/sleep.ts')).toEqual(['import/no-restricted-paths']);
    expect(await lint(upType, 'src/lib/sleep.ts')).toEqual(['import/no-restricted-paths']);
    expect(await lint(upFolder, 'src/lib/sleep.ts')).toEqual(['import/no-restricted-paths']);
    const down = "import { sleep } from '../lib/sleep.js';\nexport const z = sleep;\n";
    expect(await lint(down, 'src/core/Agent.ts')).toEqual([]);
    // A named type-only pair is cut out of its file's zone — and only that pair.
    const namedPair = "import type { Tool } from '../tools/tools.js';\nexport type T = Tool;\n";
    expect(await lint(namedPair, 'src/tool-lint/analyze.ts')).toEqual([]);
    expect(await lint(upValue, 'src/tool-lint/analyze.ts')).toEqual(['import/no-restricted-paths']);
  }, 60_000);
});
