/**
 * The server Anthropic adapter keeps BOTH halves of the cache contract.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 * `AnthropicCacheStrategy` registers for `'anthropic'` and
 * `'browser-anthropic'` alike, and `callLLM` puts the prepared markers on
 * every request — but the server adapter used to drop them on the floor and
 * reported no cache tokens back. So on the server path a byte-identical
 * prompt prefix (measured at ~65% of every call on a real recording) was
 * paid at full rate, and the miss was not even OBSERVABLE: the usage carried
 * no cacheRead/cacheWrite for any meter to read. This suite pins the wiring:
 * markers reach the wire as `cache_control`, and the API's cache counts come
 * back on `usage` — absent stays absent, never invented as zero.
 *
 * Test types (Convention 3): unit (buildParams via `_client` capture) /
 * contract (marker ↔ wire, usage ↔ port) / regression (the index-space
 * mismatch already pinned for the browser twin — same behavior, shared code).
 */

import { describe, expect, it } from 'vitest';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

interface CapturedParams {
  readonly system?: unknown;
  readonly tools?: ReadonlyArray<Record<string, unknown>>;
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly content: string | ReadonlyArray<Record<string, unknown>>;
  }>;
}

function capturingProvider(usage?: Record<string, number>): {
  provider: ReturnType<typeof anthropic>;
  params: CapturedParams[];
} {
  const params: CapturedParams[] = [];
  const provider = anthropic({
    _client: {
      messages: {
        create(p: unknown) {
          params.push(p as CapturedParams);
          return Promise.resolve({
            id: 'msg_1',
            model: 'claude-sonnet-4-5-20250929',
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'ok' }],
            stop_reason: 'end_turn',
            usage: usage ?? { input_tokens: 1, output_tokens: 1 },
          });
        },
        stream() {
          throw new Error('not used in this suite');
        },
      },
    } as never,
  });
  return { provider, params };
}

/** The block that carries `cache_control`, and the text it belongs to. */
function markedText(body: CapturedParams): string | undefined {
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if ((block as { cache_control?: unknown }).cache_control === undefined) continue;
      return (block.text ?? block.content) as string;
    }
  }
  return undefined;
}

describe('cache markers reach the server wire', () => {
  it('marks the system prompt (string → text-block array with cache_control)', async () => {
    const { provider, params } = capturingProvider();
    await provider.complete({
      model: 'anthropic',
      systemPrompt: 'THE STABLE PREFIX',
      messages: [{ role: 'user', content: 'hi' }],
      cacheMarkers: [{ field: 'system', boundaryIndex: 0, ttl: 'short', reason: 'test' }],
    });
    const system = params[0]!.system as ReadonlyArray<Record<string, unknown>>;
    expect(Array.isArray(system)).toBe(true);
    expect(system[0]!.text).toBe('THE STABLE PREFIX');
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('marks the named tool, and long ttl reaches the wire as 1h', async () => {
    const { provider, params } = capturingProvider();
    await provider.complete({
      model: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'a', description: 'A', inputSchema: {} },
        { name: 'b', description: 'B', inputSchema: {} },
      ],
      cacheMarkers: [{ field: 'tools', boundaryIndex: 1, ttl: 'long', reason: 'test' }],
    });
    const tools = params[0]!.tools!;
    expect(tools[0]!.cache_control).toBeUndefined();
    expect(tools[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('translates a messages marker across tool-result coalescing (the browser-pinned drift)', async () => {
    const { provider, params } = capturingProvider();
    // Index 5 in the request is the delivered note; the three tool results
    // before it collapse into ONE body turn, so raw ordinal 5 would drift.
    const req: LLMRequest = {
      model: 'anthropic',
      messages: [
        { role: 'user', content: 'is it raining?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', name: 'w', args: {} },
            { id: 'c2', name: 'w', args: {} },
            { id: 'c3', name: 'w', args: {} },
          ],
        },
        { role: 'tool', content: 'r1', toolCallId: 'c1' },
        { role: 'tool', content: 'r2', toolCallId: 'c2' },
        { role: 'tool', content: 'r3', toolCallId: 'c3' },
        { role: 'assistant', content: 'DELIVERED NOTE' },
        { role: 'user', content: 'and now?' },
      ],
      cacheMarkers: [{ field: 'messages', boundaryIndex: 5, ttl: 'short', reason: 'test' }],
    };
    await provider.complete(req);
    const body = params[0]!;
    expect(body.messages.length).toBeLessThan(req.messages.length);
    expect(markedText(body)).toBe('DELIVERED NOTE');
  });

  it('marks nothing when the named message did not survive the transform', async () => {
    const { provider, params } = capturingProvider();
    await provider.complete({
      model: 'anthropic',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'SYSTEM NOTE' },
        { role: 'assistant', content: 'reply' },
      ],
      cacheMarkers: [{ field: 'messages', boundaryIndex: 1, ttl: 'short', reason: 'test' }],
    });
    expect(markedText(params[0]!)).toBeUndefined();
  });

  it('sends a clean wire when no markers ride the request', async () => {
    const { provider, params } = capturingProvider();
    await provider.complete({
      model: 'anthropic',
      systemPrompt: 'plain',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(typeof params[0]!.system).toBe('string');
    expect(markedText(params[0]!)).toBeUndefined();
  });
});

describe("the API's cache counts come back on usage", () => {
  it('maps cache_read/cache_creation onto cacheRead/cacheWrite', async () => {
    const { provider } = capturingProvider({
      input_tokens: 100,
      output_tokens: 5,
      cache_read_input_tokens: 7700,
      cache_creation_input_tokens: 42,
    });
    const res = await provider.complete({
      model: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.usage.cacheRead).toBe(7700);
    expect(res.usage.cacheWrite).toBe(42);
  });

  it('leaves cacheRead/cacheWrite ABSENT when the API reported nothing — never zero', async () => {
    const { provider } = capturingProvider({ input_tokens: 100, output_tokens: 5 });
    const res = await provider.complete({
      model: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect('cacheRead' in res.usage).toBe(false);
    expect('cacheWrite' in res.usage).toBe(false);
  });
});
