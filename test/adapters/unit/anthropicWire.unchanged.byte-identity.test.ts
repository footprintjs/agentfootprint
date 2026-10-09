/**
 * Byte identity — what did NOT change when the thinking shape went per model.
 *
 * The thinking request is now decided per model (anthropicThinkingWire.ts), and
 * `anthropic()` builds its whole body through the shared `buildMessagesBody`
 * (it kept a private copy before). Neither may move a byte of a body that was
 * already right: a BUDGET model's thinking request (Sonnet 4.5, the adapters'
 * default model, through the `'anthropic'` shorthand) and a request that asks
 * no thinking at all (with temperature 0.2 and a forced tool choice, which ride
 * a non-thinking body on every model).
 *
 * The reference file was captured from the adapters BEFORE the change
 * (origin/main at 9cbd62dd): `anthropic()` through a stand-in SDK client and
 * `browserAnthropic()` through a stand-in fetch, complete() and stream(), for
 * each `parallelToolCalls` setting — 24 bodies. Every branch of the body
 * builder that these requests can reach is in them: the system message
 * dropped, thinking blocks first with byte-exact signatures, a redacted block,
 * coalesced tool results, all three cache-marker fields, the parallel cap, the
 * forced choice (no-thinking request), stop sequences and the max_tokens bump.
 *
 * Test type (Convention 3): byte identity.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';
import { MSG, REQ_BUDGET, REQ_PLAIN, rec } from './anthropicWireFixtures.js';

const REFERENCE = JSON.parse(
  readFileSync(new URL('../reference/anthropic-wire-unchanged.json', import.meta.url), 'utf8'),
) as Record<string, string[]>;

/** A stand-in SDK client that records each params object as the bytes it would send. */
function sdk(bodies: string[]) {
  const record = (params: unknown) => {
    bodies.push(JSON.stringify(params));
    return MSG;
  };
  return {
    messages: {
      create: async (params: unknown) => record(params),
      stream: (params: unknown) => {
        const reply = record(params);
        return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => reply };
      },
    },
  } as never;
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) void _chunk;
}

describe('bodies the per-model thinking change must not move', () => {
  const requests: ReadonlyArray<readonly [string, LLMRequest]> = [
    ['budget', REQ_BUDGET],
    ['plain', REQ_PLAIN],
  ];
  for (const [name, req] of requests) {
    for (const parallelToolCalls of [undefined, false, true]) {
      const key = `${name} parallelToolCalls=${String(parallelToolCalls)}`;

      it(`anthropic() — ${key}`, async () => {
        const bodies: string[] = [];
        const provider = anthropic({ parallelToolCalls, _client: sdk(bodies) });
        await provider.complete(req);
        await drain(provider.stream!(req));
        expect(bodies).toStrictEqual(REFERENCE[`anthropic ${key}`]);
      });

      it(`browserAnthropic() — ${key}`, async () => {
        const bodies: string[] = [];
        await browserAnthropic({
          apiKey: 'k',
          parallelToolCalls,
          _fetch: rec(bodies, false),
        }).complete(req);
        await drain(
          browserAnthropic({ apiKey: 'k', parallelToolCalls, _fetch: rec(bodies, true) }).stream!(
            req,
          ),
        );
        expect(bodies).toStrictEqual(REFERENCE[`browserAnthropic ${key}`]);
      });
    }
  }

  it('the reference holds what its name says: a budget body, and a body with no thinking', () => {
    const budget = JSON.parse(REFERENCE['anthropic budget parallelToolCalls=undefined']![0]!);
    const plain = JSON.parse(REFERENCE['anthropic plain parallelToolCalls=undefined']![0]!);
    expect(budget).toMatchObject({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2124,
      thinking: { type: 'enabled', budget_tokens: 1100 },
    });
    expect('temperature' in budget).toBe(false);
    expect(plain).toMatchObject({ temperature: 0.2, tool_choice: { type: 'tool', name: 't' } });
    expect('thinking' in plain).toBe(false);
  });
});
