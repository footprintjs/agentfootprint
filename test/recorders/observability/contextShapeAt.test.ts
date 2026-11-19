import { describe, expect, it } from 'vitest';
import { contextShapeAt, type ContextShapeIndex } from '../../../src/doors/observe.js';

const index: ContextShapeIndex = {
  version: 1,
  initial: [
    [['items'], 'array', 0],
    [['a.b'], 'string'],
    [['a', 'b'], 'boolean'],
  ],
  changes: [
    [1, [[['items'], 'array', 3]]],
    [4, [[['items'], 'unknown']]],
    [6, [[['items'], 'object']]],
    [9, [[['items'], 'deleted']]],
  ],
};

describe('contextShapeAt through the public observability door', () => {
  it('looks up the last recorded description through a commit, including the initial state', () => {
    expect(contextShapeAt(index, 9, ['items'])).toEqual(['unknown']);
    expect(contextShapeAt(index, 6, ['items'])).toEqual(['object']);
    expect(contextShapeAt(index, 4, ['items'])).toEqual(['unknown']);
    expect(contextShapeAt(index, 3, ['items'])).toEqual(['array', 3]);
    expect(contextShapeAt(index, -1, ['items'])).toEqual(['array', 0]);
    expect(contextShapeAt(index, 0, ['items'])).toEqual(['array', 0]);
    expect(contextShapeAt(index, 6, ['a.b'])).toEqual(['string']);
    expect(contextShapeAt(index, 6, ['a', 'b'])).toEqual(['boolean']);
  });

  it('withholds an answer for missing, unrecognized or malformed evidence', () => {
    expect(contextShapeAt(undefined, 0, ['items'])).toEqual(['unknown']);
    expect(contextShapeAt({ ...index, version: 2 }, 0, ['items'])).toEqual(['unknown']);
    expect(contextShapeAt(index, 1, ['elsewhere'])).toEqual(['unknown']);
    expect(contextShapeAt(index, NaN, ['items'])).toEqual(['unknown']);
    expect(contextShapeAt(index, -2, ['items'])).toEqual(['unknown']);
    const invalidLength = { ...index, changes: [[1, [[['items'], 'array', -1]]]] };
    expect(contextShapeAt(invalidLength, 1, ['items'])).toEqual(['unknown']);
    const duplicateFrame = { ...index, changes: [index.changes[0], index.changes[0]] };
    expect(contextShapeAt(duplicateFrame, 1, ['items'])).toEqual(['unknown']);
    const outOfOrder = { ...index, changes: [index.changes[3], index.changes[1]] };
    expect(contextShapeAt(outOfOrder, 4, ['items'])).toEqual(['unknown']);
  });
});
