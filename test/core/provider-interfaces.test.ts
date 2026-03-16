/**
 * Core provider interface tests.
 *
 * Verifies that the provider interfaces are correctly typed and
 * can be implemented by simple objects (duck typing, no inheritance).
 */

import { describe, it, expect } from 'vitest';
import type {
  PromptProvider,
  MessageStrategy,
  ToolProvider,
  AgentRecorder,
  PromptContext,
  MessageContext,
  ToolContext,
  ToolExecutionResult,
  TurnStartEvent,
} from '../../src/core';
import type { Message } from '../../src/types';

describe('PromptProvider interface', () => {
  it('can be implemented with a sync resolve', () => {
    const provider: PromptProvider = {
      resolve: () => 'You are a helpful assistant.',
    };
    const ctx: PromptContext = { message: 'hi', turnNumber: 0, history: [] };
    expect(provider.resolve(ctx)).toBe('You are a helpful assistant.');
  });

  it('can be implemented with an async resolve', async () => {
    const provider: PromptProvider = {
      resolve: async (ctx) => `You are helping with: ${ctx.message}`,
    };
    const ctx: PromptContext = { message: 'coding', turnNumber: 0, history: [] };
    expect(await provider.resolve(ctx)).toBe('You are helping with: coding');
  });

  it('receives turn context for adaptive prompts', () => {
    const captured: PromptContext[] = [];
    const provider: PromptProvider = {
      resolve: (ctx) => {
        captured.push(ctx);
        return ctx.turnNumber === 0 ? 'Be verbose.' : 'Be concise.';
      },
    };

    const ctx0: PromptContext = { message: 'first', turnNumber: 0, history: [] };
    const ctx1: PromptContext = {
      message: 'second',
      turnNumber: 1,
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'hi' },
      ],
    };

    expect(provider.resolve(ctx0)).toBe('Be verbose.');
    expect(provider.resolve(ctx1)).toBe('Be concise.');
    expect(captured).toHaveLength(2);
    expect(captured[1].history).toHaveLength(2);
  });

  it('receives signal for cancellable async prompts', async () => {
    let receivedSignal: AbortSignal | undefined;
    const provider: PromptProvider = {
      resolve: async (ctx) => {
        receivedSignal = ctx.signal;
        return 'prompt';
      },
    };

    const controller = new AbortController();
    const ctx: PromptContext = {
      message: 'hi',
      turnNumber: 0,
      history: [],
      signal: controller.signal,
    };
    await provider.resolve(ctx);

    expect(receivedSignal).toBe(controller.signal);
    expect(receivedSignal!.aborted).toBe(false);
  });
});

describe('MessageStrategy interface', () => {
  it('can return full history unchanged', () => {
    const strategy: MessageStrategy = {
      prepare: (history) => history,
    };
    const msgs: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const ctx: MessageContext = { message: 'hello', turnNumber: 0, loopIteration: 0 };
    expect(strategy.prepare(msgs, ctx)).toEqual(msgs);
  });

  it('can implement sliding window', () => {
    const strategy: MessageStrategy = {
      prepare: (history) => history.slice(-2),
    };
    const msgs: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
      { role: 'user', content: 'e' },
    ];
    const ctx: MessageContext = { message: 'e', turnNumber: 2, loopIteration: 0 };
    expect(strategy.prepare(msgs, ctx)).toHaveLength(2);
    expect(strategy.prepare(msgs, ctx)[0].content).toBe('d');
  });

  it('receives loop iteration for tool-loop aware strategies', () => {
    let capturedIteration = -1;
    const strategy: MessageStrategy = {
      prepare: (history, ctx) => {
        capturedIteration = ctx.loopIteration;
        return history;
      },
    };
    const ctx: MessageContext = { message: 'test', turnNumber: 0, loopIteration: 3 };
    strategy.prepare([], ctx);
    expect(capturedIteration).toBe(3);
  });

  it('receives signal for cancellation-aware strategies', () => {
    let receivedSignal: AbortSignal | undefined;
    const strategy: MessageStrategy = {
      prepare: (history, ctx) => {
        receivedSignal = ctx.signal;
        return history;
      },
    };
    const controller = new AbortController();
    strategy.prepare([], {
      message: 'x',
      turnNumber: 0,
      loopIteration: 0,
      signal: controller.signal,
    });
    expect(receivedSignal).toBe(controller.signal);
  });
});

