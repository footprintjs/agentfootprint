/**
 * A transport close that ignores cancellation must not outlive the gateway's
 * configured wait cap. Run the real source and built CJS/ESM adapter over an
 * injected ReadableStream; no network or model calls.
 * Test types: Boundary (hung close), Integration (the two published formats).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as source from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import type { LLMChunk } from '../../../src/provider-contract/types.js';

async function text(iterator: AsyncIterator<LLMChunk>): Promise<void> {
  for (;;) {
    const step = await iterator.next();
    if (step.done) throw new Error('fixture ended before text');
    if (step.value.content.length > 0) return;
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const requireCjs = createRequire(import.meta.url);
const builtFiles = [
  ['esm', resolve(repoRoot, 'dist/esm/adapters/llm/InvokeModelGatewayProvider.js')],
  ['cjs', resolve(repoRoot, 'dist/adapters/llm/InvokeModelGatewayProvider.js')],
] as const;
const built = builtFiles.every(([, file]) => existsSync(file));

it('the build is present under CI', () => {
  if (process.env.CI) expect(built, 'run npm run build before testing the package').toBe(true);
});

const implementations: [string, typeof source][] = [['source', source]];
if (built) {
  for (const [format, file] of builtFiles) {
    const mod: unknown =
      format === 'esm' ? await import(pathToFileURL(file).href) : requireCjs(file);
    implementations.push([format, mod as typeof source]);
  }
}

for (const [format, { invokeModelGateway, InvokeModelGatewayError }] of implementations) {
  describe(`gateway close — ${format}`, () => {
    it('timeout bounds a transport close that never settles', async () => {
      let signal: AbortSignal | undefined;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"fixture"}}\n\n',
            ),
          );
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => undefined);
        },
      });
      const provider = invokeModelGateway({
        baseUrl: 'https://offline.invalid/gateway',
        apiKeyHeader: 'x-api-key',
        apiKey: 'synthetic-not-a-credential',
        timeoutMs: 20,
        fetch: async (_input, init) => {
          signal = init?.signal ?? undefined;
          return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
        },
      });
      const iterator = provider.stream!({
        model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        messages: [{ role: 'user', content: 'offline' }],
      })[Symbol.asyncIterator]();
      await text(iterator);
      const closing = iterator.return!().then(
        () => ({ outcome: 'resolved' as const }),
        (error: unknown) => ({ outcome: 'rejected' as const, error }),
      );
      let guard: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        closing,
        new Promise<{ outcome: 'pending' }>((resolve) => {
          guard = setTimeout(() => resolve({ outcome: 'pending' }), 150);
        }),
      ]).finally(() => clearTimeout(guard));
      expect(cancelled).toBe(true);
      expect(result.outcome).toBe('rejected');
      if (result.outcome === 'rejected') {
        expect(result.error).toBeInstanceOf(InvokeModelGatewayError);
        expect((result.error as source.InvokeModelGatewayError).reason).toBe('timeout');
      }
      expect(signal?.aborted).toBe(true);
    });
  });
}
