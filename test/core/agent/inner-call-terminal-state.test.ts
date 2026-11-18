import { describe, expect, it, vi } from 'vitest';
import type { LLMMessage } from '../../../src/provider-contract/types.js';
import { extractSequence } from '../../../src/security/extractSequence.js';
import { Agent, checkInApproved, defineTool, isCheckInPause } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { PolicyHaltError } from '../../../src/security/index.js';

describe('the native policy halt state', () => {
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
