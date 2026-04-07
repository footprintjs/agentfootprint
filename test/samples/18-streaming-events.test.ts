/**
 * Sample 18: AgentStreamEvent — Real-Time Lifecycle Events
 *
 * Shows the 9-event discriminated union for building CLI/web/mobile UX.
 * Events fire for tool lifecycle (start/end), LLM lifecycle (start/end),
 * and turn boundaries — even without .streaming(true).
 *
 * Only `token` and `thinking` events require streaming mode.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent, defineTool } from '../../src/test-barrel';
import type { AgentStreamEvent, LLMResponse, ToolCall } from '../../src/test-barrel';

// ── Mock provider ────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]) {
  let i = 0;
  return {
    chat: vi.fn(async () => {
      const r = responses[i] ?? responses[responses.length - 1];
      i++;
      return r;
    }),
  };
}

const searchTool = defineTool({
  id: 'search',
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async ({ q }) => ({ content: `Results for ${q}` }),
});

// ── Tests ────────────────────────────────────────────────────

describe('Sample 18: Streaming Events', () => {
  it('onEvent receives full lifecycle for simple response', async () => {
    const events: AgentStreamEvent[] = [];
    const agent = Agent.create({ provider: mockProvider([{ content: 'Hello!', model: 'test' }]) })
      .system('Help.')
      .build();

    await agent.run('hi', { onEvent: (e) => events.push(e) });

    // turn_start → llm_start → llm_end → turn_end
    expect(events[0].type).toBe('turn_start');
    expect((events[0] as any).userMessage).toBe('hi');

    const llmStart = events.find((e) => e.type === 'llm_start');
    expect(llmStart).toBeDefined();
    expect((llmStart as any).iteration).toBe(1);

    const llmEnd = events.find((e) => e.type === 'llm_end');
    expect(llmEnd).toBeDefined();
    expect((llmEnd as any).content).toBe('Hello!');
    expect((llmEnd as any).model).toBe('test');
    expect((llmEnd as any).toolCallCount).toBe(0);

    const turnEnd = events.find((e) => e.type === 'turn_end');
    expect(turnEnd).toBeDefined();
    expect((turnEnd as any).content).toBe('Hello!');
  });

  it('onEvent receives tool lifecycle for tool calls', async () => {
    const events: AgentStreamEvent[] = [];
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'test' } };
    const provider = mockProvider([{ content: '', toolCalls: [tc] }, { content: 'Done.' }]);

    const agent = Agent.create({ provider }).system('Help.').tool(searchTool).build();

    await agent.run('search', { onEvent: (e) => events.push(e) });

    // Should have tool_start and tool_end
    const toolStart = events.find((e) => e.type === 'tool_start');
    expect(toolStart).toBeDefined();
    expect((toolStart as any).toolName).toBe('search');
    expect((toolStart as any).args).toEqual({ q: 'test' });

    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd).toBeDefined();
    expect((toolEnd as any).toolName).toBe('search');
    expect((toolEnd as any).result).toContain('Results for test');
    expect((toolEnd as any).latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('event ordering: turn_start first, turn_end last', async () => {
    const events: AgentStreamEvent[] = [];
    const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
      .system('Help.')
      .build();

    await agent.run('hi', { onEvent: (e) => events.push(e) });

    expect(events[0].type).toBe('turn_start');
    expect(events[events.length - 1].type).toBe('turn_end');
  });

  it('onToken backward compat still works', async () => {
    const tokens: string[] = [];
    const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
      .system('Help.')
      .build();

    // onToken without streaming — no tokens emitted (need .streaming(true))
    await agent.run('hi', { onToken: (t) => tokens.push(t) });
    expect(tokens).toEqual([]);
  });

  it('SSEFormatter formats events correctly', async () => {
    const { SSEFormatter } = await import('../../src/stream.barrel');
    const event: AgentStreamEvent = { type: 'token', content: 'Hello' };
    const sse = SSEFormatter.format(event);
    expect(sse).toBe('event: token\ndata: {"type":"token","content":"Hello"}\n\n');
  });
});
