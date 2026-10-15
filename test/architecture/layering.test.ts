/**
 * THE FENCE — tests for `scripts/check-layering.mjs` + `scripts/layering.config.cjs`.
 *
 *   unit      the matcher: the most specific pattern wins, an equal tie is an error
 *   boundary  small fixture trees: every way the analysis must say FAIL, and the ways it must not
 *   scenario  THE REAL TREE: every src file has exactly one layer, every upward runtime edge is
 *             on the allowance list, and no allowance outlives its edge
 *
 * WHAT A GREEN RUN PROVES: no NEW upward runtime import has arrived since the table was
 * written, and the allowance list is exactly the set of upward edges that remain — it can
 * only shrink. WHAT IT DOES NOT PROVE: that the tree is acyclic. The folder-level value
 * cycle is reported (`node scripts/check-layering.mjs --json` → `folderCycles`), not failed,
 * until the allowance list is empty.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { analyse, format } from '../../scripts/check-layering.mjs';
import layering from '../../scripts/layering.config.cjs';

const { LAYERS, CLOSED_FOLDERS, UPWARD_ALLOWANCES, compileLayers, rankOf, listSourceFiles } =
  layering;
const REPO = resolve(__dirname, '../..');

/**
 * THE RATCHET — the exact length of UPWARD_ALLOWANCES. The checker refuses an allowance whose
 * edge is gone; this refuses one that was ADDED. A change that frees edges deletes their
 * entries and lowers this number in the same commit; nothing raises it.
 */
const ALLOWANCE_COUNT = 4;

// ── fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_LAYERS = [
  { rank: 0, name: 'low', files: ['src/low/**'] },
  { rank: 1, name: 'mid', files: ['src/mid/**'] },
  { rank: 2, name: 'high', files: ['src/high/**'] },
  { rank: 3, name: 'entry', files: ['src/*.ts'] },
];
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Build a tree of `{ 'src/low/a.ts': 'source' }` under a temp dir and analyse it. */
function run(tree: Record<string, string>, config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'af-layering-'));
  made.push(root);
  for (const [file, source] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  return analyse({
    root,
    config: { layers: FIXTURE_LAYERS, upwardAllowances: [], closedFolders: [], ...config },
  });
}

// ── unit: the matcher ────────────────────────────────────────────────────────

