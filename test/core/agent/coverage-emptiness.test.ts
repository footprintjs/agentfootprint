/**
 * The ONE emptiness reader — `core/agent/coverage/emptiness.ts` · `readEmptiness`.
 *
 * Test types:
 *   - UNIT        — every route of the table, in its order; the door decides
 *                   when the record holds one; the value decides only when it
 *                   holds none (`declaredByValue`: the absence, the boundary
 *                   and the gaps its envelope lists); `coverage()` read through
 *                   (nested, bounded);
 *                   a described envelope's counts and its clarify-only form;
 *                   the `rowsAt` rule (`rowsAtProblem`); rows that travel by
 *                   reference — the dataset ticket left where the app's rows
 *                   were, counted; a ticket with no count, the library's
 *                   placement ticket, a declared key with no list: never
 *                   guessed, and never said "not declared";
 *   - PROPERTY    — over 2,000 generated values and doors: never throws, is
 *                   deterministic, never mutates its input, never calls a
 *                   declared absence into being without an absence (the door's
 *                   or, door-less, the recognizer's), and — for an OBJECT the
 *                   run recognized — the door-less reading equals the door
 *                   reading (the two callers cannot disagree about a real run);
 *   - SECURITY    — a JSON-text envelope the run did not recognize is plain
 *                   data when a door is held (a marker in the bytes is not a
 *                   declaration); a self-bounding cycle stops, never recurses
 *                   forever;
 *   - FUNCTIONAL  — the two callers (the answer account, the standing fold)
 *                   import this one function.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { absent, coverage } from '../../../src/index.js';
import { placedToolResult } from '../../../src/artifacts/placement.js';
import {
  declaredByValue,
  readEmptiness,
  rowsAtProblem,
  type ReturnedDoor,
} from '../../../src/core/agent/coverage/emptiness.js';

const NONE: ReturnedDoor = { absent: false, bounded: false };
const found = absent({ what: 'VMs on host-9', checked: ['the VM inventory'] });

describe('UNIT — the routes, in order', () => {
  it('an absence the door declares → declared-absent (whatever the bytes)', () => {
    expect(readEmptiness('not even json', { door: { absent: true, bounded: false } })).toEqual({
      emptiness: 'declared-absent',
      undeclaredShape: false,
    });
  });

  it('door-less: the strict recognizer reads the value (an earlier answer’s result)', () => {
    expect(readEmptiness(JSON.stringify(found)).emptiness).toBe('declared-absent');
    // …and refuses a malformed marker (`checked` empty) — plain data, an undeclared shape.
    expect(readEmptiness({ af_absent: true, checked: [] })).toEqual({
      emptiness: 'unknown',
      undeclaredShape: true,
    });
  });

  it('a described envelope the record keeps: non-empty, counted per kind, library-counted', () => {
    const envelope = {
      af_semantics: true,
      facts: [{ entity: 'job-1' }, { entity: 'job-2' }],
      series: [{ t: 1 }],
      note: 'n',
    };
    expect(
      readEmptiness({ facts: 'projection' }, { door: { ...NONE, described: envelope } }),
    ).toEqual({
      emptiness: 'non-empty',
      source: 'library',
      described: { facts: 2, series: 1 },
      undeclaredShape: false,
    });
  });

  it('a described envelope with only clarify → clarify; one that cannot be read falls through', () => {
    const clarify = { af_semantics: true, clarify: { question: 'which one?', candidates: [] } };
    expect(readEmptiness({}, { door: { ...NONE, described: clarify } }).emptiness).toBe('clarify');
    expect(readEmptiness([], { door: { ...NONE, described: 'garbage' } }).emptiness).toBe(
      'undeclared-empty',
    );
  });

  it('a coverage() the door holds: its wrapped rowset read through, marked bounded', () => {
    const rows = coverage([{ id: 'p1' }, { id: 'p2' }], { checked: ['switch A'] });
    expect(readEmptiness(rows, { door: { absent: false, bounded: true } })).toEqual({
      emptiness: 'non-empty',
      rows: 2,
      source: 'library',
      countedAt: ['result'],
      bounded: true,
      undeclaredShape: false,
    });
  });

  it('an EMPTY rowset inside a declared boundary is a declared absence — the same meaning', () => {
    const empty = coverage([], { checked: ['switch A'] });
    expect(
      readEmptiness(JSON.stringify(empty), { door: { absent: false, bounded: true } }),
    ).toEqual({
      emptiness: 'declared-absent',
      rows: 0,
      source: 'library',
      countedAt: ['result'],
      bounded: true,
      undeclaredShape: false,
    });
    // The app's rowsAt reads the wrapped object too — app-counted.
    const wrapped = coverage({ volumes: [] }, { checked: ['array A1'] });
    expect(
      readEmptiness(wrapped, { rowsAt: 'volumes', door: { absent: false, bounded: true } }),
    ).toMatchObject({
      emptiness: 'declared-absent',
      source: 'app',
      rowsAt: 'volumes',
      bounded: true,
    });
  });

  it('coverage(coverage(…)) nests; coverage(absent()) door-less is an absence', () => {
    const inner = coverage([], { checked: ['inner'] });
    const outer = coverage(inner, { checked: ['outer'] });
    expect(readEmptiness(outer).emptiness).toBe('declared-absent');
    expect(readEmptiness(coverage(found, { checked: ['bound'] }))).toMatchObject({
      emptiness: 'declared-absent',
      bounded: true,
    });
  });

  it('the bare routes: a top-level array (library), the app’s rowsAt (app), anything else unknown', () => {
    expect(readEmptiness('[]')).toEqual({
      emptiness: 'undeclared-empty',
      rows: 0,
      source: 'library',
      countedAt: [],
      undeclaredShape: false,
    });
    expect(readEmptiness([1, 2, 3])).toMatchObject({ emptiness: 'non-empty', rows: 3 });
    expect(readEmptiness({ volumes: [] }, { rowsAt: 'volumes' })).toMatchObject({
      emptiness: 'undeclared-empty',
      source: 'app',
      rowsAt: 'volumes',
    });
    expect(readEmptiness({ volumes: [] })).toEqual({ emptiness: 'unknown', undeclaredShape: true });
    expect(readEmptiness('Error: host not found')).toEqual({
      emptiness: 'unknown',
      undeclaredShape: false,
    });
    expect(readEmptiness(42)).toEqual({ emptiness: 'unknown', undeclaredShape: false });
    expect(readEmptiness('[not json')).toEqual({ emptiness: 'unknown', undeclaredShape: false });
  });

  it('strings INSIDE the value are the tool’s — never parsed (only the top level is)', () => {
    const wrapped = coverage('[]', { checked: ['x'] });
    expect(readEmptiness(wrapped).emptiness).toBe('unknown');
  });

  it('declaredByValue — what a value’s own envelope declares, by the run’s recognizer rule', () => {
    const gap = absent({ what: 'VMs', checked: ['inventory'], notChecked: ['off VMs'] });
    // A bare absence, with and without a gap — JSON text reads the same as the object.
    expect(declaredByValue(found)).toEqual({ absent: true, bounded: false, gap: false });
    expect(declaredByValue(JSON.stringify(gap))).toEqual({
      absent: true,
      bounded: false,
      gap: true,
    });
    // A boundary: its own gap, or the gap of the absence directly inside it.
    expect(declaredByValue(coverage([1], { checked: ['a'] }))).toEqual({
      absent: false,
      bounded: true,
      gap: false,
    });
    expect(
      declaredByValue(coverage([1], { checked: ['a'], cannotCover: [{ what: 'x', why: 'y' }] })),
    ).toEqual({
      absent: false,
      bounded: true,
      gap: true,
    });
    expect(declaredByValue(coverage(gap, { checked: ['a'] }))).toEqual({
      absent: true,
      bounded: true,
      gap: true,
    });
    // Neither envelope — or a marker the strict recognizer refuses — declares nothing.
    for (const v of [[], [1], 'text', '{"af_absent":true,"checked":[]}', null, { rows: [] }]) {
      expect(declaredByValue(v), JSON.stringify(v)).toBeUndefined();
    }
  });

  it('rowsAtProblem — the one rule both readers’ declarations are checked by', () => {
    expect(rowsAtProblem('volumes')).toBeUndefined();
    expect(rowsAtProblem('')).toBe('empty');
    expect(rowsAtProblem(3)).toBe('empty');
    expect(rowsAtProblem('a.b')).toBe('nested');
    expect(rowsAtProblem('a/b')).toBe('nested');
  });
});

describe('UNIT — rows that travel by reference (take 4 of the demo video)', () => {
  const REF = 'art_AbCdEfGhIjKlMnOpQrStUv';
  const ticket = (extra: Record<string, unknown> = {}) => ({
    ref: REF,
    kind: 'dataset/rows',
    rows: 2,
    sourceField: 'rows',
    ...extra,
  });
  /** The field result the model read: the rows staged, the ticket left in their place. */
  const field = (t: Record<string, unknown> = ticket()) =>
    coverage(
      { cluster: 'cluster-a', clients: 2, dataset: t, datasets: { rows: t } },
      { checked: ['ps_client over the window asked'] },
    );
  const BOUNDED = { door: { absent: false, bounded: true }, rowsAt: 'rows' } as const;

  it('the ticket left where the app’s rows were is counted — app-counted, through the boundary', () => {
    expect(readEmptiness(field(), BOUNDED)).toEqual({
      emptiness: 'non-empty',
      rows: 2,
      source: 'app',
      rowsAt: 'rows',
      countedAt: ['result', 'datasets', 'rows', 'rows'],
      bounded: true,
      undeclaredShape: false,
    });
    // JSON text (a history message) reads the same; door-less, the run's recognizer rule.
    expect(readEmptiness(JSON.stringify(field()), { rowsAt: 'rows' })).toMatchObject({
      emptiness: 'non-empty',
      rows: 2,
      countedAt: ['result', 'datasets', 'rows', 'rows'],
    });
  });

  it('the principal `dataset` alone, naming the key — and a count of 0 is empty', () => {
    expect(readEmptiness({ dataset: ticket() }, { rowsAt: 'rows' })).toMatchObject({
      emptiness: 'non-empty',
      rows: 2,
      countedAt: ['dataset', 'rows'],
    });
    expect(
      readEmptiness({ datasets: { rows: ticket({ rows: 0 }) } }, { rowsAt: 'rows' }),
    ).toMatchObject({ emptiness: 'undeclared-empty', rows: 0, source: 'app' });
    // Inside a declared boundary an empty rowset is a declared absence — the ticket's too.
    expect(readEmptiness(field(ticket({ rows: 0 })), BOUNDED)).toMatchObject({
      emptiness: 'declared-absent',
      rows: 0,
      bounded: true,
    });
  });

  it('NEVER GUESSED: a ticket with no whole-number count says so — not "undeclared"', () => {
    for (const rows of [undefined, '2', 2.5, -1, null]) {
      expect(readEmptiness(field(ticket({ rows })), BOUNDED), String(rows)).toEqual({
        emptiness: 'unknown',
        rowsAt: 'rows',
        bounded: true,
        undeclaredShape: false,
        rowsUnread: 'uncounted-ticket',
      });
    }
  });

  it('read only for the DECLARED key, only when the rows moved, only when the ticket names it', () => {
    const noList = {
      emptiness: 'unknown',
      rowsAt: 'rows',
      undeclaredShape: false,
      rowsUnread: 'no-list',
    };
    // A ticket for another field is not this key's.
    expect(
      readEmptiness({ datasets: { rows: ticket({ sourceField: 'nodes' }) } }, { rowsAt: 'rows' }),
    ).toEqual(noList);
    expect(
      readEmptiness({ dataset: ticket({ sourceField: 'nodes' }) }, { rowsAt: 'rows' }),
    ).toEqual(noList);
    // The principal ticket must NAME the key; under `datasets` the key itself names it.
    expect(
      readEmptiness({ dataset: ticket({ sourceField: undefined }) }, { rowsAt: 'rows' }),
    ).toEqual(noList);
    expect(
      readEmptiness({ datasets: { rows: ticket({ sourceField: undefined }) } }, { rowsAt: 'rows' }),
    ).toMatchObject({ emptiness: 'non-empty', rows: 2 });
    // Not a store ref → not a ticket.
    expect(
      readEmptiness({ datasets: { rows: ticket({ ref: 'rows.json' }) } }, { rowsAt: 'rows' }),
    ).toEqual(noList);
    // A key set to `undefined` is gone: the live value reads as its JSON does (the history).
    const dropped = { rows: undefined, datasets: { rows: ticket() } };
    expect(readEmptiness(dropped, { rowsAt: 'rows' })).toMatchObject({
      emptiness: 'non-empty',
      rows: 2,
    });
    expect(readEmptiness(dropped, { rowsAt: 'rows' })).toEqual(
      readEmptiness(JSON.stringify(dropped), { rowsAt: 'rows' }),
    );
    // The key still in the value is read as the value holds it — a ticket BESIDE rows is not read.
    expect(
      readEmptiness({ rows: 'two', datasets: { rows: ticket() } }, { rowsAt: 'rows' }),
    ).toEqual(noList);
    expect(
      readEmptiness({ rows: [], datasets: { rows: ticket() } }, { rowsAt: 'rows' }),
    ).toMatchObject({ emptiness: 'undeclared-empty', rows: 0, countedAt: ['rows'] });
    // With no rowsAt, a ticket is never a declaration: the shape is not declared.
    expect(readEmptiness({ datasets: { rows: ticket() } })).toEqual({
      emptiness: 'unknown',
      undeclaredShape: true,
    });
    // Own keys only: `__proto__` is read when the value holds it as data, never off the prototype.
    expect(readEmptiness({ datasets: {} }, { rowsAt: '__proto__' })).toMatchObject({
      emptiness: 'unknown',
      rowsUnread: 'no-list',
    });
    const own = ticket({ sourceField: '__proto__' });
    expect(
      readEmptiness(JSON.parse(`{"datasets":{"__proto__":${JSON.stringify(own)}}}`), {
        rowsAt: '__proto__',
      }),
    ).toMatchObject({
      emptiness: 'non-empty',
      rows: 2,
      countedAt: ['datasets', '__proto__', 'rows'],
    });
  });

  it('the library’s own placement ticket counts bytes, never rows — said, with or without rowsAt', () => {
    const placed = placedToolResult(
      'pscale_client_health',
      {
        ref: REF,
        kind: 'tool-result/pscale_client_health',
        mediaType: 'application/json',
        bytes: 900,
      } as never,
      900,
      100,
    );
    for (const context of [{}, { rowsAt: 'rows' }, BOUNDED]) {
      expect(readEmptiness(placed, context), JSON.stringify(context)).toMatchObject({
        emptiness: 'unknown',
        undeclaredShape: false,
        rowsUnread: 'uncounted-ticket',
      });
    }
  });
});

