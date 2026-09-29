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
        parallelToolCalls,
        _fetch: rec(bodies, false),
      }).complete(REQ);
      const provider = browserAnthropic({
        apiKey: 'k',
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
