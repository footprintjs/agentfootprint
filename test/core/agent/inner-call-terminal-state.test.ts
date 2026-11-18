import { describe, expect, it, vi } from 'vitest';
import { policyArgsOf } from '../../../src/core/agent/innerCallPolicyArgs.js';
import { refusalVerdictOf } from '../../../src/core/agent/runtime/terminal/verdicts.js';
import { stopStoredPolicyHalt } from '../../../src/core/agent/stages/toolCalls/routing/policyHalt.js';
import type { LLMMessage } from '../../../src/provider-contract/types.js';
import { extractSequence } from '../../../src/security/extractSequence.js';
import { Agent, checkInApproved, defineTool, isCheckInPause } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { PolicyHaltError } from '../../../src/security/index.js';

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

  it('closes a native resume when its saved state already carries a terminal verdict', async () => {
    const execute = vi.fn(() => 'fixture result');
    const respond = vi.fn(() => ({
      toolCalls: [{ id: 'paused-fixture', name: 'sample', args: {} }],
    }));
    const provider = mock({ respond });
    const agent = Agent.create({ provider, model: 'fixture' })
      .tool(
        defineTool({
          name: 'sample',
          description: 'Records a fixture result after approval.',
          inputSchema: { type: 'object', properties: {} },
          checkIn: 'always',
          execute,
        }),
      )
      .build();
    try {
      const paused = await agent.run('Review the fixture.');
      if (!isCheckInPause(paused)) throw new Error('expected an ordinary fixture pause');

      // This synthetic fixture represents a restored terminal decision. The
      // original fixture only issued a normal approval pause.
      const saved = {
        ...paused.checkpoint,
        sharedState: {
          ...paused.checkpoint.sharedState,
          policyHaltReason: 'fixture-stop',
          policyHaltTarget: 'sample',
          policyHaltArgs: {},
          policyHaltTellLLM: 'Fixture stopped.',
          policyHaltIteration: 1,
        },
      };
      const answer = checkInApproved({ request: paused.checkIn, by: 'fixture' });
      await expect(agent.resume(saved, answer)).rejects.toBeInstanceOf(PolicyHaltError);
      expect(execute).not.toHaveBeenCalled();
      expect(respond).toHaveBeenCalledTimes(1);
    } finally {
      await agent.shutdown();
    }
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

it('requires positive provenance for displayed arguments from a prior inner call', () => {
  const scope = { $getValue: () => undefined } as never;
  const displayed = { toolCallId: 'fixture#inner-1', toolName: 'sample', args: { count: 1 } };
  expect(() => policyArgsOf(scope, displayed)).toThrow(
    'Policy arguments from an earlier inner call are unavailable.',
  );
  expect(policyArgsOf(scope, { ...displayed, policyArgsRef: null })).toEqual({ count: 1 });
});
