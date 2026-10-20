import { describe, expect, it } from 'vitest';
import { assertProviderRequestForwarding } from '../../../examples/helpers/provider-wrapper-conformance.js';
import type {
  LLMCallHooks,
  LLMProvider,
  LLMRequest,
} from '../../../src/provider-contract/types.js';

const trimmed = (request: LLMRequest): LLMRequest => ({
  ...request,
  messages: request.messages.filter((message) => message.role !== 'tool'),
});

function announce(hooks: LLMCallHooks | undefined, request: LLMRequest): void {
  hooks?.onReplayPrepared?.({
    provider: 'synthetic-wrapper',
    model: request.model,
    request,
    omissions: [],
  });
}

describe('copyable provider-wrapper request conformance', () => {
  it('accepts an unchanged request with all hooks forwarded', async () => {
    await assertProviderRequestForwarding((inner) => ({
      ...inner,
      complete: (request, hooks) => inner.complete(request, hooks),
      stream: (request, hooks) => inner.stream!(request, { ...hooks }),
    }));
  });

  it('detects a complete wrapper that loses optional hooks', async () => {
    await expect(
      assertProviderRequestForwarding((inner) => ({
        ...inner,
        complete: (request) => inner.complete(request),
      })),
    ).rejects.toThrow('forward every hook');
  });

  it('detects rebuilding named hooks while losing the symbol channel', async () => {
    await expect(
      assertProviderRequestForwarding((inner) => ({
        ...inner,
        complete: (request, hooks) =>
          inner.complete(request, { onReplayPrepared: hooks?.onReplayPrepared }),
      })),
    ).rejects.toThrow('forward every hook');
  });

  it('detects trimming a result without reporting the actual request first', async () => {
    await expect(
      assertProviderRequestForwarding((inner) => ({
        ...inner,
        complete: (request, hooks) => inner.complete(trimmed(request), hooks),
      })),
    ).rejects.toThrow('report the transformed request before');
  });

  it('accepts a reported transformation for complete and stream', async () => {
    await assertProviderRequestForwarding((inner) => ({
      ...inner,
      complete: (request, hooks) => {
        const actual = trimmed(request);
        announce(hooks, actual);
        return inner.complete(actual, hooks);
      },
      async *stream(request, hooks) {
        const actual = trimmed(request);
        announce(hooks, actual);
        yield* inner.stream!(actual, hooks);
      },
    }));
  });

  it('checks a stream wrapper separately from complete', async () => {
    await expect(
      assertProviderRequestForwarding((inner) => ({
        ...inner,
        stream: (request) => inner.stream!(request),
      })),
    ).rejects.toThrow('forward every hook');
  });

  it('rejects a transformation report made only after transport entry', async () => {
    await expect(
      assertProviderRequestForwarding((inner) => ({
        ...inner,
        async complete(request, hooks) {
          const actual = trimmed(request);
          const answer = await inner.complete(actual, hooks);
          announce(hooks, actual);
          return answer;
        },
      })),
    ).rejects.toThrow('report the transformed request before');
  });

  it('supports complete-only wrappers without pretending stream was checked', async () => {
    expect(
      await assertProviderRequestForwarding(
        (inner): LLMProvider => ({
          name: 'complete-only-wrapper',
          complete: (request, hooks) => inner.complete(request, hooks),
        }),
      ),
    ).toEqual(['complete']);
  });

  it('detects an in-place mutation after the original request was captured', async () => {
    await expect(
      assertProviderRequestForwarding((inner) => ({
        ...inner,
        complete: (request, hooks) => {
          (request as { messages: LLMRequest['messages'] }).messages = [];
          return inner.complete(request, hooks);
        },
      })),
    ).rejects.toThrow('report the transformed request before');
  });

  it('does not certify a cached shortcut that never exercised the supplied leaf', async () => {
    await expect(
      assertProviderRequestForwarding((inner) => ({
        ...inner,
        complete: async () => ({
          content: 'cached',
          toolCalls: [],
          usage: { input: 0, output: 0 },
          stopReason: 'stop',
        }),
      })),
    ).rejects.toThrow('enter the supplied transport exactly once');
  });
});
