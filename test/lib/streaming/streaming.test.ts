/**
 * Streaming support — 5-pattern tests.
 *
 * Tests the streaming CallLLM stage, .streaming() builder method,
 * and onToken callback.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent, mock, defineTool } from '../../../src/test-barrel';
import { createStreamingCallLLMStage } from '../../../src/lib/call/streamingCallLLMStage';

const noopTool = defineTool({
  id: 'noop',
  description: 'Does nothing',
  inputSchema: { type: 'object' },
  handler: async () => ({ content: 'ok' }),
});

// ── Unit ────────────────────────────────────────────────────

describe('Streaming — unit', () => {
  it('.streaming() method exists on Agent builder', () => {
    const builder = Agent.create({ provider: mock([{ content: 'hi' }]) });
    expect(typeof builder.streaming).toBe('function');
    // Returns this (chainable)
    expect(builder.streaming(true)).toBe(builder);
  });

  it('createStreamingCallLLMStage falls back to chat() when no streamCallback', async () => {
    const provider = mock([{ content: 'hello' }]);
    const stage = createStreamingCallLLMStage(provider);

    // Call without streamCallback — should use chat() fallback
    const scope = {
      messages: [{ role: 'user', content: 'hi' }],
      $getValue: (k: string) => undefined,
    } as any;

    await stage(scope, () => {}, undefined); // no streamCallback
    expect(scope.adapterResult).toBeDefined();
    expect(scope.adapterResult.content).toBe('hello');
  });

  it('agent with streaming disabled works normally', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) })
      .streaming(false)
      .build();

    const result = await agent.run('hello');
    expect(result.content).toBe('hi');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('Streaming — boundary', () => {
  it('streaming agent without onToken callback works (tokens not captured)', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) })
      .streaming(true)
      .build();

    // No onToken — streaming stage falls back to chat()
    const result = await agent.run('hello');
    expect(result.content).toBe('hi');
  });

  it('streaming agent with tools still works', async () => {
    const agent = Agent.create({
      provider: mock([
        { content: 'calling', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .streaming(true)
      .tool(noopTool)
      .build();

    const result = await agent.run('test');
    expect(result.content).toBe('done');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Streaming — scenario', () => {
  it('onToken callback receives tokens when provider supports chatStream', async () => {
    // Create a mock provider with chatStream
    const mockProvider = {
      chat: async () => ({ content: 'fallback' }),
      chatStream: async function* () {
        yield { type: 'token' as const, content: 'Hello' };
        yield { type: 'token' as const, content: ' world' };
        yield { type: 'done' as const };
      },
    };

    const tokens: string[] = [];
    const agent = Agent.create({ provider: mockProvider as any })
      .streaming(true)
      .build();

    const result = await agent.run('test', {
      onToken: (token) => tokens.push(token),
    });

    // Tokens should have been captured
    expect(tokens).toEqual(['Hello', ' world']);
    // Final content accumulated
    expect(result.content).toBe('Hello world');
  });
});

// ── Property ────────────────────────────────────────────────

describe('Streaming — property', () => {
  it('streaming flag does not affect final result — same content', async () => {
    const responses = [{ content: 'same answer' }];

    const nonStreaming = Agent.create({ provider: mock([...responses]) }).build();
    const streaming = Agent.create({ provider: mock([...responses]) }).streaming(true).build();

    const r1 = await nonStreaming.run('test');
    const r2 = await streaming.run('test');
    expect(r1.content).toBe(r2.content);
  });
});

// ── Security ────────────────────────────────────────────────

describe('Streaming — security', () => {
  it('onToken callback errors are swallowed (error isolation)', async () => {
    const mockProvider = {
      chat: async () => ({ content: 'fallback' }),
      chatStream: async function* () {
        yield { type: 'token' as const, content: 'Hello' };
        yield { type: 'done' as const };
      },
    };

    const agent = Agent.create({ provider: mockProvider as any })
      .streaming(true)
      .build();

    // onToken throws — error is swallowed, agent still completes
    const result = await agent.run('test', {
      onToken: () => { throw new Error('callback error'); },
    });
    expect(result.content).toBeDefined();
  });
});
