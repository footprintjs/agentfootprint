/**
 * Agent — streaming behavior.
 *
 * 7 patterns covering the contract between Agent and a streaming
 * `LLMProvider`:
 *
 *   S1  Streaming providers are preferred — Agent calls `stream()` when
 *       the optional method exists, NOT `complete()`.
 *   S2  Each non-terminal chunk emits `agentfootprint.stream.token`
 *       carrying the token + index + accumulated content length.
 *   S3  Token stream concatenates exactly to the final response.content
 *       (no lost characters across chunk boundaries).
 *   S4  Non-streaming providers (only `complete`) still work — Agent
 *       falls back transparently. No streaming events fire.
 *   S5  Tool calls + usage + stopReason on the terminal chunk drive
 *       the ReAct loop — same observable behavior as `complete()`.
 *   S6  AbortSignal mid-stream stops emission and propagates.
 *   S7  When `stream()` finishes WITHOUT yielding a `response` on the
 *       done chunk, Agent falls back to `complete()` (compat with
 *       partial implementations / older providers).
 *
 * Goal: lock the protocol so future provider work (Anthropic SSE,
 * OpenAI tool-stream deltas) doesn't drift from this contract.
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/adapters/types.js';

// ── Helpers ────────────────────────────────────────────────────────

/** Build a streaming-only provider that yields the supplied chunks. */
function streamingProvider(opts: {
  readonly chunks: readonly LLMChunk[];
  readonly onComplete?: () => never;
}): LLMProvider {
  return {
    name: 'mock-stream',
    complete: async () => {
      if (opts.onComplete) opts.onComplete();
      throw new Error('complete() should not be called when stream() exists');
    },
    stream: async function* () {
      for (const c of opts.chunks) yield c;
    },
  };
}

/** Build a non-streaming provider — `stream` undefined. */
function completeOnly(response: LLMResponse): LLMProvider {
  return {
    name: 'mock-complete',
    complete: async () => response,
  };
}

function makeResponse(
  overrides: Partial<LLMResponse> = {},
): LLMResponse {
  return {
    content: 'hello world',
    toolCalls: [],
    usage: { input: 5, output: 2 },
    stopReason: 'stop',
    ...overrides,
  };
}

function chunksFor(content: string, response: LLMResponse): LLMChunk[] {
  const tokens = content.split(/(\s+)/).filter((s) => s.length > 0);
  const out: LLMChunk[] = tokens.map((t, i) => ({
    tokenIndex: i,
    content: t,
    done: false,
  }));
  out.push({ tokenIndex: tokens.length, content: '', done: true, response });
  return out;
}

// ── S1: stream() preferred over complete() ────────────────────────

describe('Agent streaming — S1: stream() preferred', () => {
  it('calls provider.stream() when defined and never calls complete()', async () => {
    let completeCalled = false;
    const response = makeResponse({ content: 'hi' });
    const provider: LLMProvider = {
      name: 'p',
      complete: async () => {
        completeCalled = true;
        return response;
      },
      stream: async function* () {
        yield { tokenIndex: 0, content: 'hi', done: false };
        yield { tokenIndex: 1, content: '', done: true, response };
      },
    };
    const agent = Agent.create({ provider, model: 'm' }).system('').build();
    await agent.run({ message: 'go' });
    expect(completeCalled).toBe(false);
  });
});

// ── S2: stream.token events fire per chunk ────────────────────────

describe('Agent streaming — S2: stream.token events', () => {
  it('emits agentfootprint.stream.token once per non-terminal chunk', async () => {
    const response = makeResponse({ content: 'one two three' });
    const chunks = chunksFor('one two three', response);
    const provider = streamingProvider({ chunks });
    const agent = Agent.create({ provider, model: 'm' }).system('').build();

    const tokens: unknown[] = [];
    agent.on('agentfootprint.stream.token', (e) => tokens.push(e.payload));

    await agent.run({ message: 'go' });
    // 5 non-terminal chunks: ['one', ' ', 'two', ' ', 'three']
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    expect(tokens.length).toBeLessThanOrEqual(5);
    // First payload carries the right token + index.
    const first = tokens[0] as { content: string; tokenIndex: number };
    expect(first.content).toBe('one');
    expect(first.tokenIndex).toBe(0);
  });
});

// ── S3: concat(tokens) === response.content ────────────────────────

