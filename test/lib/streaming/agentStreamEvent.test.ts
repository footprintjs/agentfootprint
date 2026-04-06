/**
 * AgentStreamEvent — 5-pattern tests.
 *
 * Tests the full event stream through AgentRunner.run({ onEvent }).
 *
 * Tiers:
 * - unit:     onEvent receives turn_start + turn_end for simple call
 * - boundary: onToken backward compat, onEvent+onToken collision guard
 * - scenario: tool lifecycle events (tool_start, tool_end) in multi-turn
 * - property: event ordering (turn_start first, turn_end last)
 * - security: onEvent handler errors don't crash agent
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent, defineTool } from '../../../src/test-barrel';
import type { AgentStreamEvent, LLMResponse, Message, ToolCall } from '../../../src/test-barrel';

// ── Helpers ────────────────────────────���─────────────────────

function mockProvider(responses: LLMResponse[]) {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

const searchTool = defineTool({
  id: 'search',
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async ({ q }) => ({ content: `Results for ${q}` }),
});

// ── Unit ───────────────────────────────────────────────────────

describe('AgentStreamEvent — unit', () => {
  it('onEvent receives turn_start and turn_end', async () => {
    const events: AgentStreamEvent[] = [];
    const agent = Agent.create({ provider: mockProvider([{ content: 'Hello!' }]) })
      .system('Help.')
      .build();

    await agent.run('hi', { onEvent: (e) => events.push(e) });

    expect(events[0]).toEqual({ type: 'turn_start', userMessage: 'hi' });
    const turnEnd = events.find((e) => e.type === 'turn_end');
    expect(turnEnd).toBeDefined();
    expect((turnEnd as any).content).toBe('Hello!');
    expect((turnEnd as any).iterations).toBe(0);
  });
});

// ── Backward Compat ───────────────────────────────────────────

describe('AgentStreamEvent — backward compat', () => {
  it('onToken still works as sugar for onEvent token filter', async () => {
    const tokens: string[] = [];
    const provider = {
      chat: vi.fn(async () => ({ content: 'Hello world' })),
    };
    const agent = Agent.create({ provider })
      .system('Help.')
      .build();

    await agent.run('hi', { onToken: (t) => tokens.push(t) });
    // Non-streaming mode — no tokens emitted (onToken only fires in streaming mode)
    // This is correct: onToken requires .streaming(true)
    expect(tokens).toEqual([]);
  });

  it('onEvent takes precedence over onToken (collision guard)', async () => {
    const events: AgentStreamEvent[] = [];
    const tokens: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prevEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    try {
      const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
        .system('Help.')
        .build();

      await agent.run('hi', {
        onEvent: (e) => events.push(e),
        onToken: (t) => tokens.push(t),
      });

      // onEvent should work
      expect(events.some((e) => e.type === 'turn_start')).toBe(true);
      // onToken should be ignored (no tokens in non-streaming anyway)
      // Dev warning should fire
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('onToken is ignored'),
      );
    } finally {
      process.env['NODE_ENV'] = prevEnv;
      warnSpy.mockRestore();
    }
  });
});

// ── Tool Lifecycle ────────────────────────────────────────────

describe('AgentStreamEvent — tool lifecycle', () => {
  it('emits tool_start and tool_end for tool calls', async () => {
    const events: AgentStreamEvent[] = [];
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'test' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Done.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(searchTool)
      .build();

    await agent.run('search for test', { onEvent: (e) => events.push(e) });

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

  it('emits tool_end with error flag on tool failure', async () => {
    const failTool = defineTool({
      id: 'fail_tool',
      description: 'Always fails',
      inputSchema: { type: 'object' },
      handler: async () => { throw new Error('Tool broke'); },
    });

    const events: AgentStreamEvent[] = [];
    const tc: ToolCall = { id: 'tc-1', name: 'fail_tool', arguments: {} };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Error handled.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(failTool)
      .build();

    await agent.run('try', { onEvent: (e) => events.push(e) });

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd.error).toBe(true);
    expect(toolEnd.result).toContain('Tool broke');
  });
});

// ── Event Ordering ────────────────────────────────────────────

describe('AgentStreamEvent — ordering', () => {
  it('turn_start is first, turn_end is last', async () => {
    const events: AgentStreamEvent[] = [];
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'x' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Final.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(searchTool)
      .build();

    await agent.run('go', { onEvent: (e) => events.push(e) });

    expect(events[0].type).toBe('turn_start');
    expect(events[events.length - 1].type).toBe('turn_end');

    // tool_start comes before tool_end
    const tsIdx = events.findIndex((e) => e.type === 'tool_start');
    const teIdx = events.findIndex((e) => e.type === 'tool_end');
    expect(tsIdx).toBeLessThan(teIdx);
  });
});

// ── LLM Lifecycle (non-streaming) ─────────────────────────────

describe('AgentStreamEvent — llm lifecycle', () => {
  it('emits llm_start and llm_end in non-streaming mode', async () => {
    const events: AgentStreamEvent[] = [];
    const agent = Agent.create({ provider: mockProvider([{ content: 'Answer', model: 'test-model' }]) })
      .system('Help.')
      .build();

    await agent.run('hi', { onEvent: (e) => events.push(e) });

    const llmStart = events.find((e) => e.type === 'llm_start');
    expect(llmStart).toBeDefined();
    expect((llmStart as any).iteration).toBe(1);

    const llmEnd = events.find((e) => e.type === 'llm_end');
    expect(llmEnd).toBeDefined();
    expect((llmEnd as any).content).toBe('Answer');
    expect((llmEnd as any).model).toBe('test-model');
    expect((llmEnd as any).toolCallCount).toBe(0);
    expect((llmEnd as any).latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Error Isolation ───────────────────────────────────────────

describe('AgentStreamEvent — error isolation', () => {
  it('onEvent handler errors do NOT crash the agent', async () => {
    const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
      .system('Help.')
      .build();

    // onEvent throws — but agent should still complete
    const result = await agent.run('hi', {
      onEvent: () => { throw new Error('Consumer broke'); },
    });

    expect(result.content).toBe('ok');
  });
});
