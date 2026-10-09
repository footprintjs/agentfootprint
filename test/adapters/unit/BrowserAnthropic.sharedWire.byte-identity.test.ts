/**
 * Byte identity — `browserAnthropic()` after its Messages body, response mapping
 * and stream assembly moved into `anthropicMessagesWire.ts` (shared with
 * `invokeModelGateway()`).
 *
 * The reference file was captured from the adapter BEFORE the move: request
 * bodies, the complete() response and every streamed chunk, for each
 * `parallelToolCalls` setting. The inputs drive every branch — system message
 * dropped, thinking blocks first with byte-exact signatures, coalesced tool
 * results, an empty assistant turn, all three cache-marker fields, forced tool
 * choice, thinking budget bump, cache usage, and a malformed tool-argument
 * block (which this adapter has always turned into `{}`).
 *
 * ONE deliberate change since the capture: the empty assistant turn is now
 * DROPPED from the body (it was sent as `content: ''`, which the API refuses
 * anywhere but a final prefill) — the reference was edited by removing exactly
 * that element and nothing else. See anthropicMessagesWire · toAnthropicMessages.
 *
 * A SECOND deliberate change: a redacted thinking block is echoed as Anthropic
 * takes it, `{ type: 'redacted_thinking', data }` — it was sent as
 * `{ type, signature }`, which the API rejects. The reference was edited by
 * renaming exactly that key in the six bodies that carry the block.
 *
 * A THIRD: the thinking shape is chosen per model (anthropicThinkingWire.ts),
 * and the old inputs asked for three things the API rejects while thinking —
 * temperature 0.2, a budget of 100 (below 1,024), and a forced tool choice
 * with budget thinking. The inputs now ask what a real request can: temperature
 * 1, a budget of 1100 (still above maxTokens, so the bump still fires), on
 * `claude-opus-4-8` (the provider's default model here, so the `'anthropic'`
 * shorthand is still resolved), which thinks adaptively and takes a forced
 * tool choice. The reference was edited in exactly four keys of the six
 * bodies — `model`, `max_tokens` (1124 → 2124), `temperature` (0.2 → 1) and
 * `thinking` (`{ type: 'enabled', budget_tokens: 100 }` →
 * `{ type: 'adaptive', display: 'summarized' }`) — and nothing else.
 *
 * Test type (Convention 3): byte identity.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { REQ, rec } from './anthropicWireFixtures.js';

const REFERENCE = JSON.parse(
  readFileSync(new URL('../reference/browser-anthropic-wire.json', import.meta.url), 'utf8'),
) as Record<string, { bodies: string[]; complete: unknown; chunks: unknown[] }>;

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('browserAnthropic is byte-identical after the shared-wire move', () => {
  for (const parallelToolCalls of [undefined, false, true]) {
    it(`parallelToolCalls=${String(parallelToolCalls)}: bodies, response and chunks`, async () => {
      const expected = REFERENCE[`parallelToolCalls=${String(parallelToolCalls)}`]!;
      const bodies: string[] = [];
      const complete = await browserAnthropic({
        apiKey: 'k',
        defaultModel: 'claude-opus-4-8',
        parallelToolCalls,
        _fetch: rec(bodies, false),
      }).complete(REQ);
      const provider = browserAnthropic({
        apiKey: 'k',
        defaultModel: 'claude-opus-4-8',
        parallelToolCalls,
        _fetch: rec(bodies, true),
      });
      const chunks = await drain(provider.stream!(REQ));
      expect(bodies).toStrictEqual(expected.bodies);
      expect(JSON.parse(JSON.stringify(complete))).toStrictEqual(expected.complete);
      expect(JSON.parse(JSON.stringify(chunks))).toStrictEqual(expected.chunks);
    });
  }
});
