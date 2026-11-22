import { expect, it } from 'vitest';
import { lastResultRewriteIndex } from './resultDispositions.js';
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
    lastResultRewriteIndex([
      { ...changed, middleware: 'inner' },
      changed,
      { ...changed, changed: false, middleware: 'unchanged' },
    ]),
  ).toBe(1);
  expect(lastResultRewriteIndex([changed, { ...changed, middleware: undefined }])).toBe(1);
  expect(lastResultRewriteIndex([{ ...changed, moment: 'before-tool' }])).toBeUndefined();
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
  expect(lastResultRewriteIndex([changed, { ...changed, outcome: 'deny' }])).toBeUndefined();
  let getterCalls = 0;
  const unreadable = {
    ...changed,
    get outcome() {
      getterCalls++;
      return 'allow';
    },
  };
  expect(lastResultRewriteIndex([changed, unreadable])).toBeUndefined();
  expect(getterCalls).toBe(0);
});
