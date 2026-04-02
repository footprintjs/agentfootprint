/**
 * Tests for callLLMStage — sends messages + tools to LLM provider.
 *
 * Tiers:
 * - unit:     provider.chat() called with correct messages and tools
 * - boundary: empty messages, no tools, provider returns minimal response
 * - scenario: tools present → options.tools passed, tools absent → no options
 * - property: adapterResult always set in scope after stage runs
 * - security: provider is required (build-time validation), provider throws
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { createCallLLMStage } from '../../../src/lib/call/callLLMStage';
import type { AgentLoopState } from '../../../src/scope/types';
import type { LLMProvider, LLMResponse, Message, LLMToolDescription } from '../../../src/types';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });

function mockProvider(response: LLMResponse): LLMProvider & { chat: ReturnType<typeof vi.fn> } {
  return { chat: vi.fn().mockResolvedValue(response) };
}

/**
 * Run CallLLM stage inside a wrapper chart.
 * Seed stage sets up messages + toolDescriptions in scope.
 */
async function runCallLLM(
  provider: LLMProvider,
  messages: Message[] = [user('hello')],
  tools: LLMToolDescription[] = [],
): Promise<{ state: Record<string, unknown>; provider: LLMProvider }> {
  const callLLM = createCallLLMStage(provider);

  const chart = flowChart<AgentLoopState>(
    'Seed',
    (scope) => {
      scope.messages = messages;
      scope.toolDescriptions = tools;
    },
    'seed',
  )
    .addFunction('CallLLM', callLLM, 'call-llm')
    .build();

  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return {
    state: executor.getSnapshot()?.sharedState ?? {},
    provider,
  };
}

// ── Unit Tests ──────────────────────────────────────────────