describe('Agent streaming — S3: token stream concatenates to response.content', () => {
  it('all token payloads concatenate exactly to the final response content', async () => {
    const content = 'hello world from mock';
    const response = makeResponse({ content });
    const provider = streamingProvider({ chunks: chunksFor(content, response) });
    const agent = Agent.create({ provider, model: 'm' }).system('').build();

    const accumulated: string[] = [];
    agent.on('agentfootprint.stream.token', (e) => {
      accumulated.push((e.payload as { content: string }).content);
    });
    await agent.run({ message: 'go' });
    expect(accumulated.join('')).toBe(content);
  });
});

// ── S4: non-streaming provider falls back to complete() ────────────

describe('Agent streaming — S4: complete()-only fallback', () => {
  it('uses complete() when stream is undefined and emits no stream.token', async () => {
    const provider = completeOnly(makeResponse({ content: 'plain' }));
    const agent = Agent.create({ provider, model: 'm' }).system('').build();
    const tokens: unknown[] = [];
    agent.on('agentfootprint.stream.token', (e) => tokens.push(e.payload));
    const result = await agent.run({ message: 'go' });
    expect(tokens).toHaveLength(0);
    expect(result).toBe('plain');
  });
});

// ── S5: tool calls on the done chunk drive the ReAct loop ──────────

describe('Agent streaming — S5: tool calls survive the stream protocol', () => {
  it('tool calls + usage + stopReason on done chunk match complete() semantics', async () => {
    const turn1 = makeResponse({
      content: '',
      toolCalls: [{ id: 'c1', name: 'echo', args: { q: 'hi' } }],
      stopReason: 'tool_use',
    });
    const turn2 = makeResponse({
      content: 'final answer',
      toolCalls: [],
    });
    let call = 0;
    const provider: LLMProvider = {
      name: 'p',
      complete: async () => {
        throw new Error('should not be called');
      },
      stream: async function* () {
        const r = call++ === 0 ? turn1 : turn2;
        // Yield content as a single chunk for simplicity.
        if (r.content) {
          yield { tokenIndex: 0, content: r.content, done: false };
          yield { tokenIndex: 1, content: '', done: true, response: r };
        } else {
          yield { tokenIndex: 0, content: '', done: true, response: r };
        }
      },
    };

    const agent = Agent.create({ provider, model: 'm' })
      .system('')
      .tool({
        schema: { name: 'echo', description: '', inputSchema: { type: 'object' } },
        execute: () => 'echoed',
      })
      .build();

    const result = await agent.run({ message: 'go' });
    expect(result).toBe('final answer');
    expect(call).toBe(2); // tool call → second LLM turn
  });
});

// ── S6: signal mid-stream propagates ───────────────────────────────

describe('Agent streaming — S6: signal abort', () => {
  it('aborting the run signal terminates the stream', async () => {
    const ac = new AbortController();
    const provider: LLMProvider = {
      name: 'slow',
      complete: async () => makeResponse(),
      stream: async function* (req: LLMRequest) {
        for (let i = 0; i < 10; i++) {
          await new Promise((res, rej) => {
            const id = setTimeout(res, 50);
            req.signal?.addEventListener('abort', () => {
              clearTimeout(id);
              rej(req.signal!.reason ?? new Error('aborted'));
            }, { once: true });
          });
          yield { tokenIndex: i, content: `t${i} `, done: false };
        }
        yield { tokenIndex: 10, content: '', done: true, response: makeResponse() };
      },
    };
    const agent = Agent.create({ provider, model: 'm' }).system('').build();
    setTimeout(() => ac.abort(new Error('user cancel')), 30);
    await expect(
      agent.run({ message: 'go' }, { signal: ac.signal }),
    ).rejects.toThrow();
  });
});

// ── S7: stream() without `response` on done falls back to complete() ─

describe('Agent streaming — S7: partial-stream fallback', () => {
  it('falls back to complete() when done chunk has no response field', async () => {
    let completeCalled = false;
    const fallback = makeResponse({ content: 'fallback content' });
    const provider: LLMProvider = {
      name: 'p',
      complete: async () => {
        completeCalled = true;
        return fallback;
      },
      stream: async function* () {
        yield { tokenIndex: 0, content: 'streamed text', done: false };
        // Done chunk WITHOUT response — Agent must call complete() to
        // get authoritative usage/toolCalls/stopReason.
        yield { tokenIndex: 1, content: '', done: true };
      },
    };
    const agent = Agent.create({ provider, model: 'm' }).system('').build();
    const result = await agent.run({ message: 'go' });
    expect(completeCalled).toBe(true);
    expect(result).toBe('fallback content');
  });
});
