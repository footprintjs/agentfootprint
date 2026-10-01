/**
 * sleep — the ONE wait in the library, and it keeps its promised minimum.
 *
 * Pattern: One factory over a clock and a timer (`makeSleep`), one instance
 *          over the platform's (`sleep`). No state between calls.
 * Role:    Leaf. Seven modules each kept a private `setTimeout` promise — the
 *          retry back-offs (`withRetry`, `withCredentialRetry`,
 *          `retryingFetch`, `typesafe`), the device-flow poll, the mock
 *          provider's thinking time and the sign-in door's minimum answer
 *          time. Every one promised "at least `ms`", and none kept it.
 * Emits:   N/A.
 *
 * ── WHY A BARE `setTimeout` IS NOT A MINIMUM ─────────────────────────────
 * Node fires a timer when the event loop's clock says `ms` have passed since
 * the timer was armed, and that clock counts WHOLE milliseconds: the stamp
 * taken when the timer is armed is floored, so a timer armed late inside a
 * millisecond fires up to that fraction early once the clock refreshes. On
 * Linux the loop clock is the coarse monotonic clock, up to a tick behind,
 * and the shortfall can pass a full millisecond — so adding a millisecond to
 * the delay does not fix it, and reading a better clock around the old timer
 * only measures it. Node also truncates a fractional delay
 * (`setTimeout(f, 4.7)` arms 4) and turns a delay past 2^31 − 1 ms into 1 ms.
 *
 * ── THE LAW ──────────────────────────────────────────────────────────────
 * A wait from here never resolves before `ms` of MONOTONIC time have passed.
 * The deadline is read from `performance.now()` when the wait starts; when the
 * timer fires the clock is read again, and a timer that fired early is
 * re-armed for what is left — rounded up, and split below 2^31 ms — until the
 * deadline has passed. The timer decides when to LOOK; the clock decides
 * whether the wait is over.
 *
 * ── WHAT IT DOES NOT PROMISE ─────────────────────────────────────────────
 * A maximum. A loaded host wakes a timer late, and nothing here shortens a
 * wait to make up for it. A timeout (abort after `ms`) and a grace timer are
 * not waits with a minimum and do not belong here — they stay beside the work
 * they bound.
 *
 * ── ZERO AND ABORT ───────────────────────────────────────────────────────
 * `ms <= 0` (or not a number) is no wait: it resolves at once and does not
 * consult the signal, because there is nothing to cancel. That is what the
 * retry back-offs and the mock provider always did for a zero wait, and the
 * two copies that did consult it (`typesafe`, the device-flow poll) check the
 * signal themselves right beside the wait — so no caller's result changed when
 * they moved here. A positive wait rejects at once on an already-aborted
 * signal and clears its timer on a later abort. The rejection is the caller's
 * to choose (`abortError`) — each caller kept the error it threw before; the
 * default is `signal.reason ?? new Error('Aborted')`.
 *
 * ── TESTING WITH FAKE TIMERS ─────────────────────────────────────────────
 * The clock and the timer are read at CALL time, so a fake-timer install that
 * fakes both (`vi.useFakeTimers()` in this repo's Vitest fakes `performance`
 * with `setTimeout`) drives a wait exactly. A fake `setTimeout` beside a real
 * `performance.now()` leaves a wait waiting for real time: fake both, or
 * neither.
 */

/** What a wait reads and arms. The platform's by default; a test passes a fake. */
export interface SleepClock {
  /** Monotonic milliseconds, fractions welcome. */
  now(): number;
  /** Arm a one-shot timer; returns its handle. */
  setTimer(fire: () => void, ms: number): unknown;
  /** Disarm a handle `setTimer` returned. */
  clearTimer(handle: unknown): void;
}

/** Builds an aborted wait's rejection from the signal that aborted it. */
export type AbortErrorOf = (signal: AbortSignal) => unknown;

/** Wait at least `ms` of monotonic time. See the module notes for zero and abort. */
export type Sleep = (
  ms: number,
  signal?: AbortSignal | null,
  abortError?: AbortErrorOf,
) => Promise<void>;

/** The longest delay a platform timer holds; Node turns a longer one into 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const reasonOf: AbortErrorOf = (signal) => signal.reason ?? new Error('Aborted');

/** The platform's clock and timer, looked up at call time (fake timers stay visible). */
const PLATFORM_CLOCK: SleepClock = {
  now: () => performance.now(),
  setTimer: (fire, ms) => setTimeout(fire, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A wait over `clock`. The library uses `sleep`; this exists so a test can fire timers early. */
export function makeSleep(clock: SleepClock): Sleep {
  return (ms, signal, abortError = reasonOf) => {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      const until = clock.now() + ms;
      let timer: unknown;
      let unwatch = (): void => undefined;
      const check = (): void => {
        const left = until - clock.now();
        if (left > 0) {
          timer = clock.setTimer(check, timerMsFor(left));
          return;
        }
        unwatch();
        resolve();
      };
      timer = clock.setTimer(check, timerMsFor(ms));
      if (signal) {
        const watched = signal;
        const onAbort = (): void => {
          clock.clearTimer(timer);
          reject(abortError(watched));
        };
        watched.addEventListener('abort', onAbort, { once: true });
        unwatch = () => watched.removeEventListener('abort', onAbort);
      }
    });
  };
}

/** A timer for what is left: rounded UP (Node truncates a fraction), never past what a timer holds. */
function timerMsFor(left: number): number {
  return Math.min(Math.ceil(left), MAX_TIMER_MS);
}

/** The library's wait. Every promised minimum in `src/` goes through it. */
export const sleep: Sleep = makeSleep(PLATFORM_CLOCK);
