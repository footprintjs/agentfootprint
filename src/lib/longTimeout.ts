/**
 * longTimeout — arm a host timer for a limit of any length.
 *
 * A host timer holds at most 2^31 − 1 ms (about 24.8 days). Node turns a longer
 * delay — `Infinity` included — into 1 ms, with a `TimeoutOverflowWarning`, so
 * a raw `setTimeout(fn, limit)` gives up at once exactly when the caller asked
 * to wait longest. The law, by the limit:
 *
 *   - `Infinity` — no limit: NO timer is armed and `fn` never runs, so nothing
 *     keeps the process alive on its account.
 *   - a finite delay past 2^31 − 1 ms — waited in chained chunks of at most
 *     2^31 − 1 ms, so it never fires early and never after 1 ms.
 *   - anything else that is not a number > 0 (`0`, a negative, `NaN`) — already
 *     due: `fn` runs on the next timer turn, as `setTimeout(fn, 0)` does.
 *
 * `{ unref: true }` unrefs every chunk, for a timer that only bounds a wait.
 * The returned function cancels whichever chunk is armed; it is a no-op when
 * nothing was armed.
 *
 * TEMPORARY COPY: this is footprintjs's `setLongTimeout` (footprintjs#136),
 * same signature and same law. Swap it for the footprintjs export once
 * footprintjs 10.7.0 ships, and delete this file.
 *
 * A leaf: imports nothing.
 */

/** The longest delay a host timer honours; Node fires a longer one after 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/** How a long timer is armed. */
export interface LongTimeoutOptions {
  /** Unref every host timer it arms (where the host has `unref`). */
  readonly unref?: boolean;
}

/** `setTimeout` for a limit of any length, by the law above. Returns its
 *  cancel. */
export function setLongTimeout(
  fn: () => void,
  ms: number,
  options?: LongTimeoutOptions,
): () => void {
  if (ms === Infinity) return () => undefined;
  const unref = options?.unref === true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const arm = (left: number): void => {
    timer = setTimeout(() => {
      if (cancelled) return;
      if (left > MAX_TIMER_MS) arm(left - MAX_TIMER_MS);
      else fn();
    }, Math.min(left, MAX_TIMER_MS));
    if (unref) (timer as { unref?: () => void }).unref?.();
  };
  arm(ms > 0 ? ms : 0);
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
