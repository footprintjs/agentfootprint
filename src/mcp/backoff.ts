/**
 * backoff — builders of a `RetryPolicy.backoffMs` function: an exponential
 * schedule, and a wait the server stated winning over it.
 *
 * STAND-IN, TO BE DELETED. footprintjs is adding these two helpers to its
 * attempt runner (`attempt/backoff.ts`): `exponentialBackoff({ baseDelayMs,
 * multiplier, jitter, random })` and `statedWaitFirst(readStatedWaitMs,
 * inner)`, with these names, signatures and laws. Once a footprintjs release
 * ships them, import them in `throttleRetry.ts` and delete this file; nothing
 * else changes.
 *
 * Pattern: Two pure builders. Each returns `(attempt, error?) => ms`.
 * Role:    The wait `throttleRetry.ts` plans for each retry.
 * Emits:   N/A.
 *
 * ── THE LAW ──────────────────────────────────────────────────────────────
 * `exponentialBackoff`: after failed attempt `n` (1-based) the ceiling is
 *
 *     c = baseDelayMs × multiplier^(n − 1)     saturating at MAX_SAFE_INTEGER
 *
 * and, for `r = random()` in [0, 1]:
 *
 *     'none'    c                        `random` is never called
 *     'equal'   min(c, c/2 + r × c/2)    never below half the ceiling
 *     'full'    r × c                    anywhere from 0 up to it
 *
 * Waits are exact milliseconds — nothing is rounded. `random` defaults to
 * `Math.random`, taken when the function is BUILT; a fixed source makes a test
 * exact. A `random()` answering outside [0, 1] throws when asked.
 *
 * `statedWaitFirst`: when `readStatedWaitMs(error)` answers a finite number
 * ≥ 0, that is the wait; otherwise `inner` decides. A reader that throws or
 * answers anything else states nothing, so a malformed `Retry-After` falls back
 * to the schedule rather than to a wrong wait.
 *
 * Neither caps a wait. A cap on the SCHEDULE is the caller's to wrap around
 * `inner` (`throttleRetry.ts` does, for its `maxDelayMs`), so a stated wait is
 * never cut by it.
 */

/** How much of an exponential wait is random: none of it, half of it, or all of it. */
export type BackoffJitter = 'none' | 'equal' | 'full';

/** The schedule {@link exponentialBackoff} builds a backoff function from. */
export interface BackoffSpec {
  /** The ceiling of the first wait (after attempt 1), in milliseconds — a finite number ≥ 0. */
  readonly baseDelayMs: number;
  /** How much each ceiling grows over the one before — a finite number ≥ 1. Default `2`. */
  readonly multiplier?: number;
  /** How much of each wait is random. Default `'none'`: the wait IS the ceiling. */
  readonly jitter?: BackoffJitter;
  /** The jitter's random source, answering in [0, 1]. Default `Math.random`, taken when built. */
  readonly random?: () => number;
}

/** A `RetryPolicy.backoffMs` function: the wait in milliseconds after failed attempt `attempt` (1-based). */
export type BackoffFunction = (attempt: number, error?: unknown) => number;

/** Reads the wait an error states (a parsed `Retry-After`), in milliseconds, or `undefined` when it states none. */
export type StatedWaitReader = (error: unknown) => number | undefined;

const JITTERS: readonly BackoffJitter[] = ['none', 'equal', 'full'];

/** Where a ceiling saturates: a wait is never `Infinity` and never `NaN`. */
const MAX_WAIT_MS = Number.MAX_SAFE_INTEGER;

/**
 * An exponential schedule: the wait after failed attempt `n` is drawn under
 * `baseDelayMs × multiplier^(n − 1)` by the declared jitter.
 *
 * @throws when built: a `TypeError` for an option of the wrong type, a
 *   `RangeError` for one out of range — each naming the option.
 */
export function exponentialBackoff(spec: BackoffSpec): BackoffFunction {
  const { baseDelayMs, multiplier, jitter, random } = readSpec(spec);
  return (attempt) => {
    const ceiling = ceilingOf(baseDelayMs, multiplier, stepOf(attempt));
    if (jitter === 'none') return ceiling;
    const r = draw(random);
    // Never above the ceiling: halving a subnormal ceiling can round up.
    return jitter === 'equal' ? Math.min(ceiling, ceiling / 2 + (r * ceiling) / 2) : r * ceiling;
  };
}

