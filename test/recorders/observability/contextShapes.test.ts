import { describe, expect, it, vi } from 'vitest';
import {
  createContextShapeCapture,
  markNativeShapeSource,
  type ContextShapeOptions,
} from '../../../src/recorders/observability/contextShapes.js';
import { contextShapeAt } from '../../../src/recorders/observability/contextShapes/read.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';

const row = (
  key: string,
  verb: 'set' | 'delete' | 'merge' | 'append',
  patch: object = {},
  redactedPaths: string[] = [],
) => ({
  runtimeStageId: 'change#1',
  trace: [{ path: key, verb }],
  redactedPaths,
  ...(verb === 'merge' ? { updates: patch } : { overwrite: patch }),
});
const source = (initialState: object, commitLog: readonly unknown[] = []) => ({
  runId: 'run',
  initialState,
  commitLog,
});
const shapes = (base: object, log: readonly unknown[], opts?: ContextShapeOptions) =>
  createContextShapeCapture(opts)(source(base, log)).contextShapes!;
const inventory = 'inventory';
const wrappedRecording = (snapshot: unknown, options?: Parameters<typeof recordRun>[1]) => {
  const runner = {
    on: () => () => {},
    attach: () => () => {},
    getCommitCount: () => 0,
    getLastSnapshot: () => snapshot,
    getSpec: () => ({ buildTimeStructure: {} }),
  } as unknown as Parameters<typeof recordRun>[0];
  const rec = recordRun(runner, options);
  try {
    return rec.toRecording();
  } finally {
    rec.stop();
  }
};

const wrapped = (snapshot: unknown, options?: Parameters<typeof recordRun>[1]) =>
  wrappedRecording(snapshot, options).snapshot as ReturnType<typeof source> & {
    contextShapes?: ReturnType<typeof shapes>;
  };

