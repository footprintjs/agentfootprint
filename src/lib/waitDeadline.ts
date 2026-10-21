import { abortErrorOf, armDeadline, linkedController, untilAborted } from './abort.js';

/** One request's per-wait cap. A timer exists only while a wait is pending. */
export interface WaitDeadline<Phase extends string = string> {
  readonly signal: AbortSignal | undefined;
  within<T>(pending: Promise<T>, phase: Phase): Promise<T>;
  dispose(): void;
}

/**
 * Shared by SDK and fetch adapters. The adapter supplies its own typed error;
 * this leaf owns only timers, linked cancellation and late-result refusal.
 * A fresh cap applies to each wait, not to time spent yielding to a consumer.
 */
export function waitDeadline<Phase extends string>(
  timeoutMs: number | undefined,
  callerSignal: AbortSignal | undefined,
  timeoutError: (phase: Phase) => Error,
): WaitDeadline<Phase> {
  if (timeoutMs === undefined) {
    return {
      signal: callerSignal,
      within: (pending) => untilAborted(pending, callerSignal),
      dispose: () => undefined,
    };
  }
  const { controller, unlink } = linkedController(callerSignal);
  const active = new Set<() => void>();
  return {
    signal: controller.signal,
    within<T>(pending: Promise<T>, phase: Phase): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const settle = (): void => {
          disarm();
          active.delete(settle);
          controller.signal.removeEventListener('abort', onAbort);
        };
        const onAbort = (): void => {
          settle();
          reject(abortErrorOf(controller.signal));
        };
        const disarm = armDeadline(controller, timeoutMs, () => timeoutError(phase));
        active.add(settle);
        // Attach both handlers before checking an already-aborted signal:
        // an abandoned transport may reject later and must stay handled.
        pending.then(
          (value) => {
            settle();
            if (controller.signal.aborted) reject(abortErrorOf(controller.signal));
            else resolve(value);
          },
          (error: unknown) => {
            settle();
            reject(controller.signal.aborted ? abortErrorOf(controller.signal) : error);
          },
        );
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    dispose(): void {
      for (const settle of active) settle();
      unlink();
    },
  };
}
