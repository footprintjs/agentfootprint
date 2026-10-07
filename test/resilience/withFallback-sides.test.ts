/**
 * withFallback hands each side only the cache markers THAT side declares.
 *
 * The pair asks the agent for breakpoints when either side takes them, so a
 * side that declared nothing must never see the field — `withFallback(
 * invokeModelGateway(…), anthropic())` used to send the gateway two
 * `cache_control` markers that the bare gateway (and main) never sends.
 *
 * Test types: regression (the gateway repro, real adapters, $0) / unit (per
 * side: none, breakpoints sliced to its own count, automatic) / scenario (the
 * stream path's fallback).
 */

import { describe, expect, it } from 'vitest';

import type { CacheMarker } from '../../src/cache/types.js';
import type { LLMChunk, LLMProvider, LLMRequest } from '../../src/adapters/types.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { invokeModelGateway } from '../../src/adapters/llm/InvokeModelGatewayProvider.js';
import { withFallback } from '../../src/resilience/withFallback.js';

const markers = (n: number): CacheMarker[] =>
  Array.from({ length: n }, (_, i) => ({
    field: 'messages' as const,
    boundaryIndex: i,
    ttl: 'short' as const,
    reason: `m${i}`,
  }));

const REQ: LLMRequest = {
  model: 'm',
  systemPrompt: 'You are terse.',
  messages: [{ role: 'user', content: 'hi' }],
  cacheMarkers: [{ field: 'system', boundaryIndex: 0, ttl: 'short', reason: 's' }, ...markers(1)],
};

/** A side that records the request it was handed. */
function side(promptCaching: LLMProvider['promptCaching'], down = false) {
  const seen: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'side',
    ...(promptCaching !== undefined && { promptCaching }),
    complete: async (req) => {
      seen.push(req);
      if (down) throw new Error('down');
      return { content: 'ok', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
  return { seen, provider };
}

describe('withFallback — markers reach only the side that declares them', () => {
  it('regression: the undeclared gateway gets NO cache_control when paired with anthropic()', async () => {
    const bodies: string[] = [];
    const gateway = invokeModelGateway({
      baseUrl: 'https://gw.example',
      apiKeyHeader: 'x-api-key',
      apiKey: 'k',
      model: 'claude',
      fetch: async (_url, init) => {
        bodies.push(String(init?.body));
        return new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const pair = withFallback(gateway, anthropic({ _client: {} as never }));
    expect(pair.promptCaching?.mode).toBe('breakpoints'); // the agent still places them
    await pair.complete(REQ);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.split('cache_control').length - 1).toBe(0);
  });

  it('a side that declares nothing — or automatic caching — is handed no cacheMarkers field', async () => {
    for (const declared of [undefined, { mode: 'automatic', reportsUsage: false } as const]) {
      const a = side(declared);
      const b = side({ mode: 'breakpoints', maxBreakpoints: 4, reportsUsage: true });
      await withFallback(a.provider, b.provider).complete(REQ);
      expect('cacheMarkers' in a.seen[0]!).toBe(false);
      expect(b.seen).toHaveLength(0);
    }
  });

  it('a breakpoint side gets the markers sliced to ITS OWN count', async () => {
    const down = side(undefined, true);
    const two = side({ mode: 'breakpoints', maxBreakpoints: 2, reportsUsage: true });
    await withFallback(down.provider, two.provider).complete({ ...REQ, cacheMarkers: markers(4) });
    expect('cacheMarkers' in down.seen[0]!).toBe(false);
    expect(two.seen[0]!.cacheMarkers?.map((m) => m.reason)).toEqual(['m0', 'm1']);
  });

  it('the stream path hands the fallback the same, side-shaped request', async () => {
    const seen: LLMRequest[] = [];
    const failing: LLMProvider = {
      name: 'down',
      complete: async () => {
        throw new Error('down');
      },
      stream: (): AsyncIterable<LLMChunk> => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new Error('down')),
        }),
      }),
    };
    const undeclared: LLMProvider = {
      name: 'plain',
      complete: async (req) => {
        seen.push(req);
        return { content: 'ok', toolCalls: [], usage: { input: 0, output: 0 } };
      },
    };
    const pair = withFallback(
      { ...failing, promptCaching: { mode: 'breakpoints', maxBreakpoints: 4, reportsUsage: true } },
      undeclared,
    );
    for await (const _chunk of pair.stream!(REQ)) {
      // drain
    }
    expect(seen).toHaveLength(1);
    expect('cacheMarkers' in seen[0]!).toBe(false);
  });
});
