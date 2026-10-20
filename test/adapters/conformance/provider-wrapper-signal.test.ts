import { expect, it } from 'vitest';
import { assertProviderRequestForwarding } from '../../../examples/helpers/provider-wrapper-conformance.js';
import type { LLMCallHooks, LLMRequest } from '../../../src/provider-contract/types.js';

function report(hooks: LLMCallHooks | undefined, request: LLMRequest): void {
  hooks?.onReplayPrepared?.({
    provider: 'synthetic-signal',
    model: request.model,
    request,
    omissions: [],
  });
}

it('accepts a reported signal added by complete and stream wrappers', async () => {
  expect(
    await assertProviderRequestForwarding((inner) => ({
      ...inner,
      complete(request, hooks) {
        const actual = { ...request, signal: new AbortController().signal };
        report(hooks, actual);
        return inner.complete(actual, hooks);
      },
      async *stream(request, hooks) {
        const actual = { ...request, signal: new AbortController().signal };
        report(hooks, actual);
        yield* inner.stream!(actual, hooks);
      },
    })),
  ).toEqual(['complete', 'stream']);
});

it('retains the identity of a reported signal when its state changes', async () => {
  await assertProviderRequestForwarding((inner) => ({
    ...inner,
    complete(request, hooks) {
      const controller = new AbortController();
      const actual = { ...request, signal: controller.signal };
      report(hooks, actual);
      controller.abort();
      return inner.complete(actual, hooks);
    },
  }));
});

it('refuses an unreported replacement even when both signals are un-aborted', async () => {
  await expect(
    assertProviderRequestForwarding((inner) => ({
      ...inner,
      complete(request, hooks) {
        const actual = { ...request, signal: new AbortController().signal };
        report(hooks, actual);
        return inner.complete({ ...actual, signal: new AbortController().signal }, hooks);
      },
    })),
  ).rejects.toThrow('report the transformed request before');
});

it('still refuses message mutation after a request with a signal was reported', async () => {
  await expect(
    assertProviderRequestForwarding((inner) => ({
      ...inner,
      complete(request, hooks) {
        const actual = { ...request, signal: new AbortController().signal };
        report(hooks, actual);
        return inner.complete({ ...actual, messages: [] }, hooks);
      },
    })),
  ).rejects.toThrow('report the transformed request before');
});
