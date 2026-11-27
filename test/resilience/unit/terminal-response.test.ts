/** Provider policy outcomes survive wrapper metadata without another request. */
import { describe, expect, it, vi } from 'vitest';
import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/provider-contract/types.js';
import {
  interventionErrorOf,
  ProviderBlockedError,
  ProviderInterventionUnknownError,
  providerInterventionOf,
} from '../../../src/provider-contract/intervention.js';
import { replayAttempts } from '../../../src/resilience/replayAttempt.js';
import { withCircuitBreaker } from '../../../src/resilience/withCircuitBreaker.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import type { ThinkingHandler } from '../../../src/thinking/types.js';
import { replayMessageFingerprint } from '../../../src/thinking/replayHistory.js';

const request: LLMRequest = {
  model: 'scripted',
  systemPrompt: 'fixture',
  messages: [{ role: 'assistant', content: 'prior', thinkingBlocks: [] }],
};
const normal: LLMResponse = {
  content: 'usable',
  toolCalls: [],
  usage: { input: 2, output: 3 },
  stopReason: 'end_turn',
};
const omission = {
  messageIndex: 0,
  blockIndex: 0,
  reason: 'prefix-changed' as const,
  messageFingerprint: replayMessageFingerprint(request.messages[0]!),
};
const firstHandler: ThinkingHandler = { id: 'first', normalize: () => [] };
const otherHandler: ThinkingHandler = { id: 'other', normalize: () => [] };
type Door = 'complete' | 'stream';
type Outcome = 'blocked' | 'unknown';
type HostileField = 'rawThinking' | 'replayOmissions';

function scripted(answer: LLMResponse, name = 'primary', handler = firstHandler) {
  const called = vi.fn();
  const provider: LLMProvider = {
    name,
    thinkingHandler: handler,
    async complete() {
      called();
      return answer;
    },
    async *stream() {
      called();
      yield { content: '', tokenIndex: 0, done: true, response: answer };
    },
  };
  return { provider, called };
}

function hostile(outcome: Outcome, field: HostileField) {
  const read = vi.fn(() => {
    throw new Error(`unrelated ${field}`);
  });
  const answer: LLMResponse = {
    ...normal,
    content: 'withheld',
    intervention: { outcome, code: 'guardrail_intervened', filters: [] },
  };
  Object.defineProperty(answer, field, { enumerable: true, get: read });
  return { answer, read };
}

async function invoke(provider: LLMProvider, door: Door, hooks?: LLMCallHooks) {
  if (door === 'complete') return provider.complete(request, hooks);
  const chunks: LLMChunk[] = [];
  for await (const chunk of provider.stream!(request, hooks)) chunks.push(chunk);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatchObject({ content: '', done: true });
  return chunks[0]!.response!;
}

function expectTerminal(answer: LLMResponse, outcome: Outcome) {
  expect(answer.content).toBe('');
  expect(answer.toolCalls).toEqual([]);
  expect(answer.usage).toEqual(normal.usage);
  expect(answer.stopReason).toBe('guardrail_intervened');
  expect(answer.rawThinking).toBeUndefined();
  expect(answer.replayOmissions).toBeUndefined();
  const intervention = providerInterventionOf(answer)!;
  expect(intervention.outcome).toBe(outcome);
  expect(interventionErrorOf(intervention)).toBeInstanceOf(
    outcome === 'blocked' ? ProviderBlockedError : ProviderInterventionUnknownError,
  );
}

const wrappers = [
  'fallback different thinking',
  'fallback same thinking',
  'retry',
  'circuit breaker',
  'retry around fallback',
  'fallback around retry',
] as const;

function wrap(kind: (typeof wrappers)[number], primary: LLMProvider, fallback: LLMProvider) {
  const shouldRetry = vi.fn(() => false);
  const shouldCount = vi.fn(() => true);
  const onStateChange = vi.fn();
  const retry = (p: LLMProvider) => withRetry(p, { maxAttempts: 2, shouldRetry });
  const pair = (p: LLMProvider) => withFallback(p, fallback);
  const provider =
    kind === 'retry'
      ? retry(primary)
      : kind === 'circuit breaker'
      ? withCircuitBreaker(primary, { failureThreshold: 1, shouldCount, onStateChange })
      : kind === 'retry around fallback'
      ? retry(pair(primary))
      : kind === 'fallback around retry'
      ? pair(retry(primary))
      : pair(primary);
  return { provider, shouldRetry, shouldCount, onStateChange };
}