describe('layering config — which layer a file is in', () => {
  const layers = compileLayers([
    { rank: 9, name: 'dir', files: ['src/core/**'] },
    { rank: 0, name: 'leaf', files: ['src/core/agent/emptiness.ts'] },
    { rank: 1, name: 'deeper dir', files: ['src/semantics/coverage/**'] },
  ]);

  it('an exact path beats a directory glob, and a deeper directory beats a shallower one', () => {
    expect(rankOf('src/core/Agent.ts', layers)).toBe(9);
    expect(rankOf('src/semantics/coverage/absent.ts', layers)).toBe(1);
    expect(rankOf('src/core/agent/emptiness.ts', layers)).toBe(0);
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

  it('an upward value import that is not allowed fails, naming the line', () => {
    const r = run({
      'src/low/a.ts': "import { b } from '../high/b.js';\nexport const a = b;",
      'src/high/b.ts': 'export const b = 1;',
    });
    expect(r.ok).toBe(false);
    expect(r.upwardUnnamed).toMatchObject([{ from: 'src/low/a.ts', to: 'src/high/b.ts', line: 1 }]);
    expect(format(r)).toMatch(/NOT ALLOWED/);
  });

  it('the same import on the allowance list passes', () => {
    const r = run(
      {
        'src/low/a.ts': "import { b } from '../high/b.js';\nexport const a = b;",
        'src/high/b.ts': 'export const b = 1;',
      },
      { upwardAllowances: [['src/low/a.ts', 'src/high/b.ts']] },
    );
    expect(r.ok).toBe(true);
    expect(r.upward).toHaveLength(1);
  });

  it('a lazy `import()` is an upward edge too', () => {
    const r = run({
      'src/low/a.ts': "export const load = () => import('../high/b.js');",
      'src/high/b.ts': 'export const b = 1;',
    });
    expect(r.ok).toBe(false);
    expect(r.upwardUnnamed[0]).toMatchObject({ kind: 'dynamic' });
  });

  it('a type-only upward import is reported, never failed — `import type`, an elided import, `import("x").T`', () => {
    const r = run({
      'src/low/a.ts':
        "import type { B } from '../high/b.js';\n" +
        "import { C } from '../high/c.js';\n" +
        'export type A = B | C;\n' +
        "export type D = import('../high/d.js').D;",
      'src/high/b.ts': 'export type B = 1;',
      'src/high/c.ts': 'export type C = 2;',
      'src/high/d.ts': 'export type D = 3;',
    });
    expect(r.ok).toBe(true);
    expect(r.typeUpward.map((e: { to: string }) => e.to).sort()).toEqual([
      'src/high/b.ts',
      'src/high/c.ts',
      'src/high/d.ts',
    ]);
  });

  it('an `index.ts` behind a folder specifier resolves', () => {
    const r = run({
      'src/low/a.ts': "import { b } from '../high/index.js';\nexport const a = b;",
      'src/high/index.ts': 'export const b = 1;',
    });
    expect(r.upwardUnnamed).toMatchObject([{ to: 'src/high/index.ts' }]);
  });

  it('an allowance whose import is gone is stale, and stale fails — the list only shrinks', () => {
    const r = run(
      { 'src/low/a.ts': 'export const a = 1;', 'src/high/b.ts': 'export const b = 1;' },
      { upwardAllowances: [['src/low/a.ts', 'src/high/b.ts']] },
    );
    expect(r.ok).toBe(false);
    expect(r.staleAllowances).toMatchObject([{ why: 'no such import exists any more' }]);
  });

  it('an allowance whose import became type-only is stale', () => {
    const r = run(
      {
        'src/low/a.ts': "import type { B } from '../high/b.js';\nexport type A = B;",
        'src/high/b.ts': 'export type B = 1;',
      },
      { upwardAllowances: [['src/low/a.ts', 'src/high/b.ts']] },
    );
    expect(r.ok).toBe(false);
    expect(r.staleAllowances).toMatchObject([{ why: 'is type-only now — not a runtime edge' }]);
  });

  it('an allowance for an edge that is downward under the table is stale', () => {
    const r = run(
      {
        'src/high/a.ts': "import { b } from '../low/b.js';\nexport const a = b;",
        'src/low/b.ts': 'export const b = 1;',
      },
      { upwardAllowances: [['src/high/a.ts', 'src/low/b.ts']] },
    );
    expect(r.ok).toBe(false);
    expect(r.staleAllowances).toMatchObject([{ why: 'is no longer upward under the table' }]);
  });

  it('a duplicated allowance fails', () => {
    const r = run(
      {
        'src/low/a.ts': "import { b } from '../high/b.js';\nexport const a = b;",
        'src/high/b.ts': 'export const b = 1;',
      },
      {
        upwardAllowances: [
          ['src/low/a.ts', 'src/high/b.ts'],
          ['src/low/a.ts', 'src/high/b.ts'],
        ],
      },
    );
    expect(r.ok).toBe(false);
    expect(r.duplicateAllowances).toHaveLength(1);
  });

  it('a file no layer pattern matches fails', () => {
    const r = run({ 'src/elsewhere/a.ts': 'export const a = 1;' });
    expect(r.ok).toBe(false);
    expect(r.unassigned).toEqual(['src/elsewhere/a.ts']);
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

  it('a folder-level cycle is reported with its members, and does not fail on its own', () => {
    const r = run(
      {
        'src/low/a.ts': "import { b } from '../high/b.js';\nexport const a = () => b;",
        'src/high/b.ts': "import { a } from '../low/a.js';\nexport const b = () => a;",
      },
      { upwardAllowances: [['src/low/a.ts', 'src/high/b.ts']] },
    );
    expect(r.ok).toBe(true);
    expect(r.folderCycles).toEqual([['high', 'low']]);
    expect(r.fileCycles).toHaveLength(1);
  });

  it('the root `src/*.ts` modules are one folder node, `(root)`', () => {
    const r = run(
      {
        'src/index.ts': "export { a } from './low/a.js';",
        'src/low/a.ts': "import { c } from '../conventions.js';\nexport const a = c;",
        'src/conventions.ts': 'export const c = 1;',
      },
      { upwardAllowances: [['src/low/a.ts', 'src/conventions.ts']] },
    );
    expect(r.folderCycles).toEqual([['(root)', 'low']]);
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

// ── scenario: the real tree ──────────────────────────────────────────────────

describe('check-layering — this repository', () => {
  const result = analyse({ root: REPO });

  it('every src file is placed in exactly one layer', () => {
    expect(result.unassigned).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.files).toBe(listSourceFiles(REPO).length);
  });

  it('every upward runtime edge is on the allowance list, and every allowance is a live upward edge', () => {
    expect(
      result.upwardUnnamed.map((e: { from: string; to: string }) => `${e.from} -> ${e.to}`),
    ).toEqual([]);
    expect(result.staleAllowances).toEqual([]);
    expect(result.duplicateAllowances).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("lib's leaves and the time layer import nothing in src/ outside themselves — the closed-folder rule is on", () => {
    const closed = CLOSED_FOLDERS.map((c: { name: string }) => c.name);
    expect(closed).toContain('lib (the leaves)');
    expect(closed).toContain('time');
    expect(result.closedEscapes).toEqual([]);
  });

  it('nothing below adapters/ imports it, by value or by type — the ports live in provider-contract/', () => {
    const compiled = compileLayers(LAYERS);
    const adaptersRank = rankOf('src/adapters/llm/MockProvider.ts', compiled);
    const into = [...result.upward, ...result.typeUpward]
      .filter((e: { to: string }) => e.to.startsWith('src/adapters/'))
      .map((e: { from: string; to: string }) => `${e.from} -> ${e.to}`);
    expect(adaptersRank).toBe(13);
    expect(into).toEqual([]);
  });

  it('the allowance list has exactly ALLOWANCE_COUNT entries — it only shrinks', () => {
    expect(UPWARD_ALLOWANCES).toHaveLength(ALLOWANCE_COUNT);
  });

  it('every allowance points UP the table — the list never names a legal edge', () => {
    const compiled = compileLayers(LAYERS);
    for (const [from, to] of UPWARD_ALLOWANCES as ReadonlyArray<readonly [string, string]>) {
      expect(rankOf(to, compiled), `${from} -> ${to}`).toBeGreaterThan(rankOf(from, compiled));
    }
  });

  it('the layer ranks are 0..15, each used once, in order', () => {
    expect(LAYERS.map((l: { rank: number }) => l.rank)).toEqual([...Array(16).keys()]);
  });
});
