/**
 * Copy this Node-only, scripted test helper into a wrapper's own test suite.
 * It is an example, not an npm export or certification of arbitrary requests.
 * The factory must delegate only to the supplied fake leaf: no live transport.
 */
import { isDeepStrictEqual } from 'node:util';
import type { LLMCallHooks, LLMProvider, LLMRequest, LLMResponse } from 'agentfootprint';

// #region conformance
export async function assertProviderRequestForwarding(
  wrap: (inner: LLMProvider) => LLMProvider,
): Promise<readonly ('complete' | 'stream')[]> {
  const checked: ('complete' | 'stream')[] = [];
  for (const method of ['complete', 'stream'] as const) {
    const request: LLMRequest = {
      model: 'synthetic-only',
      messages: [
        { role: 'user', content: 'Synthetic wrapper conformance fixture.' },
        { role: 'tool', toolCallId: 'fixture-result', toolName: 'read', content: 'fixture' },
      ],
    };
    // Snapshot now: mutating either the original request or an earlier report
    // cannot make an unreported later transformation appear unchanged.
    let reported = snapshotRequest(request);
    let entries = 0;
    let replayReports = 0;
    const marker = Symbol('wrapper-conformance');
    const token = () => undefined;
    const hooks = {
      [marker]: token,
      onReplayPrepared(preparation) {
        reported = snapshotRequest(preparation.request);
        replayReports++;
      },
    } satisfies LLMCallHooks & { [marker]: typeof token };
    const answer: LLMResponse = {
      content: 'synthetic complete',
      toolCalls: [],
      usage: { input: 0, output: 0 },
      stopReason: 'stop',
    };
    function enter(actual: LLMRequest, forwarded?: LLMCallHooks): void {
      entries++;
      if (
        (forwarded as typeof hooks | undefined)?.[marker] !== token ||
        forwarded?.onReplayPrepared === undefined
      )
        throw new Error('A provider wrapper must forward every hook, including symbol keys.');
      const { signal, ...body } = actual;
      if (signal !== reported.signal || !isDeepStrictEqual(body, reported.body))
        throw new Error('A provider wrapper must report the transformed request before transport.');
      const before = replayReports;
      forwarded.onReplayPrepared({
        provider: 'synthetic-leaf',
        model: actual.model,
        request: actual,
        omissions: [],
      });
      if (replayReports !== before + 1)
        throw new Error('A provider wrapper must forward every hook, including replay reports.');
    }
    const leaf: LLMProvider = {
      name: 'synthetic-leaf',
      async complete(actual, forwarded) {
        enter(actual, forwarded);
        return answer;
      },
      async *stream(actual, forwarded) {
        enter(actual, forwarded);
        yield { content: '', tokenIndex: 0, done: true, response: answer };
      },
    };
    const wrapped = wrap(leaf);
    if (method === 'complete') await wrapped.complete(request, hooks);
    else {
      if (wrapped.stream === undefined) continue;
      for await (const _chunk of wrapped.stream(request, hooks)) {
        // Consume the real wrapper's iterator; do not replace it with complete().
      }
    }
    if (entries !== 1)
      throw new Error('The synthetic fixture must enter the supplied transport exactly once.');
    checked.push(method);
  }
  return checked;
}
// #endregion conformance

function snapshotRequest(request: LLMRequest) {
  // A signal is a live cancellation handle, not serializable request data.
  // Preserve its identity; freeze only the data that a wrapper could mutate.
  const { signal, ...body } = request;
  return { signal, body: structuredClone(body) };
}