describe('SECURITY — a marker in the bytes is not a declaration', () => {
  it('with a door held: a JSON-text envelope the run never recognized is plain data', () => {
    // An mcpClient in text mode hands the model this string; the run filed no row for it.
    const text = JSON.stringify(found);
    expect(readEmptiness(text, { door: NONE })).toEqual({
      emptiness: 'unknown',
      undeclaredShape: true,
    });
    const bounded = JSON.stringify(coverage([], { checked: ['a'] }));
    expect(readEmptiness(bounded, { door: NONE })).toEqual({
      emptiness: 'unknown',
      undeclaredShape: true,
    });
  });

  it('a ledger that bounds ITSELF stops at the depth bound — never a stack overflow', () => {
    const self: Record<string, unknown> = { af_coverage: { checked: [{ what: 'x' }] } };
    self.result = self;
    expect(readEmptiness(self).emptiness).toBe('unknown');
  });
});

describe('PROPERTY — total, deterministic, pure; the two callers agree on a real run', () => {
  // A small seeded generator (mulberry32): reproducible, no dependency.
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const next = rng(20260927);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  function value(depth = 0): unknown {
    const leaves = [[], [1], [{ a: 1 }, { b: 2 }], 'x', '', 0, null, true, { volumes: [] }];
    if (depth > 2) return pick(leaves);
    switch (Math.floor(next() * 6)) {
      case 0:
        return absent({ what: 'w', checked: ['c'] });
      case 1:
        return coverage(value(depth + 1), { checked: ['c'] });
      case 2:
        return JSON.stringify(value(depth + 1));
      case 3:
        return { af_absent: pick([true, false]), checked: pick([[], ['c']]) };
      default:
        return pick(leaves);
    }
  }
  /** The door a RUN would file for this value: the dispatch recognizes objects only. */
  function runDoor(v: unknown): ReturnedDoor {
    const obj = typeof v === 'object' && v !== null && !Array.isArray(v);
    const isAbsent =
      obj && (v as Record<string, unknown>).af_absent === true
        ? Array.isArray((v as Record<string, unknown>).checked) &&
          ((v as Record<string, unknown>).checked as unknown[]).length > 0
        : false;
    const isLedger =
      obj &&
      typeof (v as Record<string, unknown>).af_coverage === 'object' &&
      'result' in (v as object);
    const innerAbsent =
      isLedger &&
      (() => {
        const r = (v as Record<string, unknown>).result as Record<string, unknown> | undefined;
        return (
          typeof r === 'object' &&
          r !== null &&
          r.af_absent === true &&
          Array.isArray(r.checked) &&
          r.checked.length > 0
        );
      })();
    return { absent: isAbsent || innerAbsent, bounded: isLedger };
  }

  it('2,000 values × {no door, the run’s door, no declaration}', () => {
    let absences = 0;
    for (let i = 0; i < 2000; i++) {
      const v = value();
      const frozen = JSON.stringify(v);
      const doors: (ReturnedDoor | undefined)[] = [undefined, runDoor(v), NONE];
      for (const door of doors) {
        const context = door === undefined ? {} : { door };
        const a = readEmptiness(v, context);
        const b = readEmptiness(v, context);
        expect(b).toEqual(a); // deterministic
        expect(JSON.stringify(v)).toBe(frozen); // pure
        if (door !== undefined && !door.absent && !door.bounded) {
          // No declaration held → never a declared absence.
          expect(a.emptiness).not.toBe('declared-absent');
        }
        if (a.emptiness === 'declared-absent') absences += 1;
      }
      // An OBJECT the run recognized: the door-less reading (an earlier answer's result, read
      // from its history text) equals the door reading (this run's call) — one rule, two callers.
      if (typeof v === 'object' && v !== null) {
        expect(readEmptiness(JSON.stringify(v))).toEqual(readEmptiness(v, { door: runDoor(v) }));
      }
    }
    expect(absences).toBeGreaterThan(200); // both halves of the property were exercised
  });
});

describe('FUNCTIONAL — one reader, two callers', () => {
  it('the answer account and the standing fold both import it; neither keeps its own', () => {
    const src = resolve(__dirname, '../../../src');
    const common = readFileSync(`${src}/lib/answer-account/facts/common.ts`, 'utf8');
    const fold = readFileSync(`${src}/core/agent/assessment/assess.ts`, 'utf8');
    expect(common).toMatch(/from '\.\.\/\.\.\/\.\.\/core\/agent\/coverage\/emptiness\.js'/);
    expect(fold).toMatch(/from '\.\.\/coverage\/emptiness\.js'/);
    // No second implementation of the routes anywhere in either caller.
    for (const text of [common, fold]) expect(text).not.toMatch(/undeclared-empty', rows: 0/);
  });
});
