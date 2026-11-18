import { describe, expect, it, vi } from 'vitest';
import {
  createContextShapeCapture,
  markNativeShapeSource,
  type ContextShapeOptions,
} from '../../../src/recorders/observability/contextShapes.js';
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
const wrapped = (snapshot: unknown, options?: Parameters<typeof recordRun>[1]) => {
  const runner = {
    on: () => () => {},
    attach: () => () => {},
    getCommitCount: () => 0,
    getLastSnapshot: () => snapshot,
    getSpec: () => ({ buildTimeStructure: {} }),
  } as unknown as Parameters<typeof recordRun>[0];
  const rec = recordRun(runner, options);
  try {
    return rec.toRecording().snapshot as ReturnType<typeof source> & {
      contextShapes?: ReturnType<typeof shapes>;
    };
  } finally {
    rec.stop();
  }
};

describe('recorded context shapes', () => {
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
