/**
 * executionStages — both tree forms give the same stages in the same order.
 *
 * Tiers:
 *   - unit:     list form, linked form, forks in each, absent tree
 *   - boundary: a long run (no recursion), saved-tree limits
 *   - security: getters never run on a saved tree; malformed saved trees are refused
 *   - scenario: a real footprintjs run reads the same through either form
 */
import { describe, expect, it } from 'vitest';
import { FlowChartExecutor, flowChart } from 'footprintjs';
import {
  ExecutionTreeShapeError,
  executionStages,
  savedExecutionStages,
} from './executionStages.js';

const ids = (tree: unknown): unknown[] => executionStages(tree).map((s) => s.runtimeStageId);

// seed → fork(a → a2, b) → join, in both forms.
const LIST = [
  { runtimeStageId: 'seed#0' },
  {
    runtimeStageId: 'fork#1',
    branches: [
      [{ runtimeStageId: 'a#2' }, { runtimeStageId: 'a2#3' }],
      [{ runtimeStageId: 'b#4' }],
    ],
  },
  { runtimeStageId: 'join#5' },
];
const LINKED = {
  runtimeStageId: 'seed#0',
  next: {
    runtimeStageId: 'fork#1',
    children: [
      { runtimeStageId: 'a#2', next: { runtimeStageId: 'a2#3' } },
      { runtimeStageId: 'b#4' },
    ],
    next: { runtimeStageId: 'join#5' },
  },
};
const ORDER = ['seed#0', 'fork#1', 'a#2', 'a2#3', 'b#4', 'join#5'];

/** The list form turned into the linked form, as footprintjs 12 would have built it. */
function toLinked(chain: readonly Record<string, unknown>[]): Record<string, unknown> | undefined {
  let next: Record<string, unknown> | undefined;
  for (let index = chain.length - 1; index >= 0; index--) {
    const { branches, ...stage } = chain[index]!;
    const linked: Record<string, unknown> = { ...stage };
    if (Array.isArray(branches))
      linked.children = branches.map((b) => toLinked(b as Record<string, unknown>[]));
    if (next) linked.next = next;
    next = linked;
  }
  return next;
}

describe('executionStages — unit', () => {
  it('reads the list form in run order, a fork’s branches before the stage after it', () => {
    expect(ids(LIST)).toEqual(ORDER);
  });

  it('reads the linked form in the same order', () => {
    expect(ids(LINKED)).toEqual(ORDER);
  });

  it('gives [] for an absent tree and skips items that are not stages', () => {
    expect(executionStages(undefined)).toEqual([]);
    expect(executionStages(null)).toEqual([]);
    expect(ids([null, 3, { runtimeStageId: 'x#0' }])).toEqual(['x#0']);
  });
});

describe('executionStages — boundary', () => {
  it('walks a 100 000-stage linked tree without recursion', () => {
    let head: Record<string, unknown> | undefined;
    for (let i = 99_999; i >= 0; i--)
      head = { runtimeStageId: `s#${i}`, ...(head && { next: head }) };
    const stages = executionStages(head);
    expect(stages).toHaveLength(100_000);
    expect(stages[99_999]!.runtimeStageId).toBe('s#99999');
  });

  it('refuses a saved tree past its stage or item limits', () => {
    expect(() => savedExecutionStages(LIST, { maxStages: 5, maxItems: 10 })).toThrow(
      ExecutionTreeShapeError,
    );
    expect(() => savedExecutionStages(LIST, { maxStages: 10, maxItems: 2 })).toThrow(
      ExecutionTreeShapeError,
    );
    expect(savedExecutionStages(LIST, { maxStages: 6, maxItems: 3 })).toHaveLength(6);
  });
});

describe('savedExecutionStages — paths and security', () => {
  const limits = { maxStages: 100, maxItems: 100 };

  it('gives each stage its literal path in the list form', () => {
    expect(savedExecutionStages(LIST, limits).map((s) => s.path)).toEqual([
      ['0'],
      ['1'],
      ['1', 'branches', '0', '0'],
      ['1', 'branches', '0', '1'],
      ['1', 'branches', '1', '0'],
      ['2'],
    ]);
  });

  it('gives each stage its literal path in the linked form', () => {
    expect(savedExecutionStages(LINKED, limits).map((s) => s.path)).toEqual([
      [],
      ['next'],
      ['next', 'children', '0'],
      ['next', 'children', '0', 'next'],
      ['next', 'children', '1'],
      ['next', 'next'],
    ]);
  });

  it('never runs a getter, and refuses it', () => {
    let ran = false;
    const stage = Object.defineProperty({ runtimeStageId: 'x#0' }, 'next', {
      get() {
        ran = true;
        return undefined;
      },
      enumerable: true,
    });
    expect(() => savedExecutionStages(stage, limits)).toThrow(ExecutionTreeShapeError);
    expect(ran).toBe(false);
  });

  it('refuses malformed saved trees rather than reading them in part', () => {
    for (const tree of [
      undefined,
      'x',
      [1],
      [[{ runtimeStageId: 'x#0' }]],
      { runtimeStageId: 'x#0', next: 5 },
      { runtimeStageId: 'x#0', children: {} },
      [{ runtimeStageId: 'x#0', branches: [{ runtimeStageId: 'y#1' }] }],
    ])
      expect(() => savedExecutionStages(tree, limits)).toThrow(ExecutionTreeShapeError);
  });
});

describe('executionStages — scenario (a real run)', () => {
  it('reads a real snapshot the same in either form', async () => {
    const chart = flowChart('seed', async () => undefined, 'seed')
      .addListOfFunction([
        { id: 'a', name: 'a', fn: async () => undefined },
        { id: 'b', name: 'b', fn: async () => undefined },
      ])
      .addFunction('join', async () => undefined, 'join')
      .build();
    const executor = new FlowChartExecutor(chart);
    await executor.run();
    const tree: unknown = executor.getSnapshot().executionTree;
    const fromRun = ids(tree);
    expect(fromRun).toHaveLength(4);
    expect(new Set(fromRun).size).toBe(4);
    // Whichever form this footprintjs serves, the other form reads identically.
    const other = Array.isArray(tree)
      ? toLinked(tree as Record<string, unknown>[])
      : (() => {
          const list: Record<string, unknown>[] = [];
          for (let n = tree as Record<string, unknown> | undefined; n; ) {
            const { next, children, ...stage } = n;
            list.push(
              Array.isArray(children)
                ? { ...stage, branches: children.map((c: unknown) => executionStages(c)) }
                : stage,
            );
            n = next as Record<string, unknown> | undefined;
          }
          return list;
        })();
    expect(ids(other)).toEqual(fromRun);
  });
});
