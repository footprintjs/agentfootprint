import { describe, expect, it } from 'vitest';
import { readCallOccurrenceKey } from '../../../src/lib/callOccurrence.js';
import { normalizeCallOccurrences } from '../../helpers/normalizeCallOccurrences.js';

import { absent, Agent, checkInApproved, defineTool, isCheckInPause } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import type { LLMMessage } from '../../../src/provider-contract/types.js';

const call = { id: 'lookup-1', name: 'lookup', args: {} };

function toolMessage(content: string) {
  return { role: 'tool', content, toolCallId: call.id, toolName: call.name };
}

function recordedToolMessage(content: string) {
  return { ...toolMessage(content), callOccurrenceKey: [0, 0, 0, 1, 0] };
}

async function dispatch(
  result: unknown,
  options: { readonly pause?: true; readonly resultCeiling?: { readonly maxChars: number } } = {},
) {
  const wire: string[] = [];
  const ends: Array<{ result: unknown; entered?: boolean; error?: boolean; status?: string }> = [];
  let requests = 0;
  const agent = Agent.create({
    provider: mock({
      respond: (request) => {
        for (const message of request.messages) {
          if (message.role === 'tool') wire.push(JSON.stringify(message));
        }
        return requests++ === 0 ? { toolCalls: [call] } : { content: 'Done.' };
      },
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: call.name,
        description: 'Look up records.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => result,
        ...(options.pause && { checkIn: 'always' as const }),
        ...(options.resultCeiling && { resultCeiling: options.resultCeiling }),
      }),
    )
    .build();
  agent.on('agentfootprint.stream.tool_end', (event) => ends.push(event.payload));
  const answer = await agent.run({ message: 'Look up records.' });
  if (options.pause) {
    if (!isCheckInPause(answer)) throw new Error('Expected a check-in before dispatch.');
    await agent.resume(
      answer.checkpoint,
      checkInApproved({ request: answer.checkIn, by: 'reviewer' }),
    );
  }
  const history = agent.getLastSnapshot()?.sharedState.history as readonly LLMMessage[];
  const committed = history.filter((message) => message.role === 'tool');
  expect(committed).toHaveLength(1);
  expect(wire).toHaveLength(1);
  expect(ends).toHaveLength(1);
  const proposal = history.find((message) => message.role === 'assistant')?.toolCalls?.[0];
  const occurrence = readCallOccurrenceKey(proposal ?? {});
  expect(occurrence).toMatch(/\.0$/);
  expect(readCallOccurrenceKey(committed[0]!)).toBe(occurrence);
  expect(readCallOccurrenceKey(ends[0]!)).toBe(occurrence);
  return { message: committed[0]!, wire: wire[0]!, end: ends[0]! };
}

describe('reported status on committed tool messages', () => {
  it.each([
    ['failure', 'failure', 'failed'],
    ['denied', 'denied', 'refused'],
    ['invalid', 'invalid', 'failed'],
    [' Partial ', 'partial', undefined],
    ['pending', 'pending', undefined],
    ['success', undefined, undefined],
    ['absent', undefined, undefined],
  ])(
    'records the admitted status %j when relevant and keeps provider bytes',
    async (status, reportedStatus, outcome) => {
      const content = 'Lookup returned.';
      const recorded = await dispatch({ content, effects: [], status });
      expect(normalizeCallOccurrences(recorded.message)).toStrictEqual({
        ...recordedToolMessage(content),
        ...(outcome !== undefined && { outcome }),
        ...(reportedStatus !== undefined && { reportedStatus }),
      });
      expect(recorded.wire).toBe(JSON.stringify(toolMessage(content)));
    },
  );

  it('uses only the admitted envelope, even if the result text says pending', async () => {
    const content = 'Lookup is pending.';
    const recorded = await dispatch(content);
    expect(normalizeCallOccurrences(recorded.message)).toStrictEqual(recordedToolMessage(content));
    expect(recorded.wire).toBe(JSON.stringify(toolMessage(content)));
  });

  it('records the status after a check-in-approved dispatch', async () => {
    const content = 'Lookup returned.';
    const recorded = await dispatch({ content, effects: [], status: 'pending' }, { pause: true });
    expect(normalizeCallOccurrences(recorded.message)).toStrictEqual({
      ...recordedToolMessage(content),
      reportedStatus: 'pending',
    });
    expect(recorded.wire).toBe(JSON.stringify(toolMessage(content)));
  });

  it('omits a refused envelope on both inline and check-in-approved dispatch', async () => {
    const refusal = {
      content: absent({ what: 'records', checked: 'declared' }),
      effects: [],
      status: 'pending',
    };
    const inline = await dispatch(refusal);
    const resumed = await dispatch(refusal, { pause: true });
    expect(inline.message.content).toContain('declares no `search`');
    expect(normalizeCallOccurrences(inline.message)).toStrictEqual({
      ...recordedToolMessage(inline.message.content),
      outcome: 'failed',
    });
    expect(normalizeCallOccurrences(resumed.message)).toStrictEqual(
      normalizeCallOccurrences(inline.message),
    );
    expect(inline.wire).toBe(JSON.stringify(toolMessage(inline.message.content)));
    expect(resumed.wire).toBe(inline.wire);
    for (const end of [inline.end, resumed.end]) {
      expect(end).toMatchObject({ error: true, entered: true, result: inline.message.content });
      expect(end).not.toHaveProperty('status');
    }
  });

  it('keeps library invalid when a clean run hits the result ceiling', async () => {
    const recorded = await dispatch('Long lookup result.'.repeat(10), {
      resultCeiling: { maxChars: 30 },
    });
    expect(recorded.message.content).toContain('No data was returned.');
    expect(normalizeCallOccurrences(recorded.message)).toStrictEqual({
      ...recordedToolMessage(recorded.message.content),
      outcome: 'failed',
      reportedStatus: 'invalid',
    });
    expect(recorded.wire).toBe(JSON.stringify(toolMessage(recorded.message.content)));
    expect(recorded.end).toMatchObject({ entered: true, status: 'invalid' });
    expect(recorded.end).not.toHaveProperty('error');
  });
});
