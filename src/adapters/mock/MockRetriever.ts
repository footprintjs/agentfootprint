/**
 * MockRetriever — scripted retrieval responses for $0 testing.
 *
 * Same flowchart, swap the retriever, zero code changes.
 *
 * Usage:
 *   import { mockRetriever } from 'agentfootprint';
 *   const retriever = mockRetriever([
 *     { chunks: [{ content: 'Relevant doc', score: 0.95 }] },
 *   ]);
 */

import type {
  RetrieverProvider,
  RetrievalResult,
  RetrieveOptions,
  RetrievalChunk,
} from '../../types';

export interface MockRetrievalResponse {
  readonly chunks: RetrievalChunk[];
}

export class MockRetriever implements RetrieverProvider {
  private responses: MockRetrievalResponse[];
  private callIndex = 0;
  private readonly calls: Array<{ query: string; options?: RetrieveOptions }> = [];

  constructor(responses: MockRetrievalResponse[]) {
    this.responses = [...responses];
  }

  async retrieve(query: string, options?: RetrieveOptions): Promise<RetrievalResult> {
    this.calls.push({ query, options });

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `MockRetriever: no more responses. Expected ${this.responses.length} calls, got ${
          this.callIndex + 1
        }. ` + 'Add more responses to your mockRetriever() configuration.',
      );
    }

    const response = this.responses[this.callIndex++];

    return {
      chunks: response.chunks,
      query,
    };
  }

  /** How many times retrieve() was called. */
  getCallCount(): number {
    return this.calls.length;
  }

  /** Get a specific call (0-indexed). */
  getCall(index: number): { query: string; options?: RetrieveOptions } | undefined {
    return this.calls[index];
  }

  /** Get all calls for assertion. */
  getAllCalls(): ReadonlyArray<{ query: string; options?: RetrieveOptions }> {
    return this.calls;
  }

  /** Reset call history (keep responses). */
  reset(): void {
    this.callIndex = 0;
    this.calls.length = 0;
  }
}

/**
 * Factory function for creating a mock retriever.
 *
 *   const retriever = mockRetriever([{ chunks: [{ content: 'doc', score: 0.9 }] }]);
 */
export function mockRetriever(responses: MockRetrievalResponse[]): MockRetriever {
  return new MockRetriever(responses);
}
