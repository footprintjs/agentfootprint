import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Providers from '../../../src/doors/providers.js';

const root = resolve(__dirname, '../../..');
const requireCjs = createRequire(resolve(root, 'package.json'));
const paths = [
  ['cjs', resolve(root, 'dist/doors/providers.js')],
  ['esm', resolve(root, 'dist/esm/doors/providers.js')],
] as const;
const built = paths.every(([, path]) => existsSync(path));

it('has both built public provider doors under CI', () => {
  if (process.env.CI) expect(built, 'build before testing public formats').toBe(true);
});

afterEach(() => vi.useRealTimers());

if (built)
  for (const [format, path] of paths) {
    const providers = (
      format === 'cjs' ? requireCjs(path) : await import(pathToFileURL(path).href)
    ) as typeof Providers;
    describe(`Bedrock deadline public ${format} package`, () => {
      it.each(['complete', 'stream'] as const)(
        'exports the shared timeout and aborts a stalled %s call',
        async (door) => {
          vi.useFakeTimers();
          let signal: AbortSignal | undefined;
          class Command {
            constructor(readonly input: unknown) {}
          }
          const provider = providers.bedrock({
            timeoutMs: 20,
            _commands: { Converse: Command, ConverseStream: Command },
            _client: {
              send: async (_cmd, options) => {
                signal = options?.abortSignal;
                return new Promise(() => undefined);
              },
            },
          });
          const request = { model: 'bedrock', messages: [] };
          const call =
            door === 'complete'
              ? provider.complete(request)
              : provider.stream!(request)[Symbol.asyncIterator]().next();
          const pending = call.then(
            () => {
              throw new Error('fixture unexpectedly resolved');
            },
            (error) => error,
          );
          await vi.advanceTimersByTimeAsync(20);
          const error = await pending;
          expect(error).toBeInstanceOf(providers.ProviderTimeoutError);
          expect(providers.isProviderTimeout(error)).toBe(true);
          expect(error).toMatchObject({
            code: 'ERR_PROVIDER_TIMEOUT',
            waitingFor: 'response',
            retryable: true,
          });
          expect(signal?.aborted).toBe(true);
          expect(vi.getTimerCount()).toBe(0);
        },
      );
    });
  }
