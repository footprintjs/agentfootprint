import { expect, it } from 'vitest';
import {
  newToolOwner,
  nextToolDispatch,
  readToolOwner,
  TOOL_OWNER_MAX_BYTES,
} from '../../src/tools/toolResourceOwner.js';

it('retains the next ordinal independently of a paused call and refuses exhaustion', () => {
  const first = nextToolDispatch(newToolOwner({ runId: 'native-test-leg', ordinal: 3 }));
  expect(first).toMatchObject({ nextDispatch: 1, pending: { ordinal: 0 } });
  expect(nextToolDispatch(first)).toEqual(first);
  const between = readToolOwner({ version: 1, birth: first.birth, nextDispatch: 8 });
  expect(nextToolDispatch(between)).toMatchObject({ nextDispatch: 9, pending: { ordinal: 8 } });
  expect(() => nextToolDispatch({ ...between, nextDispatch: Number.MAX_SAFE_INTEGER })).toThrow(
    /exhausted/,
  );
});

it.each([
  { version: 2, birth: { runId: 'r', componentOrdinal: 0 }, nextDispatch: 0 },
  { version: 1, birth: { runId: 'r', componentOrdinal: -1 }, nextDispatch: 0 },
  { version: 1, birth: { runId: '', componentOrdinal: 0 }, nextDispatch: 0 },
  { version: 1, birth: { runId: 'r', componentOrdinal: 0 }, nextDispatch: 0.5 },
  {
    version: 1,
    birth: { runId: 'r', componentOrdinal: 0 },
    nextDispatch: 0,
    pending: { version: 1, birth: { runId: 'r', componentOrdinal: 0 }, ordinal: 0 },
  },
  {
    version: 1,
    birth: { runId: 'r', componentOrdinal: 0 },
    nextDispatch: 2,
    pending: { version: 1, birth: { runId: 'other', componentOrdinal: 0 }, ordinal: 1 },
  },
  {
    version: 1,
    birth: { runId: 'r', componentOrdinal: 0 },
    nextDispatch: 2,
    pending: { version: 1, birth: { runId: 'r', componentOrdinal: 1 }, ordinal: 1 },
  },
  {
    version: 1,
    birth: { runId: 'x'.repeat(TOOL_OWNER_MAX_BYTES), componentOrdinal: 0 },
    nextDispatch: 0,
  },
  { version: 1, birth: { runId: 'r', componentOrdinal: 0 }, nextDispatch: Infinity },
  { version: 1, birth: { runId: 'r', componentOrdinal: 0 }, nextDispatch: 0, unknown: true },
])('refuses malformed finite owner data %#', (value) => {
  expect(() => readToolOwner(value)).toThrow();
});

it('does not invoke an accessor while admitting checkpoint data', () => {
  let called = false;
  const value = { version: 1, birth: { runId: 'r', componentOrdinal: 0 } };
  Object.defineProperty(value, 'nextDispatch', {
    enumerable: true,
    get() {
      called = true;
      return 0;
    },
  });
  expect(() => readToolOwner(value)).toThrow();
  expect(called).toBe(false);
});
