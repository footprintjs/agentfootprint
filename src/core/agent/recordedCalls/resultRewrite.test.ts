import { expect, it } from 'vitest';
import { indexResultRewrites } from './resultRewriteIndex.js';

const changed = {
  moment: 'after-tool',
  at: 'tool',
  outcome: 'allow',
  changed: true,
  middleware: 'outer',
};

it('selects the final actual changing rule, including an unnamed final rule', () => {
  expect(
    indexResultRewrites([
      { ...first, middleware: 'inner' },
      first,
      { ...first, changed: false, middleware: 'unchanged' },
    ]).get('1.2.3.4.0'),
  ).toEqual({ kind: 'rewritten', index: 1, name: 'first' });
  expect(
    indexResultRewrites([first, { ...first, middleware: undefined }]).get('1.2.3.4.0'),
  ).toEqual({ kind: 'rewritten', index: 1 });
  expect(
    indexResultRewrites([{ ...first, moment: 'before-tool' }]).get('1.2.3.4.0'),
  ).toBeUndefined();
});

it('the per-read index snapshots names and original positions without retaining a handed row', () => {
  const first = { ...changed, callOccurrenceKey: [1, 2, 3, 4, 0] };
  const last = { ...first, middleware: 'last' };
  const index = indexResultRewrites([first, undefined, last]);
  last.middleware = 'changed after reading';
  expect(index.get('1.2.3.4.0')).toEqual({ kind: 'rewritten', index: 2, name: 'last' });
});

it('an unreadable later decision blocks earlier attribution without executing its fields', () => {
  const first = { ...changed, callOccurrenceKey: [1, 2, 3, 4, 0] };
  let calls = 0;
  const last = {
    ...first,
    get outcome() {
      calls++;
      throw new Error('Do not read.');
    },
  };
  const index = indexResultRewrites([first, last]);
  expect(calls).toBe(0);
  expect(index.get('1.2.3.4.0')).toEqual({ kind: 'blocked', index: 1 });
  expect(indexResultRewrites([{ ...first, callOccurrenceKey: [1] }]).size).toBe(0);
  expect(indexResultRewrites(undefined).size).toBe(0);
});

it('does not guess past a withheld or unreadable final answer', () => {
  expect(indexResultRewrites([first, { ...first, outcome: 'deny' }]).get('1.2.3.4.0')).toEqual({
    kind: 'blocked',
    index: 1,
  });
  let getterCalls = 0;
  const unreadable = {
    ...first,
    get outcome() {
      getterCalls++;
      return 'allow';
    },
  };
  expect(indexResultRewrites([first, unreadable]).get('1.2.3.4.0')).toEqual({
    kind: 'blocked',
    index: 1,
  });
  expect(getterCalls).toBe(0);
});

const occurrence = [1, 2, 3, 4, 0];
const first = { ...changed, callOccurrenceKey: occurrence, middleware: 'first' };

it.each([
  ['whole-row mask', '[REDACTED]'],
  ['missing row', undefined],
  ['absent occurrence key', { ...changed }],
  ['malformed occurrence key', { ...changed, callOccurrenceKey: [1] }],
] as const)('an unplaced %s cannot leave an earlier owner in the index', (_, row) => {
  expect(indexResultRewrites([first, row]).get('1.2.3.4.0')).toBeUndefined();
});

it.each([
  { ...changed, moment: 'before-tool' },
  { ...changed, changed: false },
])('positively irrelevant unbound decision %# does not erase an earlier owner', (row) => {
  expect(indexResultRewrites([first, row]).get('1.2.3.4.0')).toEqual({
    kind: 'rewritten',
    index: 0,
    name: 'first',
  });
});

it('a later positively bound final rewrite establishes its own original position', () => {
  const last = { ...first, middleware: 'final' };
  expect(indexResultRewrites([first, '[REDACTED]', last]).get('1.2.3.4.0')).toEqual({
    kind: 'rewritten',
    index: 2,
    name: 'final',
  });
});

it('an unavailable decision for a known foreign occurrence affects only that occurrence', () => {
  const other = { ...first, callOccurrenceKey: [9, 8, 7, 6, 0], outcome: 'deny' };
  const index = indexResultRewrites([first, other]);
  expect(index.get('1.2.3.4.0')).toEqual({ kind: 'rewritten', index: 0, name: 'first' });
  expect(index.get('9.8.7.6.0')).toEqual({ kind: 'blocked', index: 1 });
});

it('an unplaced key accessor invalidates ownership without invoking the accessor', () => {
  let calls = 0;
  const row = {
    ...changed,
    get callOccurrenceKey() {
      calls++;
      throw new Error('Unplaced key getter executed.');
    },
  };
  expect(indexResultRewrites([first, row]).get('1.2.3.4.0')).toBeUndefined();
  expect(calls).toBe(0);
});

it('an unavailable ledger slot invalidates ownership without invoking the accessor', () => {
  let calls = 0;
  const rows: unknown[] = [first];
  Object.defineProperty(rows, '1', {
    get() {
      calls++;
      throw new Error('Ledger slot getter executed.');
    },
  });
  expect(indexResultRewrites(rows).get('1.2.3.4.0')).toBeUndefined();
  expect(calls).toBe(0);
});
