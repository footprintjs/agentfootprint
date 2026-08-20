/**
 * A `CacheMarker{field:'messages'}` must mark the message it names — on the
 * ACTUAL Anthropic body, not on the request array it was measured against.
 *
 * ── Two arrays, one ordinal ──────────────────────────────────────────
 * The marker's `boundaryIndex` is a position in `LLMRequest.messages`. The body
 * this provider sends is a DIFFERENT array: `role: 'system'` messages are
 * dropped (system is a separate top-level field) and consecutive `role: 'tool'`
 * messages are coalesced into one user turn. Applying the marker by raw ordinal
 * therefore drifts — by one position per tool round-trip — and lands the cache
 * breakpoint on a turn that changes every iteration, which is the one place a
 * prefix cache can never be reused.
 *
 * It went unnoticed because it could not fire: nothing could target the
 * messages slot between 7.19.1 and 7.21.0, and while a delivered message is
 * still the very last one the clamp hides the drift. Delivery plus one tool
 * round-trip is what exposes it.
 *
 * Test types (Convention 3): unit (the body builder, fake fetch) / regression
 * (the index-space mismatch) / contract (marker ↔ wire).
 */

import { describe, expect, it } from 'vitest';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

interface AnthropicBody {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly content: string | ReadonlyArray<Record<string, unknown>>;
  }>;
}

function capturingProvider(): {
  provider: ReturnType<typeof browserAnthropic>;
  bodies: AnthropicBody[];
} {
  const bodies: AnthropicBody[] = [];
  const provider = browserAnthropic({
    apiKey: 'sk-test',
    _fetch: ((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(init.body as string) as AnthropicBody);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'msg_1',
            model: 'claude-sonnet-4-5-20250929',
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as typeof fetch,
  });
  return { provider, bodies };
}

/** The block that actually carries `cache_control`, and the text it belongs to. */
function markedText(body: AnthropicBody): string | undefined {
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if ((block as { cache_control?: unknown }).cache_control === undefined) continue;
      return (block.text ?? block.content) as string;
    }
  }
  return undefined;
}

describe('messages cache marker — index translated into the Anthropic body', () => {
  it('marks the named message after tool results have collapsed the array', async () => {
    const { provider, bodies } = capturingProvider();

    // Request array (7 messages). The delivered note is at index 5 — and the
    // three tool results before it collapse into ONE body turn, so the body is
    // shorter and index 5 means something else in it.
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
    const body = bodies[0]!;
    // The body really is shorter — this is the divergence, stated.
    expect(body.messages.length).toBeLessThan(req.messages.length);
    // And the mark landed on the message the index named.
    expect(markedText(body)).toBe('DELIVERED NOTE');
  });

  it('still marks correctly when the named message is the last one', async () => {
    // The case the old clamp got right by accident — it must keep working.
    const { provider, bodies } = capturingProvider();
    await provider.complete({
      model: 'anthropic',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'DELIVERED NOTE' },
      ],
      cacheMarkers: [{ field: 'messages', boundaryIndex: 1, ttl: 'short', reason: 'test' }],
    });
    expect(markedText(bodies[0]!)).toBe('DELIVERED NOTE');
  });

  it('marks nothing when the named message does not survive the transform', async () => {
    // A `role: 'system'` message is dropped from the body entirely. Marking its
    // neighbour instead would claim a cache boundary nobody declared.
    const { provider, bodies } = capturingProvider();
    await provider.complete({
      model: 'anthropic',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'SYSTEM NOTE' },
        { role: 'assistant', content: 'reply' },
      ],
      cacheMarkers: [{ field: 'messages', boundaryIndex: 1, ttl: 'short', reason: 'test' }],
    });
    expect(markedText(bodies[0]!)).toBeUndefined();
  });
});

describe("the API's cache counts come back on usage (browser path)", () => {
  it('maps cache_read/cache_creation onto cacheRead/cacheWrite, absent stays absent', async () => {
    const bodies: AnthropicBody[] = [];
    const provider = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: ((_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body) bodies.push(JSON.parse(init.body as string) as AnthropicBody);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'msg_1',
              model: 'claude-sonnet-4-5-20250929',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
              usage: {
                input_tokens: 100,
                output_tokens: 5,
                cache_read_input_tokens: 7700,
                cache_creation_input_tokens: 42,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }) as typeof fetch,
    });
    const res = await provider.complete({
      model: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.usage.cacheRead).toBe(7700);
    expect(res.usage.cacheWrite).toBe(42);

    // And the plain shape reports nothing rather than zero.
    const plain = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'msg_2',
              model: 'claude-sonnet-4-5-20250929',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )) as typeof fetch,
    });
    const bare = await plain.complete({
      model: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect('cacheRead' in bare.usage).toBe(false);
    expect('cacheWrite' in bare.usage).toBe(false);
  });
});
