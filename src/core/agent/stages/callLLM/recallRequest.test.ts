import { describe, expect, it } from 'vitest';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../../provider-contract/types.js';
import { requestAttempt } from '../../../../provider-contract/requestObserver.js';
import { withCircuitBreaker } from '../../../../resilience/withCircuitBreaker.js';
import { withFallback } from '../../../../resilience/withFallback.js';
import { withRetry } from '../../../../resilience/withRetry.js';
import { completeObserved, streamObserved } from './servedRequest.js';
import { trackRecallRequests } from './recallRequest.js';

const answer: LLMResponse = { content: 'Answer', toolCalls: [], usage: { input: 1, output: 1 } };
const messages: readonly LLMMessage[] = [{ role: 'user', content: 'Question' }];
const recall = { source: 'rag', rawContent: 'Recorded excerpt' } as const;
const request: LLMRequest = { model: 'test', messages, systemPrompt: recall.rawContent };

function tracker() {
  return trackRecallRequests([recall], messages, messages);
}

const provider: LLMProvider = { name: 'answering', complete: async () => answer };

describe('recall at the effective request boundary', () => {
  it('counts proved candidate pieces and leaves an unattributed recall block uncounted', async () => {
    const candidates = [
      { ...recall, sourceId: 'memory:corpus#one', retrievalScore: 0.9, rankPosition: 1 },
      {
        ...recall,
        rawContent: 'Another excerpt',
        sourceId: 'memory:corpus#two',
        retrievalScore: 0.8,
        rankPosition: 2,
      },
    ];
    const counted = trackRecallRequests(candidates, messages, messages);
    await completeObserved(
      provider,
      { ...request, systemPrompt: 'Recorded excerpt\n\nAnother excerpt' },
      counted.hooks({}),
      undefined,
    );
    expect(counted.summary()).toMatchObject({ accepted: 'present', acceptedCount: 2 });

    const coarse = tracker();
    await completeObserved(provider, request, coarse.hooks({}), undefined);
    expect(coarse.summary().accepted).toBe('present');
    expect(coarse.summary()).not.toHaveProperty('acceptedCount');
  });

  it('distinguishes the accepted request from any earlier possibly exposed request', async () => {
    const attempts = tracker();
    const hooks = attempts.hooks({});
    const failure = {
      name: 'failure',
      complete: async () => {
        throw new Error('failed');
      },
    };

    await expect(completeObserved(failure, request, hooks, undefined)).rejects.toThrow('failed');
    await completeObserved(provider, { ...request, systemPrompt: undefined }, hooks, undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'absent',
      acceptedCount: 0,
      exposure: 'present',
      committedProviderResponse: true,
    });
  });

  it('does not count a decorator envelope as a dispatched request', async () => {
    const attempts = tracker();
    const wrapper: LLMProvider = {
      name: 'wrapper',
      async complete(_request, hooks) {
        const leaf = { ...request, systemPrompt: undefined };
        const attempt = requestAttempt(hooks, leaf);
        try {
          return await provider.complete(leaf, attempt.hooks);
        } finally {
          attempt.close('response');
        }
      },
    };
    await completeObserved(wrapper, request, attempts.hooks({}), undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'absent',
      acceptedCount: 0,
      exposure: 'absent',
      committedProviderResponse: true,
    });
  });

  it('keeps a failed decorated primary separate from a response from its backup', async () => {
    const attempts = tracker();
    const failing = {
      name: 'primary',
      complete: async () => {
        throw new Error('failed');
      },
    };
    await completeObserved(withFallback(failing, provider), request, attempts.hooks({}), undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'present',
      exposure: 'present',
      committedProviderResponse: true,
    });
    expect(attempts.summary('local')).toEqual({
      accepted: 'local',
      exposure: 'present',
      committedProviderResponse: false,
    });
  });

  it('keeps an abandoned stream separate from the completion response', async () => {
    const attempts = tracker();
    const legacyStream: LLMProvider = {
      ...provider,
      async *stream() {
        yield { tokenIndex: 0, content: 'Draft', done: false };
      },
    };
    const hooks = attempts.hooks({});
    for await (const _ of streamObserved(legacyStream, request, hooks, undefined)) {
      // Consuming text is not a terminal model response.
    }
    await completeObserved(provider, { ...request, systemPrompt: undefined }, hooks, undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'absent',
      acceptedCount: 0,
      exposure: 'present',
      committedProviderResponse: true,
    });
  });

  it('binds a terminal first chunk through stacked decorators', async () => {
    const attempts = tracker();
    const stream: LLMProvider = {
      ...provider,
      async *stream() {
        yield { tokenIndex: 0, content: '', done: true, response: answer };
      },
    };
    const decorated = withRetry(withFallback(stream, provider), { maxAttempts: 2 });
    for await (const chunk of streamObserved(decorated, request, attempts.hooks({}), undefined)) {
      if (chunk.done) break;
    }
    expect(attempts.summary()).toEqual({
      accepted: 'present',
      exposure: 'present',
      committedProviderResponse: true,
    });
  });

  it('refines native preparation within the same leaf and ignores a late callback', async () => {
    const attempts = tracker();
    let afterClose: (() => void) | undefined;
    const preparing: LLMProvider = {
      name: 'native',
      async complete(initial, hooks) {
        const prepare = (effective: LLMRequest) =>
          hooks?.onReplayPrepared?.({
            request: effective,
            omissions: [],
            provider: 'native',
            model: 'test',
          });
        prepare({ ...initial, systemPrompt: undefined });
        afterClose = () => prepare(initial);
        return answer;
      },
    };
    await completeObserved(preparing, request, attempts.hooks({}), undefined);
    afterClose?.();
    expect(attempts.summary()).toEqual({
      accepted: 'absent',
      acceptedCount: 0,
      exposure: 'absent',
      committedProviderResponse: true,
    });
  });

  it('leaves an unreported in-place content change unknown', async () => {
    const attempts = tracker();
    const rewriting: LLMProvider = {
      name: 'opaque',
      async complete(request) {
        Object.defineProperty(request, 'systemPrompt', { value: 'Rewritten system' });
        return answer;
      },
    };
    await completeObserved(rewriting, { ...request }, attempts.hooks({}), undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'unknown',
      exposure: 'unknown',
      committedProviderResponse: true,
    });
  });

  it('uses proved ordinary history origins and treats rewritten bodies as unknown', async () => {
    const ordinary: LLMMessage = { role: 'user', content: 'Ordinary recall' };
    const committed: LLMMessage = {
      ...ordinary,
      injectedBy: { injectionId: 'memory:ordinary', flavor: 'memory', iteration: 0 },
    };
    const attempts = trackRecallRequests([], [committed], [ordinary]);
    await completeObserved(
      provider,
      { model: 'test', messages: [ordinary] },
      attempts.hooks({}),
      undefined,
    );
    expect(attempts.summary().accepted).toBe('present');

    const rewritten = trackRecallRequests([], [committed], [ordinary]);
    await completeObserved(
      provider,
      { model: 'test', messages: [{ ...ordinary, content: 'Unattributed rewrite' }] },
      rewritten.hooks({}),
      undefined,
    );
    expect(rewritten.summary().accepted).toBe('unknown');
  });

  it('does not turn an opaque cache request or missing terminal evidence into zero', async () => {
    const tracked = trackRecallRequests([], messages, messages);
    const opaque = { model: 'test', messages, cacheHandle: 'remote' };
    await completeObserved(provider, opaque, tracked.hooks({}), undefined);
    expect(tracked.summary()).toEqual({
      accepted: 'unknown',
      exposure: 'unknown',
      committedProviderResponse: true,
    });
    expect(tracker().summary()).toEqual({
      accepted: 'unknown',
      exposure: 'unknown',
      committedProviderResponse: false,
    });
  });

  it('does not prove zero for a reported reroute without an observed leaf', async () => {
    const attempts = trackRecallRequests([], messages, messages);
    const rerouting: LLMProvider = {
      name: 'opaque-wrapper',
      async complete(_request, hooks) {
        hooks?.onResilience?.({
          kind: 'fell-back',
          primary: 'hidden-primary',
          fallback: 'hidden-alternative',
          reason: 'hidden failure',
        });
        return answer;
      },
    };
    await completeObserved(rerouting, { model: 'test', messages }, attempts.hooks({}), undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'unknown',
      exposure: 'unknown',
      committedProviderResponse: false,
    });
  });

  it('excludes an observed refusal that took place before dispatch', async () => {
    const failed = {
      name: 'failed',
      async complete() {
        throw new Error('provider down');
      },
    };
    const blocked = withCircuitBreaker(failed, { failureThreshold: 1 });
    await expect(blocked.complete(request)).rejects.toThrow('provider down');

    const attempts = tracker();
    const hooks = attempts.hooks({});
    await expect(completeObserved(blocked, request, hooks, undefined)).rejects.toThrow();
    await completeObserved(provider, { ...request, systemPrompt: undefined }, hooks, undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'absent',
      acceptedCount: 0,
      exposure: 'absent',
      committedProviderResponse: true,
    });
  });

  it('keeps exposure unknown when its attempt budget is exhausted', async () => {
    const attempts = tracker();
    const hooks = attempts.hooks({});
    for (let i = 0; i < 65; i++)
      await completeObserved(provider, { ...request, systemPrompt: undefined }, hooks, undefined);
    expect(attempts.summary()).toEqual({
      accepted: 'unknown',
      exposure: 'unknown',
      committedProviderResponse: false,
    });
  });
});