for (const door of ['complete', 'stream'] as const) {
  describe(`${door}: wrapper response admission`, () => {
    for (const kind of wrappers) {
      for (const outcome of ['blocked', 'unknown'] as const) {
        for (const field of ['rawThinking', 'replayOmissions'] as const) {
          it(`${kind} preserves ${outcome} without reading ${field}`, async () => {
            const fixture = hostile(outcome, field);
            const primary = scripted(fixture.answer);
            const fallback = scripted(
              normal,
              'secondary',
              kind === 'fallback same thinking' ? firstHandler : otherHandler,
            );
            const wrapped = wrap(kind, primary.provider, fallback.provider);
            const onResilience = vi.fn();
            const answer = await invoke(wrapped.provider, door, { onResilience });
            expect(fixture.read).not.toHaveBeenCalled();
            expect(fallback.called).not.toHaveBeenCalled();
            expect(primary.called).toHaveBeenCalledOnce();
            expect(wrapped.shouldRetry).not.toHaveBeenCalled();
            expect(wrapped.shouldCount).not.toHaveBeenCalled();
            expect(wrapped.onStateChange).not.toHaveBeenCalled();
            expect(onResilience).not.toHaveBeenCalled();
            expectTerminal(answer, outcome);
          });
        }
      }
      for (const masked of [false, true]) {
        it(`${kind} keeps ${
          masked ? 'masked' : 'ordinary'
        } thinking and replay reports`, async () => {
          const rawThinking = [{ type: 'thinking', content: 'fixture' }];
          const answer: LLMResponse = {
            ...normal,
            rawThinking,
            replayOmissions: [omission],
            ...(masked && {
              intervention: { outcome: 'masked' as const, code: 'masked', filters: [] },
            }),
          };
          const primary = scripted(answer);
          const fallback = scripted(
            normal,
            'secondary',
            kind === 'fallback same thinking' ? firstHandler : otherHandler,
          );
          const wrapped = wrap(kind, primary.provider, fallback.provider);
          const received = await invoke(wrapped.provider, door);
          expect(received.content).toBe(normal.content);
          expect(received.replayOmissions).toEqual([omission]);
          expect(received.rawThinking).toEqual(
            kind.includes('fallback') && kind !== 'fallback same thinking'
              ? { answeredBy: 'primary', raw: rawThinking }
              : rawThinking,
          );
          if (!masked && !kind.includes('fallback')) expect(received).toBe(answer);
          expect(providerInterventionOf(received)?.outcome).toBe(masked ? 'masked' : undefined);
          expect(primary.called).toHaveBeenCalledOnce();
          expect(fallback.called).not.toHaveBeenCalled();
          expect(wrapped.shouldRetry).not.toHaveBeenCalled();
          expect(wrapped.onStateChange).not.toHaveBeenCalled();
        });
      }
    }
  });
}

describe('shared replay capture', () => {
  for (const outcome of ['blocked', 'unknown'] as const) {
    for (const method of ['response', 'chunk', 'next', 'return', 'throw'] as const) {
      it(`${method} preserves ${outcome} ahead of already reported omissions`, async () => {
        const fixture = hostile(outcome, 'replayOmissions');
        const attempts = replayAttempts(request);
        attempts.hooks.onReplayPrepared({
          provider: 'scripted',
          model: request.model,
          request,
          omissions: [omission],
        });
        const chunk: LLMChunk = {
          content: '',
          tokenIndex: 0,
          done: true,
          response: fixture.answer,
        };
        let answer: LLMResponse;
        if (method === 'response') answer = attempts.response(fixture.answer);
        else if (method === 'chunk') answer = attempts.chunk(chunk).response!;
        else {
          const yielded = { done: false as const, value: chunk };
          const inner = {
            next: vi.fn(async () => yielded),
            return: vi.fn(async () => yielded),
            throw: vi.fn(async () => yielded),
          };
          const iterator = attempts.iterator(inner);
          const result =
            method === 'next'
              ? await iterator.next()
              : method === 'return'
              ? await iterator.return!()
              : await iterator.throw!(new Error('caller'));
          answer = result.value.response!;
          expect(inner[method]).toHaveBeenCalledOnce();
        }
        expect(fixture.read).not.toHaveBeenCalled();
        expectTerminal(answer, outcome);
      });
    }
    it(`complete-only fallback stream preserves ${outcome}`, async () => {
      const fixture = hostile(outcome, 'rawThinking');
      const primaryCalled = vi.fn();
      const fallback = scripted(fixture.answer, 'secondary', otherHandler);
      const pair = withFallback(
        {
          name: 'primary',
          thinkingHandler: firstHandler,
          complete: async () => normal,
          // The fixture fails before the first chunk.
          // eslint-disable-next-line require-yield
          async *stream() {
            primaryCalled();
            throw new Error('scripted outage');
          },
        },
        { ...fallback.provider, stream: undefined },
      );
      const answer = await invoke(pair, 'stream');
      expect(fixture.read).not.toHaveBeenCalled();
      expect(primaryCalled).toHaveBeenCalledOnce();
      expect(fallback.called).toHaveBeenCalledOnce();
      expectTerminal(answer, outcome);
    });
  }
});

describe('stream: captured terminal chunk', () => {
  for (const kind of ['fallback different thinking', 'retry', 'circuit breaker'] as const) {
    for (const outcome of ['blocked', 'unknown'] as const) {
      for (const field of ['response', 'irrelevant', 'tokenIndex'] as const) {
        it(`${kind} preserves ${outcome} without rereading ${field}`, async () => {
          const answer: LLMResponse = {
            ...normal,
            intervention: { outcome, code: 'guardrail_intervened', filters: [] },
          };
          const chunk: LLMChunk = { tokenIndex: 7, content: '', done: true, response: answer };
          const read = vi.fn(() => {
            if (field === 'response' && read.mock.calls.length === 1) return answer;
            throw new Error(`unrelated chunk ${field}`);
          });
          Object.defineProperty(chunk, field, { enumerable: true, get: read });
          const primary = scripted(answer);
          const fallback = scripted(normal, 'secondary', otherHandler);
          const wrapped = wrap(
            kind,
            {
              ...primary.provider,
              async *stream() {
                primary.called();
                yield chunk;
              },
            },
            fallback.provider,
          );
          const onResilience = vi.fn();
          const received = await invoke(wrapped.provider, 'stream', { onResilience });
          expect(read).toHaveBeenCalledTimes(field === 'response' ? 1 : 0);
          expect(primary.called).toHaveBeenCalledOnce();
          expect(fallback.called).not.toHaveBeenCalled();
          expect(wrapped.shouldRetry).not.toHaveBeenCalled();
          expect(wrapped.shouldCount).not.toHaveBeenCalled();
          expect(onResilience).not.toHaveBeenCalled();
          expectTerminal(received, outcome);
        });
      }
    }
  }
});
