/** Completed provider refusals survive a later resilience callback fault. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/provider-contract/types.js';
import {
  ProviderBlockedError,
  ProviderGuardrailLimitError,
  ProviderInterventionUnknownError,
  providerInterventionOf,
} from '../../../src/provider-contract/intervention.js';
import { withCircuitBreaker } from '../../../src/resilience/withCircuitBreaker.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { replayAttempts } from '../../../src/resilience/replayAttempt.js';

afterEach(() => vi.restoreAllMocks());

const request: LLMRequest = { model: 'scripted', messages: [] };
const ordinary: LLMResponse = {
  content: 'usable',
  toolCalls: [],
  usage: { input: 2, output: 3 },
  stopReason: 'end_turn',
};
type Door = 'complete' | 'stream';
type Kind = 'blocked' | 'unknown' | 'guardrail-limit' | 'ordinary' | 'masked';
const kinds: readonly Kind[] = ['blocked', 'unknown', 'guardrail-limit', 'ordinary', 'masked'];

function fixture(kind: Kind) {
  const limit = new ProviderGuardrailLimitError();
  const read = vi.fn(() => {
    throw new Error('unrelated response field');
  });
  const response: LLMResponse = {
    ...ordinary,
    ...(kind !== 'ordinary' &&
      kind !== 'guardrail-limit' && {
        intervention: { outcome: kind, code: 'guardrail_intervened', filters: [] },
      }),
  };
  if (kind === 'blocked' || kind === 'unknown') {
    for (const field of ['rawThinking', 'replayOmissions', 'stopReason'])
      Object.defineProperty(response, field, { enumerable: true, get: read });
  }
  return { response, limit, read };
}

function provider(run: () => LLMResponse): LLMProvider {
  return {
    name: 'scripted',
    complete: async () => run(),
    async *stream() {
      yield { tokenIndex: 0, content: '', done: true, response: run() };
    },
  };
}

async function invoke(source: LLMProvider, door: Door, hooks?: LLMCallHooks) {
  const chunks: LLMChunk[] = [];
  try {
    if (door === 'complete') return { response: await source.complete(request, hooks), chunks };
    for await (const chunk of source.stream!(request, hooks)) chunks.push(chunk);
    return { response: chunks.at(-1)?.response, chunks };
  } catch (error) {
    return { error, chunks, response: undefined };
  }
}

function expectTerminalFault(error: unknown, kind: Kind, cause: Error) {
  expect(error).toBeInstanceOf(
    kind === 'blocked' ? ProviderBlockedError : ProviderInterventionUnknownError,
  );
  expect((error as Error).cause).toBe(cause);
  expect(error).toHaveProperty('intervention', {
    outcome: kind,
    code: 'guardrail_intervened',
    filters: [],
  });
}

for (const door of ['complete', 'stream'] as const) {
  describe(`${door}: completed intervention recovery callback`, () => {
    for (const kind of kinds) {
      for (const throws of [true, false]) {
        it(`${kind} with ${throws ? 'throwing' : 'nonthrowing'} recovered hook`, async () => {
          const sample = fixture(kind);
          const fault = new Error('recovered callback fault');
          const run = vi.fn(() => {
            if (run.mock.calls.length === 1) throw new Error('scripted transport failure');
            if (run.mock.calls.length > 2) return ordinary;
            if (kind === 'guardrail-limit') throw sample.limit;
            return sample.response;
          });
          let faulted = false;
          const recovered = vi.fn();
          const onResilience: NonNullable<LLMCallHooks['onResilience']> = (report) => {
            if (report.kind !== 'recovered') return;
            recovered(report);
            if (throws && !faulted) {
              faulted = true;
              throw fault;
            }
          };
          // The existing zero-delay arm resolves without scheduling a timer.
          const source = withRetry(provider(run), { initialDelayMs: 0, maxAttempts: 3 });
          const result = await invoke(source, door, { onResilience });
          const terminal = kind === 'blocked' || kind === 'unknown';
          if (kind === 'guardrail-limit') {
            expect(result.error).toBe(sample.limit);
            expect(recovered).not.toHaveBeenCalled();
          } else if (terminal && throws) {
            expectTerminalFault(result.error, kind, fault);
            expect(result.response).toBeUndefined();
            expect(result.chunks).toHaveLength(0);
            expect(recovered).toHaveBeenCalledOnce();
          } else {
            expect(result.error).toBeUndefined();
            expect(result.response?.content).toBe(terminal ? '' : ordinary.content);
            expect(providerInterventionOf(result.response)?.outcome).toBe(
              terminal || (kind === 'masked' && !throws) ? kind : undefined,
            );
            expect(recovered).toHaveBeenCalledTimes(throws ? 2 : 1);
          }
          expect(run).toHaveBeenCalledTimes(
            throws && (kind === 'ordinary' || kind === 'masked') ? 3 : 2,
          );
          expect(sample.read).not.toHaveBeenCalled();
        });
      }
    }

    it('keeps a pre-result callback fault as the original error', async () => {
      const fault = new Error('retry notice failed before another response');
      const run = vi.fn(() => {
        throw new Error('scripted transport failure');
      });
      const source = withRetry(provider(run), { initialDelayMs: 0, maxAttempts: 3 });
      const result = await invoke(source, door, {
        onResilience(report) {
          if (report.kind === 'retried') throw fault;
        },
      });
      expect(result.error).toBe(fault);
      expect(run).toHaveBeenCalledOnce();
    });
  });

  describe(`${door}: completed intervention breaker callback inside fallback`, () => {
    for (const callback of ['state', 'report'] as const) {
      for (const kind of kinds) {
        for (const throws of [true, false]) {
          it(`${kind} with ${throws ? 'throwing' : 'nonthrowing'} ${callback} hook`, async () => {
            let now = 1_000;
            vi.spyOn(Date, 'now').mockImplementation(() => now);
            const sample = fixture(kind);
            const fault = new Error('closing callback fault');
            const run = vi.fn(() => {
              if (run.mock.calls.length === 1) throw new Error('scripted outage');
              if (kind === 'guardrail-limit') throw sample.limit;
              return sample.response;
            });
            const closed = vi.fn(() => {
              if (throws) throw fault;
            });
            const breaker = withCircuitBreaker(provider(run), {
              failureThreshold: 1,
              cooldownMs: 10,
              halfOpenSuccessThreshold: 1,
              onStateChange(state) {
                if (callback === 'state' && state === 'closed') closed();
              },
            });
            // Trip before mounting the fallback; advance the existing wall-clock seam.
            const seed = await invoke(breaker, door);
            expect(seed.error).toBeInstanceOf(Error);
            now += 10;
            const secondary = vi.fn(() => ({ ...ordinary, content: 'secondary' }));
            const source = withFallback(breaker, provider(secondary));
            const result = await invoke(source, door, {
              onResilience(report) {
                if (
                  callback === 'report' &&
                  report.kind === 'circuit-changed' &&
                  report.state === 'closed'
                )
                  closed();
              },
            });
            const terminal = kind === 'blocked' || kind === 'unknown';
            if (kind === 'guardrail-limit') {
              expect(result.error).toBe(sample.limit);
              expect(closed).not.toHaveBeenCalled();
            } else if (terminal && throws) {
              expectTerminalFault(result.error, kind, fault);
              expect(result.response).toBeUndefined();
              expect(result.chunks.every((chunk) => chunk.content === '')).toBe(true);
              expect(closed).toHaveBeenCalledOnce();
            } else if (throws && door === 'stream') {
              expect(result.error).toBe(fault);
              expect(result.chunks).toHaveLength(1);
              expect(closed).toHaveBeenCalledOnce();
            } else {
              expect(result.error).toBeUndefined();
              expect(result.response?.content).toBe(
                throws ? 'secondary' : terminal ? '' : ordinary.content,
              );
              expect(providerInterventionOf(result.response)?.outcome).toBe(
                terminal || (kind === 'masked' && !throws) ? kind : undefined,
              );
              expect(closed).toHaveBeenCalledOnce();
            }
            expect(run).toHaveBeenCalledTimes(2);
            expect(secondary).toHaveBeenCalledTimes(
              throws && !terminal && kind !== 'guardrail-limit' && door === 'complete' ? 1 : 0,
            );
            expect(sample.read).not.toHaveBeenCalled();
          });
        }
      }
    }
  });
}

describe('ordinary stream callback controls', () => {
  for (const kind of ['ordinary', 'masked'] as const) {
    for (const recovered of [false, true]) {
      it(`${kind} first chunk reads its response slot once (${
        recovered ? 'recovered' : 'first attempt'
      })`, async () => {
        const sample = fixture(kind);
        const reads: ReturnType<typeof vi.fn>[] = [];
        const calls = vi.fn();
        const source = withRetry(
          {
            name: 'scripted',
            complete: async () => sample.response,
            async *stream() {
              calls();
              if (recovered && calls.mock.calls.length === 1) throw new Error('scripted outage');
              const chunk: LLMChunk = { tokenIndex: 0, content: 'prefix', done: false };
              const read = vi.fn(() => {
                if (read.mock.calls.length > 1) throw new Error('response slot read twice');
                return undefined;
              });
              reads.push(read);
              Object.defineProperty(chunk, 'response', { get: read });
              yield chunk;
              yield { tokenIndex: 1, content: '', done: true, response: sample.response };
            },
          },
          { initialDelayMs: 0, maxAttempts: 3 },
        );
        const report = vi.fn();
        const result = await invoke(source, 'stream', { onResilience: report });
        expect(result.error).toBeUndefined();
        expect(result.response?.content).toBe(ordinary.content);
        expect(providerInterventionOf(result.response)?.outcome).toBe(
          kind === 'masked' ? 'masked' : undefined,
        );
        expect(calls).toHaveBeenCalledTimes(recovered ? 2 : 1);
        expect(reads).toHaveLength(1);
        expect(reads[0]).toHaveBeenCalledOnce();
        expect(result.chunks[0]?.content).toBe('prefix');
      });
    }
  }
});

it('breaker stream callback retains its first captured terminal response', async () => {
  const blocked = fixture('blocked');
  const unknown = fixture('unknown');
  const fault = new Error('closing callback fault');
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  let calls = 0;
  const breaker = withCircuitBreaker(
    {
      name: 'scripted',
      complete: async () => ordinary,
      async *stream() {
        calls++;
        if (calls === 1) throw new Error('scripted outage');
        yield { tokenIndex: 0, content: '', done: true, response: blocked.response };
        // The port admits one final response. A malformed later frame must not
        // replace terminal evidence the wrapper has already captured.
        yield { tokenIndex: 1, content: '', done: true, response: unknown.response };
      },
    },
    {
      failureThreshold: 1,
      cooldownMs: 10,
      halfOpenSuccessThreshold: 1,
      onStateChange(state) {
        if (state === 'closed') throw fault;
      },
    },
  );
  await invoke(breaker, 'stream');
  now += 10;
  const secondary = vi.fn(() => ordinary);
  const result = await invoke(withFallback(breaker, provider(secondary)), 'stream');
  expectTerminalFault(result.error, 'blocked', fault);
  expect(calls).toBe(2);
  expect(secondary).not.toHaveBeenCalled();
  expect(blocked.read).not.toHaveBeenCalled();
  expect(unknown.read).not.toHaveBeenCalled();
});

it('ordinary recovered stream ignores an unavailable response descriptor', async () => {
  const calls = vi.fn();
  const responseRead = vi.fn();
  const source = withRetry(
    {
      name: 'scripted',
      complete: async () => ordinary,
      async *stream() {
        calls();
        if (calls.mock.calls.length === 1) throw new Error('scripted outage');
        const chunk = new Proxy<LLMChunk>(
          { tokenIndex: 0, content: 'prefix', done: false },
          {
            get(target, key, receiver) {
              if (key === 'response') responseRead();
              return Reflect.get(target, key, receiver);
            },
            getOwnPropertyDescriptor(target, key) {
              if (key === 'response') throw new Error('optional descriptor unavailable');
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          },
        );
        yield chunk;
        yield { tokenIndex: 1, content: '', done: true, response: ordinary };
      },
    },
    { initialDelayMs: 0, maxAttempts: 3 },
  );
  const result = await invoke(source, 'stream', { onResilience: vi.fn() });
  expect(result.error).toBeUndefined();
  expect(result.response).toBe(ordinary);
  expect(calls).toHaveBeenCalledTimes(2);
  expect(responseRead).toHaveBeenCalledOnce();
});

it('ordinary recovered stream snapshots a foreign iterator value once', async () => {
  const calls = vi.fn();
  const valueRead = vi.fn(() => {
    if (valueRead.mock.calls.length > 2) throw new Error('extra iterator value read');
    return { tokenIndex: 0, content: 'prefix', done: false } satisfies LLMChunk;
  });
  const source = withRetry(
    {
      name: 'scripted',
      complete: async () => ordinary,
      stream() {
        calls();
        if (calls.mock.calls.length === 1) throw new Error('scripted outage');
        const first: IteratorResult<LLMChunk> = { done: false, value: undefined as never };
        Object.defineProperty(first, 'value', { get: valueRead });
        let step = 0;
        return {
          [Symbol.asyncIterator]() {
            return {
              async next(): Promise<IteratorResult<LLMChunk>> {
                step++;
                if (step === 1) return first;
                if (step === 2)
                  return {
                    done: false,
                    value: { tokenIndex: 1, content: '', done: true, response: ordinary },
                  };
                return { done: true, value: undefined };
              },
            };
          },
        };
      },
    },
    { initialDelayMs: 0, maxAttempts: 3 },
  );
  const result = await invoke(source, 'stream', { onResilience: vi.fn() });
  expect(result.error).toBeUndefined();
  expect(result.response).toBe(ordinary);
  expect(calls).toHaveBeenCalledTimes(2);
  expect(valueRead.mock.calls.length).toBeLessThanOrEqual(2);
  expect(result.chunks[0]?.content).toBe('prefix');
});

it('empty iterator results keep identity without reading value', async () => {
  const read = vi.fn(() => {
    throw new Error('done result has no yielded value');
  });
  const done = { done: true as const, value: undefined };
  Object.defineProperty(done, 'value', { get: read });
  const inner = { next: vi.fn(async () => done) };
  expect(await replayAttempts(request).iterator(inner).next()).toBe(done);
  expect(read).not.toHaveBeenCalled();
  expect(inner.next).toHaveBeenCalledOnce();
});
