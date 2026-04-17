/**
 * Tests for Agent.parallelTools(true) — concurrent tool execution within one turn.
 *
 * Tiers:
 * - unit:     multiple tool calls run concurrently, results appended in LLM order
 * - boundary: single tool call (parallel is a no-op), empty toolCalls
 * - scenario: mixed latencies verify Promise.all semantics
 * - property: output message order = input toolCall order regardless of resolution order
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/lib/concepts/Agent';
import { defineTool } from '../../../src/tools/ToolRegistry';
import type { LLMProvider, LLMResponse, ToolCall } from '../../../src/types';

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    chat: vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
  };
}

const makeCall = (name: string, id: string, args: Record<string, unknown> = {}): ToolCall => ({
  id,
  name,
  arguments: args,
});

describe('Agent.parallelTools — unit', () => {
  it('executes multiple tool calls concurrently (total time < sum of delays)', async () => {
    const DELAY = 80;
    const slow = (name: string) =>
      defineTool({
        id: name,
        description: '',
        inputSchema: { type: 'object' },
        handler: async () => {
          await new Promise((r) => setTimeout(r, DELAY));
          return { content: `${name}-done` };
        },
      });

    const provider = mockProvider([
      {
        content: 'using 3 tools',
        toolCalls: [makeCall('a', '1'), makeCall('b', '2'), makeCall('c', '3')],
      },
      { content: 'final' },
    ]);

    const agent = Agent.create({ provider })
      .tools([slow('a'), slow('b'), slow('c')])
      .parallelTools(true)
      .build();

    const start = Date.now();
    await agent.run('go');
    const elapsed = Date.now() - start;

    // Sequential would be ~240ms. Parallel should be ~80ms (+ overhead).
    // Give generous headroom so the test isn't flaky on slow CI.
    expect(elapsed).toBeLessThan(DELAY * 2);
  });

  it('appends tool result messages in LLM-requested order even when resolution order differs', async () => {
    const delays = { a: 60, b: 10, c: 30 }; // b finishes first
    const build = (name: 'a' | 'b' | 'c') =>
      defineTool({
        id: name,
        description: '',
        inputSchema: { type: 'object' },
        handler: async () => {
          await new Promise((r) => setTimeout(r, delays[name]));
          return { content: `${name}-result` };
        },
      });

    const provider = mockProvider([
      {
        content: 'calling',
        toolCalls: [makeCall('a', 'ca'), makeCall('b', 'cb'), makeCall('c', 'cc')],
      },
      { content: 'final' },
    ]);

    const agent = Agent.create({ provider })
      .tools([build('a'), build('b'), build('c')])
      .parallelTools(true)
      .build();
    const result = await agent.run('go');

    const toolResults = result.messages.filter((m) => m.role === 'tool');
    expect(toolResults.map((m) => (m.toolCallId ?? '').slice(1))).toEqual(['a', 'b', 'c']);
    expect((toolResults[0] as any).content).toBe('a-result');
    expect((toolResults[1] as any).content).toBe('b-result');
    expect((toolResults[2] as any).content).toBe('c-result');
  });

  it('single tool call works identically in parallel mode', async () => {
    const tool = defineTool({
      id: 'one',
      description: '',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'only' }),
    });
    const provider = mockProvider([
      { content: '', toolCalls: [makeCall('one', 'x')] },
      { content: 'final' },
    ]);

    const agent = Agent.create({ provider }).tool(tool).parallelTools(true).build();
    const result = await agent.run('go');

    expect(result.content).toBe('final');
    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect((toolMsgs[0] as any).content).toBe('only');
  });

  it('sequential mode (default) still works — regression guard', async () => {
    const order: string[] = [];
    const tool = (name: string) =>
      defineTool({
        id: name,
        description: '',
        inputSchema: { type: 'object' },
        handler: async () => {
          order.push(`start:${name}`);
          await new Promise((r) => setTimeout(r, 10));
          order.push(`end:${name}`);
          return { content: name };
        },
      });
    const provider = mockProvider([
      { content: '', toolCalls: [makeCall('a', '1'), makeCall('b', '2')] },
      { content: 'final' },
    ]);

    const agent = Agent.create({ provider })
      .tools([tool('a'), tool('b')])
      .build();
    await agent.run('go');

    // Sequential: a finishes fully before b starts.
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});
