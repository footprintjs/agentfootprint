/**
 * exponentialBackoff — the wait between attempts: a ceiling that grows by a
 * multiplier, and a draw below it.
 *
 * STAND-IN, TO BE DELETED. footprintjs is adding `exponentialBackoff({
 * baseDelayMs, multiplier, jitter, random? })` beside its attempt runner, under
 * these names. Once a footprintjs release ships it, import that one in
 * `throttleRetry.ts` and delete this file; nothing else changes. It is kept to
 * this one function so the swap is one import.
 *
 * Pattern: One pure function over its options and an injectable random source.
 * Role:    The schedule `throttleRetry.ts` hands footprintjs's `attempt()` as
 *          `RetryPolicy.backoffMs` when the server stated no wait.
 * Emits:   N/A.
 *
 * ── THE LAW ──────────────────────────────────────────────────────────────
 * For the attempt `n` that just failed (1-based):
 *
 *     ceiling(n) = min(maxBackoffMs, baseDelayMs × multiplier^(n − 1))
 *
 * and, for `r` from `random` (clamped into [0, 1]):
 *
 *     'none'    ceiling
 *     'equal'   ceiling/2 + r × ceiling/2      never below half the ceiling
 *     'full'    r × ceiling                    anywhere from 0 up to it
 *
 * rounded UP to a whole millisecond, so no wait falls below the law's floor.
 *
 * The cap applies to the CEILING, before the draw. footprintjs's runner also
 * caps every wait at `RetryPolicy.maxBackoffMs`, but after the draw, and once
 * the growth passes twice the cap that makes every wait the cap itself: clients
 * refused at the same moment would then retry at the same moments, which is
 * what jitter exists to prevent. Capped here first, the runner's own cap never
 * binds.
 */

/** How a wait is drawn below its ceiling. */
export type BackoffJitter = 'none' | 'equal' | 'full';

/** What {@link exponentialBackoff} builds a schedule from. */
export interface ExponentialBackoffOptions {
  /** The first wait's ceiling, in milliseconds. A finite number ≥ 0. */
  readonly baseDelayMs: number;
  /** How much each ceiling grows over the last. A finite number ≥ 1. Default 2. */
  readonly multiplier?: number;
  /** How the wait is drawn below its ceiling. Default `'equal'`. */
  readonly jitter?: BackoffJitter;
  /** The cap on every ceiling, in milliseconds. A number ≥ 0; default none. */
  readonly maxBackoffMs?: number;
  /** Where `r` comes from. Default `Math.random`, read when a wait is drawn. */
  readonly random?: () => number;
}

const JITTERS: readonly BackoffJitter[] = ['none', 'equal', 'full'];

/**
 * A `RetryPolicy.backoffMs` that follows the law above.
 *
 * @throws TypeError when an option is outside its range, naming the option and
 *   never echoing a value that is not a number.
 */
export function exponentialBackoff(
  options: ExponentialBackoffOptions,
): (attempt: number) => number {
  const { baseDelayMs, multiplier = 2, jitter = 'equal', maxBackoffMs = Infinity } = options;
  refuseUnless(
    isFiniteNumber(baseDelayMs) && baseDelayMs >= 0,
    'baseDelayMs',
    'a finite number ≥ 0',
  );
  refuseUnless(isFiniteNumber(multiplier) && multiplier >= 1, 'multiplier', 'a finite number ≥ 1');
  refuseUnless(JITTERS.includes(jitter), 'jitter', "'none', 'equal' or 'full'");
  refuseUnless(
    typeof maxBackoffMs === 'number' && maxBackoffMs >= 0,
    'maxBackoffMs',
    'a number ≥ 0',
  );
  return (attempt) => {
    const grown = baseDelayMs === 0 ? 0 : baseDelayMs * multiplier ** (attempt - 1);
    // Past the largest double the growth is `Infinity`; a wait must stay a number.
    const ceiling = Math.min(maxBackoffMs, Number.isFinite(grown) ? grown : Number.MAX_VALUE);
    if (jitter === 'none') return Math.ceil(ceiling);
    const r = unitInterval((options.random ?? Math.random)());
    return Math.ceil(jitter === 'equal' ? ceiling / 2 + r * (ceiling / 2) : r * ceiling);
  };
}

/** A random draw clamped into [0, 1]; anything that is not a number reads as 0. */
function unitInterval(r: number): number {
  return Number.isNaN(r) ? 0 : Math.min(1, Math.max(0, r));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function refuseUnless(ok: boolean, name: string, wanted: string): void {
  if (!ok) throw new TypeError(`exponentialBackoff: \`${name}\` must be ${wanted}.`);
}