describe('recorded context shapes', () => {
  it('pins the complete saved recording bytes with the default index and with shapes off', () => {
    const snapshot = source({ history: ['first'] }, [
      row('history', 'append', { history: ['next'] }),
    ]);
    const index = {
      version: 1,
      initial: [[['history'], 'array', 1]],
      changes: [[0, [[['history'], 'array', 2]]]],
    };
    const previous = { snapshot, events: [], structure: {} };
    expect(JSON.stringify(wrappedRecording(snapshot, { contextShapes: false }))).toBe(
      JSON.stringify(previous),
    );
    expect(JSON.stringify(wrappedRecording(snapshot))).toBe(
      JSON.stringify({ ...previous, snapshot: { ...snapshot, contextShapes: index } }),
    );
  });

  it('withholds a hidden array type and length by default and preserves visible sibling lengths', () => {
    const index = shapes({ hidden: 'REDACTED', items: ['public'], visible: [1, 2] }, [
      row('items', 'set', { items: [1, 2, 3] }, ['items']),
    ]);
    expect(index).toEqual({
      version: 1,
      initial: [
        [['items'], 'array', 1],
        [['visible'], 'array', 2],
      ],
      changes: [[0, [[['items'], 'unknown']]]],
    });
    expect(contextShapeAt(index, 0, ['hidden'])).toEqual(['unknown']);
    expect(contextShapeAt(index, 0, ['items'])).toEqual(['unknown']);
    expect(contextShapeAt(index, 0, ['visible'])).toEqual(['array', 2]);
  });

  it('samples the seed and writes, with no traversal of arrays or unrelated nested objects', () => {
    const getter = vi.fn(() => {
      throw Error('value read');
    });
    const rows = new Array(16384);
    Object.defineProperty(rows, 0, { get: getter, enumerable: true });
    const base = {
      [inventory]: {
        rows,
        large: Object.defineProperty({}, 'names', { get: getter, enumerable: true }),
      },
      amount: 0,
    };
    const log = [
      row('amount', 'set', { amount: 3 }),
      row('amount', 'set', { amount: 'v' }),
      row('inventory\u001frows', 'append', { inventory: { rows: [1] } }),
      row('amount', 'delete'),
    ];
    expect(shapes(base, log, { paths: [[inventory, 'rows']] })).toEqual({
      version: 1,
      initial: [
        [[inventory], 'object'],
        [[inventory, 'rows'], 'array', 16384],
        [['amount'], 'number'],
      ],
      changes: [
        [1, [[['amount'], 'string']]],
        [2, [[[inventory, 'rows'], 'array', 16385]]],
        [3, [[['amount'], 'deleted']]],
      ],
    });
    expect(getter).not.toHaveBeenCalled();
    expect(shapes(base, []).initial).toEqual([
      [[inventory], 'object'],
      [['amount'], 'number'],
    ]);
  });

  it('first append, genuine length changes, nested deletion, and array-union uncertainty stay distinct', () => {
    expect(shapes({}, [row('a', 'append', { a: ['x', 'y'] })]).changes).toEqual([
      [0, [[['a'], 'array', 2]]],
    ]);
    const log = [
      row('a\u001f1', 'delete'),
      row('a\u001f4', 'set', { a: { '4': true } }),
      row('a', 'merge', { a: [true] }),
    ];
    const index = shapes({ a: [1, 2] }, log);
    expect(index.changes[0]).toEqual([
      1,
      [
        [['a'], 'array', 5],
        [['a', '4'], 'boolean'],
      ],
    ]);
    expect(index.changes[1][1]).toContainEqual([['a'], 'unknown']);
    const precise = shapes({ a: [1, 2] }, [row('a', 'merge', { a: [2, 3] })], { scan: 'full' });
    expect(precise.changes[0][1]).toContainEqual([['a'], 'array', 3]);
  });

  it('observes selected and full paths when an append establishes the entire value', () => {
    const nested = ['a', '0', 'rows'];
    const append = row('a', 'append', { a: [{ rows: [1, 2] }] });
    const masked = { ...append, redactedPaths: [nested.join('\u001f')] };
    for (const opts of [{ paths: [nested] }, { scan: 'full' } as const]) {
      for (const base of [{}, { a: false }]) {
        expect(contextShapeAt(shapes(base, [append], opts), 0, nested)).toEqual(['array', 2]);
        expect(contextShapeAt(shapes(base, [masked], opts), 0, nested)).toEqual(['unknown']);
      }
      // An unknown previous array length gives us no position for the appended element.
      const ambiguous = shapes({ a: 'REDACTED' }, [append], opts);
      expect(contextShapeAt(ambiguous, 0, nested)).toEqual(['unknown']);
      expect(contextShapeAt(ambiguous, 0, ['a'])).toEqual(['unknown']);
    }
    expect(contextShapeAt(shapes({}, [append]), 0, nested)).toEqual(['unknown']);
  });

  it('explicit and deep observations respect redaction inside a replaced parent', () => {
    const hidden = 'box\u001fsecret';
    for (const opts of [
      { scan: 'full' } as const,
      {
        paths: [
          ['box', 'secret'],
          ['box', 'secret', 'token'],
          ['box', 'safe'],
        ],
      },
    ]) {
      const result = shapes(
        { box: { secret: 'old', safe: 'x' } },
        [row('box', 'set', { box: { secret: ['never retain this length'], safe: [] } }, [hidden])],
        opts,
      );
      expect(result.changes[0][1]).toContainEqual([['box', 'secret'], 'unknown']);
      expect(result.changes[0][1]).toContainEqual([['box', 'safe'], 'array', 0]);
      expect(result.changes[0][1]).not.toContainEqual([['box', 'secret'], 'array', 1]);
    }
    expect(shapes({ a: 'REDACTED', b: '[REDACTED]' }, [], { scan: 'full' }).initial).toEqual([]);
  });

  it('keeps hidden fields unknown through merges and nested writes until a public replacement', () => {
    const secret = ['a', 'secret'];
    const leaf = [...secret, '0'];
    const safe = ['a', 'safe'];
    const log = [
      row('a', 'set', { a: { secret: [1, 2, 3], safe: 4 } }, ['a\u001fsecret']),
      row('a', 'merge', { a: { safe: 5 } }),
      row('a\u001fsecret\u001f0', 'set', { a: { secret: { '0': 9 } } }),
      row('a\u001fsecret', 'set', { a: { secret: [8] } }),
    ];
    for (const options of [{ scan: 'full' } as const, { paths: [secret, leaf, safe] }]) {
      const index = shapes({ a: { secret: 'old', safe: 'old' } }, log, options);
      for (const commit of [0, 1, 2]) {
        expect(contextShapeAt(index, commit, secret)).toEqual(['unknown']);
        expect(contextShapeAt(index, commit, leaf)).toEqual(['unknown']);
      }
      expect(contextShapeAt(index, 0, safe)).toEqual(['number']);
      expect(contextShapeAt(index, 3, secret)).toEqual(['array', 1]);
      expect(contextShapeAt(index, 3, leaf)).toEqual(['number']);
      expect(contextShapeAt(index, -1, secret)).toEqual(['string']);
    }
  });

  it('keeps masks in place when the native fold ignores a denied write', () => {
    const path = ['a', '__proto__', 'secret'];
    const patch = { a: { ['__proto__']: { secret: [1, 2, 3] }, safe: 0 } };
    const log = [
      row('a', 'set', patch, [path.join('\u001f')]),
      row(path.join('\u001f'), 'set', patch),
      row('a', 'merge', { a: { safe: 1 } }),
    ];
    for (const options of [{ scan: 'full' } as const, { paths: [path] }]) {
      const index = shapes({}, log, options);
      for (const commit of [0, 1, 2])
        expect(contextShapeAt(index, commit, path)).toEqual(['unknown']);
    }
  });

  it('withholds element facts when a masked array operand has ambiguous final indices', () => {
    const arr = ['a'];
    const secret = ['a', '2', 'secret'];
    const leaf = [...secret, '0'];
    const log = [
      row('a', 'append', { a: [{ secret: [1, 2, 3] }] }, ['a\u001f0\u001fsecret']),
      row('other', 'merge', { other: { count: 1 } }),
      row('a', 'append', { a: [true] }),
      row('a', 'set', { a: [1, 2, { secret: [] }] }),
    ];
    for (const options of [{ scan: 'full' } as const, { paths: [secret, leaf, ['a', '0']] }]) {
      const index = shapes({ a: [1, 2] }, log, options);
      expect(contextShapeAt(index, -1, ['a', '0'])).toEqual(['number']);
      for (const commit of [0, 1, 2]) {
        expect(contextShapeAt(index, commit, secret)).toEqual(['unknown']);
        expect(contextShapeAt(index, commit, leaf)).toEqual(['unknown']);
        expect(contextShapeAt(index, commit, ['a', '0'])).toEqual(['unknown']);
        expect(contextShapeAt(index, commit, arr)).toEqual(['array', commit === 2 ? 4 : 3]);
      }
      expect(contextShapeAt(index, 3, secret)).toEqual(['array', 0]);
    }
  });

  it('keeps element masks when an array merge can change their positions', () => {
    const secret = ['a', '0', 'secret'];
    const sibling = ['a', '0', 'label'];
    const log = [
      row('a', 'set', { a: [{ secret: [1, 2, 3], label: 0 }] }, [secret.join('\u001f')]),
      row('a', 'merge', { a: [{ label: 1 }] }),
      row('a', 'merge', { a: [{ label: 2 }] }),
    ];
    for (const options of [{ scan: 'full' } as const, { paths: [secret, sibling] }]) {
      const index = shapes({ a: [] }, log, options);
      expect(contextShapeAt(index, 0, sibling)).toEqual(['number']);
      for (const commit of [1, 2]) {
        expect(contextShapeAt(index, commit, secret)).toEqual(['unknown']);
        expect(contextShapeAt(index, commit, sibling)).toEqual(['unknown']);
      }
    }
  });

  it('only discovers JSON array indices from initial, assigned, and appended arrays', () => {
    const decorated = Object.assign([1], { tag: [1, 2], '01': 'extra' });
    const extras = ['tag', 'length', 'NaN', '01'].map((key) => ['a', key]);
    const log = [
      row('a', 'set', { a: decorated }),
      row('a', 'append', { a: decorated }),
      row('a\u001ftag', 'set', { a: { tag: true } }),
    ];
    for (const options of [
      { scan: 'full' } as const,
      { paths: [...extras, ['a', '0'], ['a', '1']] },
    ]) {
      const index = shapes({ a: decorated }, log, options);
      for (const commit of [-1, 0, 1, 2])
        for (const path of extras) expect(contextShapeAt(index, commit, path)).toEqual(['unknown']);
      expect(contextShapeAt(index, 1, ['a'])).toEqual(['array', 2]);
      expect(contextShapeAt(index, 1, ['a', '1'])).toEqual(['number']);
    }
  });

  it('captures after embedding retention; opt out preserves the original snapshot', () => {
    const snapshot = source({ embedding: [3, 4] });
    expect(wrapped(snapshot).contextShapes?.initial).toEqual([[['embedding'], 'object']]);
    expect(wrapped(snapshot, { recordEmbeddings: true }).contextShapes?.initial).toEqual([
      [['embedding'], 'array', 2],
    ]);
    expect(wrapped(snapshot, { recordEmbeddings: true, contextShapes: false })).toBe(snapshot);
    expect(wrapped({ commitLog: [] }).contextShapes).toBeUndefined();
  });

  it('rejects incomplete logs and resets a corrected immutable prefix', () => {
    expect(
      createContextShapeCapture()(source({}, [row('a', 'set', { a: 1 }), null])).contextShapes,
    ).toBeUndefined();
    const base = Object.freeze({ a: 0 });
    const first = Object.freeze(row('a', 'set', { a: [1] }));
    const last = Object.freeze(row('b', 'set', { b: true }));
    const capture = createContextShapeCapture();
    const old = capture(markNativeShapeSource(source(base, Object.freeze([first, last]))))
      .contextShapes!;
    const updated = capture(
      markNativeShapeSource(
        source(base, Object.freeze([Object.freeze(row('a', 'set', { a: [1, 2, 3] })), last])),
      ),
    ).contextShapes!;
    expect(old.changes[0][1]).toEqual([[['a'], 'array', 1]]);
    expect(updated.changes[0][1]).toEqual([[['a'], 'array', 3]]);
    const arr: number[] = [];
    const duck = source(Object.freeze({ arr }), Object.freeze([]));
    expect(capture(duck).contextShapes?.initial).toEqual([[['arr'], 'array', 0]]);
    arr.push(1);
    expect(capture(duck).contextShapes?.initial).toEqual([[['arr'], 'array', 1]]);
  });
});
