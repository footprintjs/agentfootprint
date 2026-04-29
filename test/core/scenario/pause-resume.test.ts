/**
 * Scenario tests — end-to-end pause/resume via Agent tools.
 *
 * Demonstrates the complete round trip:
 *   1. Tool calls pauseHere()
 *   2. Agent.run() returns RunnerPauseOutcome with a serializable checkpoint
 *   3. Consumer serializes checkpoint (JSON-safe test)
 *   4. Agent.resume(checkpoint, humanAnswer) continues the ReAct loop
 *   5. Final answer returns
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 0, output: content.length / 4 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

describe('scenario — pause via tool + resume round trip', () => {
  it('pauseHere() produces RunnerPauseOutcome with checkpoint + pauseData', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'approve', args: { action: 'refund $500' } }]),
        resp('approved by user — proceeding'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: (args) => {
          pauseHere({
            question: `Approve ${(args as { action: string }).action}?`,
            risk: 'medium',
          });
          return ''; // unreachable
        },
      })
      .build();

    const result = await agent.run({ message: 'please refund me' });

    expect(isPaused(result)).toBe(true);
    if (!isPaused(result)) return;

    expect(result.pauseData).toMatchObject({
      toolCallId: 't1',
      toolName: 'approve',
      question: 'Approve refund $500?',
      risk: 'medium',
    });
    expect(result.checkpoint.pausedStageId).toBe('tool-calls');
    expect(result.checkpoint.pausedAt).toBeGreaterThan(0);
  });

  it('resume(checkpoint, humanAnswer) returns final answer', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'approve', args: { action: 'delete' } }]),
        resp('user said yes — action taken'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'Approve?' });
          return '';
        },
      })
      .build();

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) {
      expect.fail('expected paused outcome');
      return;
    }

    const final = await agent.resume(paused.checkpoint, 'user approved');
    expect(isPaused(final)).toBe(false);
    expect(final).toBe('user said yes — action taken');
  });

  it('checkpoint is JSON-serializable and survives a roundtrip', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'ask', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ prompt: 'continue?' });
          return '';
        },
      })
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isPaused(paused)) return expect.fail('expected paused');

    // Serialize and deserialize — simulates Redis/Postgres persistence.
    const serialized = JSON.stringify(paused.checkpoint);
    const restored = JSON.parse(serialized);

    const final = await agent.resume(restored, 'yes');
    expect(final).toBe('done');
  });

  it('emits pause.request on pause and pause.resume on resume', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'ask', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'confirm?', reason: 'high-stakes action' });
          return '';
        },
      })
      .build();

    const pauseReqs = vi.fn();
    const pauseResumes = vi.fn();
    agent.on('agentfootprint.pause.request', pauseReqs);
    agent.on('agentfootprint.pause.resume', pauseResumes);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');

    expect(pauseReqs).toHaveBeenCalledTimes(1);
    expect(pauseReqs.mock.calls[0][0].payload.reason).toBe('high-stakes action');

    await agent.resume(paused.checkpoint, 'ok');
    expect(pauseResumes).toHaveBeenCalledTimes(1);
    expect(pauseResumes.mock.calls[0][0].payload.pausedDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('humanAnswer is surfaced to the LLM as the tool result on resume', async () => {
    const capture = vi.fn();
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async (req) => {
          capture(req.messages);
          const toolMsgs = req.messages.filter((m) => m.role === 'tool');
          if (toolMsgs.length === 0) {
            // First call: request a tool call.
            return resp('', [{ id: 't1', name: 'ask', args: {} }]);
          }
          // After tool result: echo what we saw.
          return resp(`LLM saw tool result: ${toolMsgs[0].content}`);
        },
      },
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({});
          return '';
        },
      })
      .build();

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');

    const final = await agent.resume(paused.checkpoint, 'custom-human-answer');
    expect(final).toBe('LLM saw tool result: custom-human-answer');
  });
});

describe('scenario — runners without pausable stages', () => {
  it('LLMCall run() returns a string (never pauses on its own)', async () => {
    const { LLMCall } = await import('../../../src/core/LLMCall.js');
    const { MockProvider } = await import('../../../src/adapters/llm/MockProvider.js');

    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const out = await llm.run({ message: 'hi' });
    expect(isPaused(out)).toBe(false);
    expect(out).toBe('ok');
  });
});