describe('ToolProvider interface', () => {
  it('can resolve static tool list', () => {
    const provider: ToolProvider = {
      resolve: () => [
        { name: 'search', description: 'Search the web', inputSchema: { type: 'object' } },
      ],
      execute: async (call) => ({ content: `Results for: ${call.arguments.query}` }),
    };
    const ctx: ToolContext = { message: 'test', turnNumber: 0, loopIteration: 0, messages: [] };
    const tools = provider.resolve(ctx);
    expect(tools).toHaveLength(1);
    expect((tools as any)[0].name).toBe('search');
  });

  it('can resolve tools dynamically based on context', async () => {
    const provider: ToolProvider = {
      resolve: (ctx) => {
        if (ctx.message.includes('code')) {
          return [
            { name: 'run_code', description: 'Execute code', inputSchema: { type: 'object' } },
          ];
        }
        return [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }];
      },
      execute: async () => ({ content: 'done' }),
    };

    const codeCtx: ToolContext = {
      message: 'write code',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    };
    const searchCtx: ToolContext = {
      message: 'find info',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    };

    const codeTools = await provider.resolve(codeCtx);
    const searchTools = await provider.resolve(searchCtx);

    expect(codeTools[0].name).toBe('run_code');
    expect(searchTools[0].name).toBe('search');
  });

  it('execute is optional (resolver-only provider)', () => {
    const resolverOnly: ToolProvider = {
      resolve: () => [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }],
      // No execute — intentionally omitted
    };
    const ctx: ToolContext = { message: 'test', turnNumber: 0, loopIteration: 0, messages: [] };
    expect(resolverOnly.resolve(ctx)).toHaveLength(1);
    expect(resolverOnly.execute).toBeUndefined();
  });

  it('self-contained provider has both resolve and execute', async () => {
    const provider: ToolProvider = {
      resolve: () => [{ name: 'calc', description: 'Calculate', inputSchema: { type: 'object' } }],
      execute: async (call) => {
        if (call.name === 'fail') return { content: 'Tool error', error: true };
        return { content: 'success' };
      },
    };

    const success = await provider.execute!({ id: '1', name: 'calc', arguments: {} });
    expect(success.content).toBe('success');

    const failure = await provider.execute!({ id: '2', name: 'fail', arguments: {} });
    expect(failure.error).toBe(true);
  });

  it('receives signal for cancellable tool resolution', async () => {
    let receivedSignal: AbortSignal | undefined;
    const provider: ToolProvider = {
      resolve: async (ctx) => {
        receivedSignal = ctx.signal;
        return [];
      },
    };
    const controller = new AbortController();
    await provider.resolve({
      message: 'x',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
      signal: controller.signal,
    });
    expect(receivedSignal).toBe(controller.signal);
  });
});

describe('AgentRecorder interface', () => {
  it('fires onTurnStart before any other events', () => {
    const events: string[] = [];
    const recorder: AgentRecorder = {
      id: 'order-tracker',
      onTurnStart: () => events.push('start'),
      onLLMCall: () => events.push('llm'),
      onTurnComplete: () => events.push('complete'),
    };

    recorder.onTurnStart!({ turnNumber: 0, message: 'hello' });
    recorder.onLLMCall!({ latencyMs: 100, turnNumber: 0, loopIteration: 0 });
    recorder.onTurnComplete!({
      turnNumber: 0,
      messageCount: 2,
      totalLoopIterations: 0,
      content: 'hi',
    });

    expect(events).toEqual(['start', 'llm', 'complete']);
  });

  it('onTurnStart receives message for tracing span setup', () => {
    let capturedEvent: TurnStartEvent | undefined;
    const recorder: AgentRecorder = {
      id: 'tracer',
      onTurnStart: (event) => {
        capturedEvent = event;
      },
    };

    recorder.onTurnStart!({ turnNumber: 3, message: 'what is 2+2?' });

    expect(capturedEvent!.turnNumber).toBe(3);
    expect(capturedEvent!.message).toBe('what is 2+2?');
  });

  it('all hooks are optional except id', () => {
    const minimal: AgentRecorder = { id: 'minimal' };
    expect(minimal.id).toBe('minimal');
    expect(minimal.onTurnStart).toBeUndefined();
    expect(minimal.onLLMCall).toBeUndefined();
    expect(minimal.onToolCall).toBeUndefined();
    expect(minimal.onTurnComplete).toBeUndefined();
    expect(minimal.onError).toBeUndefined();
    expect(minimal.clear).toBeUndefined();
  });

  it('clear resets state between runs', () => {
    let callCount = 0;
    const recorder: AgentRecorder = {
      id: 'counting',
      onLLMCall: () => {
        callCount++;
      },
      clear: () => {
        callCount = 0;
      },
    };

    recorder.onLLMCall!({ latencyMs: 0, turnNumber: 0, loopIteration: 0 });
    recorder.onLLMCall!({ latencyMs: 0, turnNumber: 0, loopIteration: 1 });
    expect(callCount).toBe(2);

    recorder.clear!();
    expect(callCount).toBe(0);
  });

  it('multiple recorders can observe independently', () => {
    const log1: string[] = [];
    const log2: string[] = [];

    const r1: AgentRecorder = {
      id: 'logger-1',
      onToolCall: (e) => log1.push(e.toolName),
    };
    const r2: AgentRecorder = {
      id: 'logger-2',
      onToolCall: (e) => log2.push(`${e.toolName}:${e.latencyMs}ms`),
    };

    const event = {
      toolName: 'search',
      args: { query: 'test' },
      result: { content: 'found' } as ToolExecutionResult,
      latencyMs: 42,
    };

    r1.onToolCall!(event);
    r2.onToolCall!(event);

    expect(log1).toEqual(['search']);
    expect(log2).toEqual(['search:42ms']);
  });
});