/**
 * A wait the outside system stated wins; otherwise `inner` — a backoff
 * function, or a fixed number of milliseconds — decides.
 *
 * @throws when built: a `TypeError` for a reader that is not a function, or an
 *   `inner` that is neither a function nor a finite number ≥ 0.
 */
export function statedWaitFirst(
  readStatedWaitMs: StatedWaitReader,
  inner: BackoffFunction | number,
): BackoffFunction {
  if (typeof readStatedWaitMs !== 'function') {
    throw new TypeError(
      `statedWaitFirst: readStatedWaitMs must be a function (got ${shown(readStatedWaitMs)})`,
    );
  }
  if (typeof inner !== 'function') {
    checkNumber('statedWaitFirst: inner', inner, 0, 'a backoff function or a finite number >= 0');
  }
  return (attempt, error) => {
    const stated = statedWaitOf(readStatedWaitMs, error);
    if (stated !== undefined) return stated;
    return typeof inner === 'function' ? inner(attempt, error) : inner;
  };
}

/** Each field read once, then checked: what is checked is exactly what the function keeps. */
function readSpec(spec: BackoffSpec): Required<BackoffSpec> {
  if (spec === null || typeof spec !== 'object') {
    throw new TypeError(
      `exponentialBackoff: the spec must be an object ({ baseDelayMs, multiplier?, jitter?, random? }) (got ${shown(
        spec,
      )})`,
    );
  }
  const { baseDelayMs, multiplier = 2, jitter = 'none', random = Math.random } = spec;
  checkNumber('exponentialBackoff: baseDelayMs', baseDelayMs, 0, 'a finite number >= 0');
  checkNumber('exponentialBackoff: multiplier', multiplier, 1, 'a finite number >= 1');
  if (!JITTERS.includes(jitter)) {
    throw new RangeError(
      `exponentialBackoff: jitter must be 'none', 'equal' or 'full' (got ${shown(jitter)})`,
    );
  }
  if (typeof random !== 'function') {
    throw new TypeError(
      `exponentialBackoff: random must be a function answering in [0, 1] (got ${shown(random)})`,
    );
  }
  return { baseDelayMs, multiplier, jitter, random };
}

/** A finite number ≥ `min`, or the error naming `field`: a `TypeError` for a non-number, else a `RangeError`. */
function checkNumber(field: string, value: unknown, min: number, rule: string): void {
  if (typeof value !== 'number')
    throw new TypeError(`${field} must be ${rule} (got ${shown(value)})`);
  if (!Number.isFinite(value) || value < min) {
    throw new RangeError(`${field} must be ${rule} (got ${shown(value)})`);
  }
}

/** The attempt as a schedule step: its whole part, at least 1 (anything not a finite number reads as 1). */
function stepOf(attempt: unknown): number {
  return typeof attempt === 'number' && Number.isFinite(attempt) && attempt >= 1
    ? Math.floor(attempt)
    : 1;
}

/** `baseDelayMs × multiplier^(step − 1)`, saturating at {@link MAX_WAIT_MS}. */
function ceilingOf(baseDelayMs: number, multiplier: number, step: number): number {
  if (baseDelayMs === 0) return 0;
  const ceiling = baseDelayMs * multiplier ** (step - 1);
  return ceiling < MAX_WAIT_MS ? ceiling : MAX_WAIT_MS;
}

/** One draw from the random source, which must answer a number in [0, 1]. */
function draw(random: () => number): number {
  const r: unknown = random();
  if (typeof r !== 'number' || !(r >= 0 && r <= 1)) {
    throw new RangeError(
      `exponentialBackoff: random() must answer a number in [0, 1] (got ${shown(r)})`,
    );
  }
  return r;
}

/** The wait `error` states, read once — none when the reader throws or answers anything but a finite number ≥ 0. */
function statedWaitOf(read: StatedWaitReader, error: unknown): number | undefined {
  let value: unknown;
  try {
    value = read(error);
  } catch {
    return undefined;
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A value as an error message may show it: a number or a short string as itself, anything else by its type. */
function shown(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return JSON.stringify(value.length > 32 ? `${value.slice(0, 32)}…` : value);
  }
  return value === null ? 'null' : typeof value;
}
