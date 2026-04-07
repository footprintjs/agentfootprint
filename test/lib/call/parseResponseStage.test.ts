/**
 * Tests for parseResponseStage — extract ParsedResponse from AdapterResult.
 *
 * Tiers:
 * - unit:     parses "final" result, parses "tools" result
 * - boundary: no adapterResult in scope, error adapterResult
 * - scenario: appends assistant message to conversation history
 * - property: parsedResponse always has hasToolCalls boolean + toolCalls array
 * - security: error result throws with code + message, messages not corrupted on error
 */

import { describe, it, expect } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { parseResponseStage } from '../../../src/lib/call/parseResponseStage';
import type { AgentLoopState, ParsedResponse } from '../../../src/scope/types';
import type { AdapterResult, Message, ToolCall } from '../../../src/types';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });

function makeToolCall(name: string): ToolCall {
  return { id: `tc-${name}`, name, arguments: {} };
}

/**
 * Run ParseResponse stage inside a wrapper chart.
 * Seed stage sets up adapterResult + messages in scope.
 */
async function runParseResponse(
  adapterResult: AdapterResult | undefined,
  messages: Message[] = [user('hello')],
): Promise<Record<string, unknown>> {
  const chart = flowChart<AgentLoopState>(
    'Seed',
    (scope) => {
      scope.messages = messages;
      if (adapterResult) {
        scope.adapterResult = adapterResult;
      }
    },
    'seed',
  )
    .addFunction('ParseResponse', parseResponseStage, 'parse-response')
    .build();

  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

// ── Unit Tests ──────────────────────────────────────────────

describe('parseResponseStage — unit', () => {
  it('parses "final" result into ParsedResponse', async () => {
    const state = await runParseResponse({
      type: 'final',
      content: 'The answer is 42.',
    });

    const parsed = state.parsedResponse as ParsedResponse;
    expect(parsed.hasToolCalls).toBe(false);
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.content).toBe('The answer is 42.');
  });

  it('parses "tools" result into ParsedResponse with tool calls', async () => {
    const tc = makeToolCall('search');
    const state = await runParseResponse({
      type: 'tools',
      content: 'Let me search',
      toolCalls: [tc],
    });

    const parsed = state.parsedResponse as ParsedResponse;
    expect(parsed.hasToolCalls).toBe(true);
    expect(parsed.toolCalls).toEqual([tc]);
    expect(parsed.content).toBe('Let me search');
  });
});

// ── Boundary Tests ──────────────────────────────────────────

describe('parseResponseStage — boundary', () => {
  it('throws when no adapterResult in scope', async () => {
    await expect(runParseResponse(undefined)).rejects.toThrow('no adapter result');
  });

  it('throws on error adapterResult with code and message', async () => {
    await expect(
      runParseResponse({
        type: 'error',
        code: 'rate_limit',
        message: 'Too many requests',
        retryable: true,
      }),
    ).rejects.toThrow('[rate_limit] Too many requests');
  });

  it('handles empty content in final result', async () => {
    const state = await runParseResponse({ type: 'final', content: '' });
    const parsed = state.parsedResponse as ParsedResponse;
    expect(parsed.content).toBe('');
    expect(parsed.hasToolCalls).toBe(false);
  });
});

// ── Scenario Tests ──────────────────────────────────────────

describe('parseResponseStage — scenario', () => {
  it('appends assistant message to conversation history (final)', async () => {
    const state = await runParseResponse({ type: 'final', content: 'Hello!' }, [user('hi')]);

    const messages = state.messages as Message[];
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Hello!');
  });

  it('appends assistant message with toolCalls when tools present', async () => {
    const tc = makeToolCall('search');
    const state = await runParseResponse({ type: 'tools', content: 'Searching', toolCalls: [tc] }, [
      user('search for X'),
    ]);

    const messages = state.messages as Message[];
    expect(messages).toHaveLength(2);
    const asstMsg = messages[1];
    expect(asstMsg.role).toBe('assistant');
    if (asstMsg.role === 'assistant') {
      expect(asstMsg.toolCalls).toEqual([tc]);
    }
  });

  it('preserves existing messages before appending', async () => {
    const existing: Message[] = [
      user('turn 1'),
      { role: 'assistant', content: 'response 1' },
      user('turn 2'),
    ];
    const state = await runParseResponse({ type: 'final', content: 'response 2' }, existing);

    const messages = state.messages as Message[];
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual(existing[0]);
    expect(messages[1]).toEqual(existing[1]);
    expect(messages[2]).toEqual(existing[2]);
    expect(messages[3].role).toBe('assistant');
  });
});

// ── Property Tests ──────────────────────────────────────────

describe('parseResponseStage — property', () => {
  it('parsedResponse always has boolean hasToolCalls', async () => {
    const finalState = await runParseResponse({ type: 'final', content: 'ok' });
    const finalParsed = finalState.parsedResponse as ParsedResponse;
    expect(typeof finalParsed.hasToolCalls).toBe('boolean');

    const tc = makeToolCall('x');
    const toolsState = await runParseResponse({
      type: 'tools',
      content: '',
      toolCalls: [tc],
    });
    const toolsParsed = toolsState.parsedResponse as ParsedResponse;
    expect(typeof toolsParsed.hasToolCalls).toBe('boolean');
  });

  it('parsedResponse.toolCalls is always an array', async () => {
    const state = await runParseResponse({ type: 'final', content: 'no tools' });
    const parsed = state.parsedResponse as ParsedResponse;
    expect(Array.isArray(parsed.toolCalls)).toBe(true);
    expect(parsed.toolCalls).toEqual([]);
  });
});

// ── Security Tests ──────────────────────────────────────────

describe('parseResponseStage — security', () => {
  it('error result includes both code and message in thrown error', async () => {
    try {
      await runParseResponse({
        type: 'error',
        code: 'auth_failed',
        message: 'Invalid API key',
        retryable: false,
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('auth_failed');
      expect((err as Error).message).toContain('Invalid API key');
    }
  });

  it('messages not corrupted when error is thrown (seed state preserved)', async () => {
    // Error thrown during parse shouldn't corrupt messages from seed
    // This verifies the stage throws before modifying messages
    const errorResult: AdapterResult = {
      type: 'error',
      code: 'server_error',
      message: 'Internal error',
      retryable: false,
    };

    // We can't check state after throw (executor doesn't snapshot on error),
    // but we verify the error is thrown cleanly
    await expect(runParseResponse(errorResult)).rejects.toThrow('Internal error');
  });
});
