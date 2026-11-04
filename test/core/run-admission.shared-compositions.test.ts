import { describe, expect, it } from 'vitest';

import { LLMCall } from '../../src/core/LLMCall.js';
import { graph } from '../../src/core-flow/Graph.js';
import { Parallel } from '../../src/core-flow/Parallel.js';
import { workflow } from '../../src/core-flow/Workflow.js';
import { mock } from '../../src/doors/providers.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function settled<T>(run: Promise<T>) {
  return run.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

describe('shared composition mapper failures belong to the actual parent runtime', () => {
  for (const family of ['Graph', 'Parallel'] as const) {
    for (const mirror of [false, true]) {
      it(`${family} keeps reverse-completing parent errors separate (mirror=${mirror})`, async () => {
        const reached = barrier();
        const waiting = barrier();
        const provider: LLMProvider = {
          name: 'mock',
          complete: async (request) => {
            const input =
              request.messages.find((message) => message.role === 'user')?.content ?? '';
            if (input === 'left') {
              reached.release();
              await waiting.promise;
            }
            return {
              content: String(input),
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'stop',
            };
          },
        };
        const leaf = Object.assign(LLMCall.create({ provider, model: 'mock' }).build(), {
          outcomeOf(output: unknown): never {
            throw new Error(`mapper-${String(output)}`);
          },
        });
        const shared =
          family === 'Graph'
            ? graph({ nodes: [{ id: 'leaf', runner: leaf }], edges: [] })
            : Parallel.create()
                .branch('leaf', leaf)
                .branch(
                  'other',
                  LLMCall.create({ provider: mock({ reply: 'other' }), model: 'mock' }).build(),
                )
                .mergeOutcomesWithFn((rows) =>
                  rows.leaf!.ok ? rows.leaf!.value : rows.leaf!.error,
                )
                .build();
        const left = workflow(shared);
        const right = workflow(shared);
        const options = mirror ? { redact: { keys: [] } } : undefined;
        const first = settled(left.run({ message: 'left' }, options));
        try {
          await reached.promise;
          if (family === 'Graph') {
            await expect(right.run({ message: 'right' }, options)).rejects.toThrow('mapper-right');
          } else {
            await expect(right.run({ message: 'right' }, options)).resolves.toBe('mapper-right');
          }
        } finally {
          waiting.release();
          await first;
        }
        const result = await first;
        if (family === 'Graph') {
          expect(result).toHaveProperty('error');
          if ('error' in result)
            expect(result.error).toMatchObject({ message: expect.stringContaining('mapper-left') });
        } else {
          expect(result).toEqual({ value: 'mapper-left' });
        }
        expect(shared.getSnapshot()).toBeUndefined();
      });
    }
  }
});
