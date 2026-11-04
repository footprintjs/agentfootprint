import assert from 'node:assert/strict';
import { it } from 'vitest';
import { splitFindings } from '../../../src/core/agent/findings/reserved.js';
import { prepareCallState } from '../../../src/core/agent/stages/toolCalls/access/callState.js';
import type { DispatchCall } from '../../../src/core/agent/stages/toolCalls/contracts/batchCall.js';
import type { InputsDispatch } from '../../../src/core/agent/stages/toolCalls/contracts/inputsDispatch.js';

function proposal() {
  const tc: DispatchCall = {
    id: 'query-1',
    name: 'read_rows',
    args: { query: 'recent', _findings: { basis: ['previous'] } },
  };
  const args = splitFindings(tc.args).args;
  return { tc, args };
}

it('qualifies the real findings peel independently of call-state preparation', () => {
  const { tc, args } = proposal();
  assert.notStrictEqual(args, tc.args);
  assert.equal(args.query, 'recent');
  assert.equal(Object.hasOwn(args, '_findings'), false);
});

it('keeps the exact peeled arguments when the inputs layer is absent', () => {
  const { tc, args } = proposal();
  const state = prepareCallState(tc, undefined, undefined, undefined, args);
  assert.strictEqual(state.runArgs, args);
  assert.strictEqual(state.callArguments.callArgs, args);
  assert.strictEqual(state.callArguments.chainedArgs, args);
  assert.equal(Object.hasOwn(state.runArgs, '_findings'), false);
  assert.equal(state.outcome.error, undefined);
});

it('passes the peeled arguments to fills and retains the filled reference', () => {
  const { tc, args } = proposal();
  const filled = { query: 'confirmed' };
  let fills = 0;
  // Pure narrow input port; this fixture makes no native execution or input-admission claim.
  const inputs = {
    withFills(source: unknown) {
      fills++;
      assert.strictEqual(source, args);
      assert.equal(Object.hasOwn(source as object, '_findings'), false);
      return filled;
    },
  } as unknown as InputsDispatch;
  const state = prepareCallState(tc, undefined, undefined, inputs, args);
  assert.equal(fills, 1);
  assert.strictEqual(state.runArgs, filled);
  assert.strictEqual(state.callArguments.callArgs, filled);
  assert.strictEqual(state.callArguments.chainedArgs, filled);
  assert.equal(state.execution.executed, false);
});
