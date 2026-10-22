import { waitDeadline, type WaitDeadline } from '../lib/waitDeadline.js';
import { ProviderTimeoutError, type ProviderTimeoutWait } from './timeout.js';

/** Adapter-neutral wait policy. All values have passed checkedWaitMs at setup. */
export interface ProviderWaitLimits {
  readonly timeoutMs?: number;
  readonly firstOutputTimeoutMs?: number;
  readonly responseTimeoutMs?: number;
}

/** One allowance for the whole opaque answer, or for accumulated provider waits
 * before meaningful stream output. Control messages cannot renew either budget.
 * Time in a caller's consumer is excluded: only pending transport waits spend it.
 * Credentials have their own no-send wait; close and output gaps are per-wait. */
export function providerDeadline(
  limits: ProviderWaitLimits,
  signal: AbortSignal | undefined,
  context: {
    readonly provider: string;
    readonly opaque?: boolean;
    readonly afterOutput: () => boolean;
  },
  compose: (timeout: ProviderTimeoutError) => Error = (timeout) => timeout,
): WaitDeadline<ProviderTimeoutWait> {
  const spent = { first: 0, response: 0 };
  const allowance = (phase: ProviderTimeoutWait) => {
    if (phase === 'credentials') return { cap: limits.responseTimeoutMs };
    if (phase === 'fallback' || (context.opaque && (phase === 'response' || phase === 'body')))
      return { cap: limits.responseTimeoutMs, group: 'response' as const };
    if (phase === 'first-output' || (phase === 'response' && !context.afterOutput()))
      return { cap: limits.firstOutputTimeoutMs, group: 'first' as const };
    return { cap: limits.timeoutMs };
  };
  const noLimits = Object.values(limits).every((value) => value === undefined);
  const deadline = waitDeadline<ProviderTimeoutWait>(
    noLimits
      ? undefined
      : (phase) => {
          const { cap, group } = allowance(phase);
          return cap === undefined ? undefined : Math.max(0, cap - (group ? spent[group] : 0));
        },
    signal,
    (waitingFor, remaining) =>
      compose(
        new ProviderTimeoutError({
          provider: context.provider,
          waitingFor,
          timeoutMs: allowance(waitingFor).cap ?? remaining,
          afterOutput: context.afterOutput(),
          retryable: !context.opaque && waitingFor !== 'fallback',
        }),
      ),
  );
  return {
    signal: deadline.signal,
    async within<T>(pending: Promise<T>, phase: ProviderTimeoutWait): Promise<T> {
      const { group } = allowance(phase);
      const start = group ? Date.now() : 0;
      try {
        return await deadline.within(pending, phase);
      } finally {
        if (group) spent[group] += Math.max(0, Date.now() - start);
      }
    },
    dispose: () => deadline.dispose(),
  };
}
