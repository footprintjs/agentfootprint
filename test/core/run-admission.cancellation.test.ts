import { describe, expect, it } from 'vitest';
import { LLMCall } from '../../src/core/LLMCall.js';
import { Parallel } from '../../src/core-flow/Parallel.js';
import { mock } from '../../src/doors/providers.js';
import type { RunOptions } from '../../src/core/runner.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function settled<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

describe('native-owned AF calls retain the signal/environment/deadline contract', () => {
  for (const family of ['LLMCall', 'Parallel merge'] as const) {
    for (const source of [
      'caller',
      'caller-empty-env',
      'environment',
      'dual-caller',
      'dual-environment',
      'deadline-with-caller',
    ] as const) {
      it(`${family}: ${source} cancels the in-flight provider and permits reuse`, async () => {
        const reached = barrier();
        const held = barrier();
        const seen: Array<AbortSignal | undefined> = [];
        const provider: LLMProvider = {
          name: 'mock',
          complete: async (request) => {
            seen.push(request.signal);
            reached.release();
            await held.promise;
            return {
              content: 'late answer',
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'stop',
            };
          },
        };
        const runner =
          family === 'LLMCall'
            ? LLMCall.create({ provider, model: 'mock' }).build()
            : Parallel.create()
                .branch(
                  'a',
                  LLMCall.create({ provider: mock({ reply: 'a' }), model: 'mock' }).build(),
                )
                .branch(
                  'b',
                  LLMCall.create({ provider: mock({ reply: 'b' }), model: 'mock' }).build(),
                )
                .mergeWithLLM({ provider, model: 'mock', prompt: 'merge' })
                .build();
        const caller = new AbortController();
        const environment = new AbortController();
        const reason = new Error('cancelled by owner');
        const options: RunOptions =
          source === 'environment'
            ? { env: { signal: environment.signal } }
            : source === 'caller'
            ? { signal: caller.signal }
            : source === 'caller-empty-env'
            ? { signal: caller.signal, env: {} }
            : source === 'deadline-with-caller'
            ? { signal: caller.signal, timeoutMs: 100 }
            : { signal: caller.signal, env: { signal: environment.signal } };
        const pending = settled(runner.run({ message: 'go' }, options));
        try {
          await reached.promise;
          expect(seen[0]).toBeDefined();
          if (source !== 'deadline-with-caller') {
            (source === 'environment' || source === 'dual-environment'
              ? environment
              : caller
            ).abort(reason);
          }
          const result = await Promise.race([
            pending,
            new Promise<undefined>((resolve) => setTimeout(resolve, 300)),
          ]);
          expect(result).toHaveProperty('error');
          expect(seen[0]?.aborted).toBe(true);
        } finally {
          held.release();
          await pending;
        }
        await expect(runner.run({ message: 'next' })).resolves.toBe('late answer');
      });
    }
  }
});
