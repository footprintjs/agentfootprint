/**
 * Tests — enable.thinking / enable.logging feature-flag recorders.
 *
 * Covers consumer-facing ergonomics: one call enables full observability,
 * unsubscribe removes it cleanly.
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function scriptedProvider(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function llmResponse(
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

describe('enable.thinking — Claude-Code-style status line', () => {
  it('fires onStatus at every meaningful moment (single-turn agent)', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hello' }),
      model: 'mock',
    })
      .system('')
      .build();

    const statuses: string[] = [];
    agent.enable.thinking({ onStatus: (s) => statuses.push(s) });

    await agent.run({ message: 'hi' });

    // Expected sequence for a single-turn, no-tool agent:
    //   turn_start → Thinking...
    //   iteration_start → Iteration 1
    //   route_decided(final) → Composing answer...
    //   turn_end → Done
    expect(statuses).toEqual([
      'Thinking...',
      'Iteration 1',
      'Composing answer...',
      'Done',
    ]);
  });

  it('fires onStatus for tool-call path (calling / got result / continuing)', async () => {
    const provider = scriptedProvider(
      llmResponse('', [{ id: 'tc', name: 'lookup', args: {} }]),
      llmResponse('answer'),
    );
    const agent = Agent.create({ provider, model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'lookup', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const statuses: string[] = [];
    agent.enable.thinking({ onStatus: (s) => statuses.push(s) });

    await agent.run({ message: 'go' });

    expect(statuses).toContain('Calling lookup(…)');
    expect(statuses).toContain('Got result from tc');
    expect(statuses).toContain('Continuing with tool calls...');
    expect(statuses).toContain('Composing answer...');
    expect(statuses).toContain('Done');
  });

  it('unsubscribe removes the recorder from future runs', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hi' }),
      model: 'mock',
    })
      .system('')
      .build();

    const statuses: string[] = [];
    const unsub = agent.enable.thinking({ onStatus: (s) => statuses.push(s) });
    unsub();

    await agent.run({ message: 'hi' });
    expect(statuses).toEqual([]);
  });

  it('accepts a custom formatter and returns null to skip events', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hi' }),
      model: 'mock',
    })
      .system('')
      .build();

    const statuses: string[] = [];
    agent.enable.thinking({
      onStatus: (s) => statuses.push(s),
      format: (e) => {
        // Only surface turn-boundary events with custom messages.
        if (e.type === 'agentfootprint.agent.turn_start') return 'BEGIN';
        if (e.type === 'agentfootprint.agent.turn_end') return 'END';
        return null;
      },
    });

    await agent.run({ message: 'hi' });
    expect(statuses).toEqual(['BEGIN', 'END']);
  });
});

describe('enable.logging — firehose logger', () => {
  it('default domains are context + stream (the core debug lens)', async () => {
    const logSpy = vi.fn();
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hi' }),
      model: 'mock',
    })
      .system('sys')
      .build();

    agent.enable.logging({ logger: { log: logSpy } });
    await agent.run({ message: 'hi' });

    const names = logSpy.mock.calls.map((c) => c[0] as string);
    expect(names.some((n) => n.includes('stream.llm_start'))).toBe(true);
    expect(names.some((n) => n.includes('stream.llm_end'))).toBe(true);
    expect(names.some((n) => n.includes('context.injected'))).toBe(true);
    // Non-default domains stay silent
    expect(names.some((n) => n.includes('agent.turn_start'))).toBe(false);
  });

  it('explicit domain list includes only matching events', async () => {
    const logSpy = vi.fn();
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hi' }),
      model: 'mock',
    })
      .system('')
      .build();

    agent.enable.logging({ logger: { log: logSpy }, domains: ['agent', 'stream'] });
    await agent.run({ message: 'hi' });

    const names = logSpy.mock.calls.map((c) => c[0] as string);
    expect(names.some((n) => n.includes('agent.turn_start'))).toBe(true);
    expect(names.some((n) => n.includes('agent.turn_end'))).toBe(true);
    expect(names.some((n) => n.includes('stream.llm_start'))).toBe(true);
    expect(names.some((n) => n.includes('context.injected'))).toBe(false);
  });

  it("domains: 'all' logs absolutely everything", async () => {
    const logSpy = vi.fn();
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hi' }),
      model: 'mock',
    })
      .system('')
      .build();

    agent.enable.logging({ logger: { log: logSpy }, domains: 'all' });
    await agent.run({ message: 'hi' });

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('unsubscribe stops logging', async () => {
    const logSpy = vi.fn();
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hi' }),
      model: 'mock',
    })
      .system('')
      .build();

    const unsub = agent.enable.logging({ logger: { log: logSpy } });
    unsub();
    await agent.run({ message: 'hi' });
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('enable — ergonomics win (one line vs many)', () => {
  it('one enable.thinking call covers what ~5 .on() subscriptions would', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hi' }),
      model: 'mock',
    })
      .system('')
      .build();

    const statuses: string[] = [];
    // ONE LINE instead of subscribing to turn_start + iteration_start +
    // tool_start + tool_end + route_decided + turn_end and formatting each
    agent.enable.thinking({ onStatus: (s) => statuses.push(s) });

    await agent.run({ message: 'hi' });
    expect(statuses.length).toBeGreaterThanOrEqual(3);
  });
});