describe('callLLMStage — unit', () => {
  it('calls provider.chat with messages from scope', async () => {
    const provider = mockProvider({ content: 'Hello back!' });
    const msgs = [user('hello')];

    await runCallLLM(provider, msgs);
    expect(provider.chat).toHaveBeenCalledOnce();

    // First arg is messages
    const calledMsgs = provider.chat.mock.calls[0][0];
    expect(calledMsgs).toHaveLength(1);
    expect(calledMsgs[0].role).toBe('user');
  });

  it('passes tools in options when tool descriptions are present', async () => {
    const tools: LLMToolDescription[] = [
      { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
    ];
    const provider = mockProvider({ content: 'Using tools' });

    await runCallLLM(provider, [user('search for X')], tools);

    const calledOptions = provider.chat.mock.calls[0][1];
    expect(calledOptions).toBeDefined();
    expect(calledOptions!.tools).toEqual(tools);
  });

  it('writes adapterResult to scope', async () => {
    const provider = mockProvider({ content: 'result' });

    const { state } = await runCallLLM(provider);
    const result = state.adapterResult as { type: string; content: string };
    expect(result.type).toBe('final');
    expect(result.content).toBe('result');
  });

  it('writes raw response to adapterRawResponse', async () => {
    const rawResponse: LLMResponse = { content: 'raw', model: 'test-model' };
    const provider = mockProvider(rawResponse);

    const { state } = await runCallLLM(provider);
    const raw = state.adapterRawResponse as LLMResponse;
    expect(raw.content).toBe('raw');
    expect(raw.model).toBe('test-model');
  });
});

// ── Boundary Tests ──────────────────────────────────────────

describe('callLLMStage — boundary', () => {
  it('works with empty messages array', async () => {
    const provider = mockProvider({ content: 'ok' });

    const { state } = await runCallLLM(provider, []);
    expect(state.adapterResult).toBeDefined();
  });

  it('passes no options when tool descriptions are empty', async () => {
    const provider = mockProvider({ content: 'no tools' });

    await runCallLLM(provider, [user('hi')], []);
    const calledOptions = provider.chat.mock.calls[0][1];
    expect(calledOptions).toBeUndefined();
  });

  it('handles provider returning minimal response', async () => {
    const provider = mockProvider({ content: '' });

    const { state } = await runCallLLM(provider);
    const result = state.adapterResult as { type: string; content: string };
    expect(result.type).toBe('final');
    expect(result.content).toBe('');
  });
});

// ── Scenario Tests ──────────────────────────────────────────

describe('callLLMStage — scenario', () => {
  it('normalizes tool call response to type "tools"', async () => {
    const provider = mockProvider({
      content: 'Let me search',
      toolCalls: [{ id: 'tc-1', name: 'search', arguments: { q: 'test' } }],
    });

    const { state } = await runCallLLM(provider, [user('find it')]);
    const result = state.adapterResult as { type: string; toolCalls: unknown[] };
    expect(result.type).toBe('tools');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('normalizes final response to type "final"', async () => {
    const provider = mockProvider({ content: 'Done!' });

    const { state } = await runCallLLM(provider);
    const result = state.adapterResult as { type: string };
    expect(result.type).toBe('final');
  });
});

// ── Property Tests ──────────────────────────────────────────

describe('callLLMStage — property', () => {
  it('adapterResult is always set after stage completes', async () => {
    const provider = mockProvider({ content: 'something' });
    const { state } = await runCallLLM(provider);
    expect('adapterResult' in state).toBe(true);
    expect(state.adapterResult).toBeDefined();
  });

  it('raw response path is always set after stage completes', async () => {
    const provider = mockProvider({ content: 'something' });
    const { state } = await runCallLLM(provider);
    expect('adapterRawResponse' in state).toBe(true);
  });
});

// ── Cloud Tests (AbortSignal) ────────────────────────────────

describe('callLLMStage — cloud (AbortSignal)', () => {
  it('forwards AbortSignal from env to provider.chat()', async () => {
    const controller = new AbortController();
    const provider = mockProvider({ content: 'ok' });

    const callLLM = createCallLLMStage(provider);
    const chart = flowChart<AgentLoopState>(
      'Seed',
      (scope) => {
        scope.messages = [user('hello')];
        scope.toolDescriptions = [];
      },
      'seed',
    )
      .addFunction('CallLLM', callLLM, 'call-llm')
      .build();

    const executor = new FlowChartExecutor(chart);
    await executor.run({ env: { signal: controller.signal } });

    const calledOptions = provider.chat.mock.calls[0][1];
    expect(calledOptions).toBeDefined();
    expect(calledOptions!.signal).toBe(controller.signal);
  });

  it('passes signal alongside tools when both present', async () => {
    const controller = new AbortController();
    const tools: LLMToolDescription[] = [
      { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
    ];
    const provider = mockProvider({ content: 'ok' });

    const callLLM = createCallLLMStage(provider);
    const chart = flowChart<AgentLoopState>(
      'Seed',
      (scope) => {
        scope.messages = [user('hi')];
        scope.toolDescriptions = tools;
      },
      'seed',
    )
      .addFunction('CallLLM', callLLM, 'call-llm')
      .build();

    const executor = new FlowChartExecutor(chart);
    await executor.run({ env: { signal: controller.signal } });

    const calledOptions = provider.chat.mock.calls[0][1];
    expect(calledOptions!.tools).toEqual(tools);
    expect(calledOptions!.signal).toBe(controller.signal);
  });
});

// ── Security Tests ──────────────────────────────────────────

describe('callLLMStage — security', () => {
  it('throws at build time when provider is null/undefined', () => {
    expect(() => createCallLLMStage(null as unknown as LLMProvider))
      .toThrow('provider is required');
    expect(() => createCallLLMStage(undefined as unknown as LLMProvider))
      .toThrow('provider is required');
  });

  it('provider.chat() throwing propagates as error', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockRejectedValue(new Error('API rate limit')),
    };

    await expect(runCallLLM(provider)).rejects.toThrow('API rate limit');
  });
});
