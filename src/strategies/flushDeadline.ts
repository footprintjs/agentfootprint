/**
 * strategies/flushDeadline — flush a handle, stop waiting at a deadline, and
 * name the strategy that did not finish.
 *
 * A sink's `flush()` waits for its own in-flight delivery. One that never
 * settles — a hung network mount under `appendFile`, a network call with no
 * timeout — would hold a shutdown forever. The deadline belongs to the caller
 * that must finish, `RunnerBase · shutdown`, never to the sink: nothing can
 * cancel an in-flight write, and pretending otherwise would be worse than
 * saying we stopped waiting (the `withinBound` law in hosting/standingAgent.ts).
 *
 * A missed deadline is REPORTED, through the stuck strategy's own `_onError`
 * (the console when it has none), and names it — the same rule as every
 * delivery failure: telemetry that fails invisibly is indistinguishable from
 * telemetry that works.
 */

import type { BaseStrategy, StrategyHandle } from './types.js';

/** How long `shutdown()` waits for each handle's flush unless told otherwise —
 *  the default footprintjs's `drainObservers` uses. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/** `setTimeout` turns a delay above 2^31 − 1 ms into 1 ms. Anything longer
 *  (and `Infinity`) therefore means "no deadline", not "fire now". */
const LONGEST_TIMER_MS = 2_147_483_647;

/** Which strategy a handle flushes — so a missed deadline can name it. Weak,
 *  so a released handle is not retained. */
const STRATEGY_OF_HANDLE = new WeakMap<object, BaseStrategy>();

/** Remember the strategy behind a handle. Called once, where the handle is
 *  built (`strategies/attach.ts · makeStrategyHandle`). */
export function rememberStrategyOf(handle: object, strategy: BaseStrategy): void {
  STRATEGY_OF_HANDLE.set(handle, strategy);
}

/** The deadline a `shutdown({ timeoutMs })` asked for, refused by name when it
 *  is not a positive number of milliseconds. */
export function shutdownTimeoutOf(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  // `> 0` is false for NaN, so NaN is refused here too.
  if (typeof timeoutMs === 'number' && timeoutMs > 0) return timeoutMs;
  throw new TypeError(
    `shutdown({ timeoutMs }) must be a positive number of milliseconds ` +
      `(got ${String(timeoutMs)}). Pass Infinity to wait for every flush without a deadline.`,
  );
}

/**
 * Flush one handle, but wait no longer than `timeoutMs`. On a missed deadline
 * the stuck strategy is reported by name and this resolves `'stuck'`; its
 * flush keeps running — it is not, and cannot be, cancelled.
 *
 * The deadline timer is NOT unref'd: it is bounded, and it is what lets the
 * code after `await agent.shutdown()` run when the stuck write holds nothing
 * else open.
 */
export async function flushWithinDeadline(
  handle: StrategyHandle,
  timeoutMs: number,
): Promise<'flushed' | 'stuck'> {
  const flushing = handle.flush().then(() => 'flushed' as const);
  if (timeoutMs > LONGEST_TIMER_MS) return flushing;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'stuck'>((resolve) => {
    timer = setTimeout(() => resolve('stuck'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([flushing, deadline]);
    if (outcome === 'stuck') reportStuck(handle, timeoutMs);
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

function reportStuck(handle: StrategyHandle, timeoutMs: number): void {
  const strategy = STRATEGY_OF_HANDLE.get(handle);
  if (strategy === undefined) return;
  const error = new Error(
    `[${strategy.name}] flush did not finish within ${timeoutMs} ms of shutdown: a ` +
      `delivery it started has not settled (a hung disk, mount or network call). ` +
      `Shutdown went on without it; what this sink still holds was not delivered.`,
  );
  try {
    if (strategy._onError) {
      strategy._onError(error);
      return;
    }
  } catch {
    // The sink's own error hook threw. Shutdown never inherits a sink's
    // exception; the console below still says it.
  }
  // eslint-disable-next-line no-console
  console.error(error.message);
}
