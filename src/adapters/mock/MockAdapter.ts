/**
 * MockAdapter — scripted LLM responses for $0 testing.
 *
 * Same flowchart, swap the adapter, zero code changes.
 * Tests exercise the exact same control flow as production.
 *
 * Usage:
 *   import { mock } from 'agentfootprint';
 *   const model = mock([
 *     { content: 'Let me search.', toolCalls: [{ id: '1', name: 'search', arguments: { q: 'test' } }] },
 *     { content: 'The answer is 42.' },
 *   ]);
 */

import type { LLMProvider, LLMResponse, LLMCallOptions, Message, ToolCall } from '../../types';

export interface MockResponse {
  readonly content: string;
  readonly toolCalls?: ToolCall[];
  readonly usage?: { inputTokens: number; outputTokens: number };
  readonly model?: string;
}

export class MockAdapter implements LLMProvider {
  private responses: MockResponse[];
  private callIndex = 0;
  private readonly calls: Array<{ messages: Message[]; options?: LLMCallOptions }> = [];

  constructor(responses: MockResponse[]) {
    this.responses = [...responses];
  }

  async chat(messages: Message[], options?: LLMCallOptions): Promise<LLMResponse> {
    this.calls.push({ messages: [...messages], options });

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `MockAdapter: no more responses. Expected ${this.responses.length} calls, got ${
          this.callIndex + 1
        }. ` + 'Add more responses to your mock() configuration.',
      );
    }

    const response = this.responses[this.callIndex++];

    return {
      content: response.content,
      toolCalls: response.toolCalls,
      usage: response.usage ?? { inputTokens: 10, outputTokens: 20 },
      model: response.model ?? 'mock',
      finishReason: response.toolCalls?.length ? 'tool_calls' : 'stop',
    };
  }

  /** How many times chat() was called. */
  getCallCount(): number {
    return this.calls.length;
  }

  /** Get the messages sent in a specific call (0-indexed). */
  getCall(index: number): { messages: Message[]; options?: LLMCallOptions } | undefined {
    return this.calls[index];
  }

  /** Get all calls for assertion. */
  getAllCalls(): ReadonlyArray<{ messages: Message[]; options?: LLMCallOptions }> {
    return this.calls;
  }

  /** Reset call history (keep responses). */
  reset(): void {
    this.callIndex = 0;
    this.calls.length = 0;
  }
}

/**
 * Factory function for creating a mock model.
 *
 *   const model = mock([{ content: 'Hello!' }]);
 */
export function mock(responses: MockResponse[]): MockAdapter {
  return new MockAdapter(responses);
}
