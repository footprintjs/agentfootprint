import { describe, expect, it, vi } from 'vitest';
import { refusalVerdictOf } from '../../../src/core/agent/runtime/terminal/verdicts.js';
import { stopStoredPolicyHalt } from '../../../src/core/agent/stages/toolCalls/routing/policyHalt.js';
import type { LLMMessage } from '../../../src/provider-contract/types.js';
import { extractSequence } from '../../../src/security/extractSequence.js';

describe('the native policy halt state', () => {
  it('closes either caller of the gate with an already-recorded terminal outcome', () => {
    const state = { policyHaltReason: 'fixture-stop', policyHaltTarget: 'sample' };
    const stop = vi.fn();
    const scope = Object.assign(state, {
      $getValue: (key: keyof typeof state) => state[key],
      $break: stop,
    });
    expect(stopStoredPolicyHalt(scope as never)).toBe(true);
    expect(stop).toHaveBeenCalledWith('policy-halt: fixture-stop');
    expect(stopStoredPolicyHalt({} as never)).toBe(false);
  });

  it('reads the carried invocation identity independently of other rows with that name', () => {
    const state = {
      policyHaltReason: 'fixture-stop',
      policyHaltTarget: 'sample',
      policyHaltArgs: {},
      innerToolCalls: [{ toolName: 'sample', toolCallId: 'previous#inner-1', halted: true }],
    };
    expect(refusalVerdictOf(state, { messageMiddleware: [] })).toMatchObject({
      kind: 'policy-halt',
      halt: { sequence: [{ name: 'sample' }] },
    });
    const narrowed = refusalVerdictOf(state, { messageMiddleware: [] });
    if (narrowed?.kind !== 'policy-halt') throw new Error('expected a halt');
    expect(narrowed.halt.sequence[0].inner).toBeUndefined();
    expect(
      refusalVerdictOf(
        { ...state, policyHaltInnerCallId: 'current#inner-1' },
        { messageMiddleware: [] },
      ),
    ).toMatchObject({ kind: 'policy-halt', halt: { sequence: [{ name: 'sample', inner: true }] } });
  });
});

it('pairs recorded inner calls to each occurrence of a reused outer id', () => {
  const history: LLMMessage[] = [
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'common', name: 'compose', args: {} }],
    },
    {
      role: 'tool',
      content: 'done',
      toolCallId: 'common',
      calls: [{ toolCallId: 'common#inner-1', toolName: 'first', args: {} }],
    },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'common', name: 'compose', args: {} }],
    },
    {
      role: 'tool',
      content: 'done',
      toolCallId: 'common',
      calls: [{ toolCallId: 'common#inner-1', toolName: 'second', args: {} }],
    },
  ];
  const emitted = extractSequence(history, 2);
  expect(emitted.filter((entry) => entry.inner).map((entry) => entry.name)).toEqual([
    'first',
    'second',
  ]);
});
