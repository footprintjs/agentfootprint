/**
 * hosting/signin/limits — attempt limits on the password door, bounded and
 * per process.
 *
 * Two budgets per window: failures per TYPED NAME (so a guesser cannot work
 * through one account) and failures per CLIENT ADDRESS (so one client cannot
 * spray many names). A delay grows with each failure BEFORE any refusal,
 * because a hard refusal is itself a lockout anyone can trigger for a
 * colleague by typing their name; the refusal is the last step and lasts at
 * most the rest of the window.
 *
 * What this does and does not claim: it REDUCES guessing and lockout risk. It
 * never claims to prevent lockout, the counters are per process (with N
 * replicas the budget is N times larger), and they are bounded — past
 * `maxEntries` the least recently used counter is forgotten.
 */

export interface AttemptLimits {
  /** Failures allowed per typed name per window before refusal. Default 5. */
  readonly perName?: number;
  /** Failures allowed per client address per window before refusal. Default 20. */
  readonly perAddress?: number;
  /** The window, in minutes. Default 15. */
  readonly windowMinutes?: number;
  /** The first back-off step, in ms; each further failure doubles it (capped at 8×). Default 1000. */
  readonly backoffMs?: number;
  /** The most counters kept. Default 10 000. */
  readonly maxEntries?: number;
}

/** What the limiter says about the next attempt. */
export type AttemptVerdict =
  | { readonly kind: 'allow'; readonly delayMs: number }
  | { readonly kind: 'refuse'; readonly retryAfterSeconds: number };

export interface AttemptLimiter {
  /** Before the credential is checked. */
  before(name: string, address: string, now: number): AttemptVerdict;
  /** After a wrong credential. */
  failed(name: string, address: string, now: number): void;
  /** After a right one: the name's counter is cleared (the address's is kept). */
  succeeded(name: string): void;
  /** How many counters are kept — for a test or a banner. */
  readonly size: number;
}

interface Counter {
  failures: number;
  windowStart: number;
}

export function attemptLimiter(limits: AttemptLimits = {}): AttemptLimiter {
  const perName = positive(limits.perName ?? 5, 'perName');
  const perAddress = positive(limits.perAddress ?? 20, 'perAddress');
  const windowMs = positive(limits.windowMinutes ?? 15, 'windowMinutes') * 60_000;
  const backoffMs = nonNegative(limits.backoffMs ?? 1_000, 'backoffMs');
  const maxEntries = positive(limits.maxEntries ?? 10_000, 'maxEntries');
  const counters = new Map<string, Counter>();

  const read = (id: string, now: number): Counter | undefined => {
    const counter = counters.get(id);
    if (counter === undefined) return undefined;
    if (now - counter.windowStart >= windowMs) {
      counters.delete(id);
      return undefined;
    }
    // Least recently used last: re-insert on every read.
    counters.delete(id);
    counters.set(id, counter);
    return counter;
  };

  const bump = (id: string, now: number): void => {
    const counter = read(id, now) ?? { failures: 0, windowStart: now };
    counter.failures += 1;
    counters.set(id, counter);
    while (counters.size > maxEntries) counters.delete(counters.keys().next().value as string);
  };

  return {
    get size() {
      return counters.size;
    },
    before(name, address, now) {
      const byName = read(`n:${name}`, now);
      const byAddress = read(`a:${address}`, now);
      const over =
        (byName !== undefined && byName.failures >= perName) ||
        (byAddress !== undefined && byAddress.failures >= perAddress);
      if (over) {
        const starts = [byName, byAddress]
          .filter((c): c is Counter => c !== undefined)
          .map((c) => c.windowStart + windowMs - now);
        return {
          kind: 'refuse',
          retryAfterSeconds: Math.max(1, Math.ceil(Math.max(...starts) / 1000)),
        };
      }
      const failures = byName?.failures ?? 0;
      const delayMs = failures <= 1 ? 0 : backoffMs * Math.min(8, 2 ** (failures - 2));
      return { kind: 'allow', delayMs };
    },
    failed(name, address, now) {
      bump(`n:${name}`, now);
      bump(`a:${address}`, now);
    },
    succeeded(name) {
      counters.delete(`n:${name}`);
    },
  };
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`[hosting] attempt limits: ${name} must be a positive number.`);
  }
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`[hosting] attempt limits: ${name} must be 0 or more.`);
  }
  return value;
}
