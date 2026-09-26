/**
 * hosting/signin/limits — attempt limits on a password door, correct under
 * concurrency, bounded, and per process.
 *
 * ── Why the order matters (review idI34 B-1) ────────────────────────────────
 * An attempt is COUNTED WHEN IT STARTS (`begin`), before the slow password
 * check — never after it. Counting after let forty parallel guesses all read
 * the same stale counter and all reach the checker. With `directory-password`
 * that burst would walk past this budget into Active Directory's own lockout
 * threshold and lock the real account company-wide; counting at the start is
 * what makes a budget "half of AD's threshold" mean anything.
 *
 * Three rules, then:
 *  1. **Per typed name: a hard budget.** `perName` attempts per window; past it
 *     the name is refused (429, `Retry-After`) until the window passes. A delay
 *     grows with the attempts already counted BEFORE any refusal, because a hard
 *     refusal is itself a lockout anyone can trigger for a colleague by typing
 *     their name (the documented trade: that is the price of a name budget).
 *  2. **One check in flight per name.** A second attempt for a name whose check
 *     has not answered is refused at once (429) — parallelism buys nothing.
 *  3. **Per client address: a growing DELAY only, never a refusal.** Behind a
 *     proxy or a shared NAT every person can arrive from one address; a hard
 *     address budget would let anybody lock the whole company out of sign-in
 *     with a handful of wrong guesses. The per-name budget is what protects an
 *     account; the address delay slows one client spraying many names. IPv6
 *     clients are counted per /64 (one customer's network), so rotating
 *     addresses inside it does not escape the delay.
 *
 * ── Bounded without being flushable ─────────────────────────────────────────
 * Name and address counters live in two SEPARATE bounded maps, so address churn
 * can never push a name counter out. When a map is full, the least recently used
 * counter that is NOT penalising (none in flight, and not delaying or refusing)
 * is dropped; a counter that still penalises is never dropped. If every counter
 * in the map is penalising, a NEW name or address is refused as `busy` (503) —
 * failing closed rather than forgetting a penalty.
 *
 * What it does not claim: it REDUCES guessing and lockout risk and never
 * claims to prevent lockout; the counters are per process (N replicas give
 * N budgets — the banner says so).
 */

export interface AttemptLimits {
  /** Attempts allowed per typed name per window before refusal. Default 5. */
  readonly perName?: number;
  /** Attempts per client address per window after which the address's delay is at its cap. Default 20. */
  readonly perAddress?: number;
  /** The window, in minutes. Default 15. */
  readonly windowMinutes?: number;
  /** The first back-off step, in ms; each further attempt doubles it (capped at 8×). Default 1000. */
  readonly backoffMs?: number;
  /** The most counters kept per map (names, addresses). Default 10 000. */
  readonly maxEntries?: number;
}

/** A counted attempt, to be settled exactly once. */
export interface AttemptTicket {
  readonly name: string;
  readonly address: string;
}

/** What the limiter says about an attempt it has just COUNTED (or refused to count). */
export type AttemptVerdict =
  | { readonly kind: 'allow'; readonly delayMs: number; readonly ticket: AttemptTicket }
  | { readonly kind: 'refuse'; readonly retryAfterSeconds: number }
  | { readonly kind: 'busy'; readonly retryAfterSeconds: number };

export interface AttemptLimiter {
  /** Count an attempt as it starts. `allow` carries a ticket that MUST be settled. */
  begin(name: string, address: string, now: number): AttemptVerdict;
  /** The credential was wrong: the attempt stays counted. */
  failed(ticket: AttemptTicket, now: number): void;
  /** The credential was right: the name's counter is cleared, and the address is not charged. */
  succeeded(ticket: AttemptTicket): void;
  /** The check could not run (the directory is down): the attempt is un-counted. */
  abandoned(ticket: AttemptTicket): void;
  /** How many counters are kept, both maps — for a test or a banner. */
  readonly size: number;
}

interface Counter {
  attempts: number;
  inFlight: number;
  /** When the last attempt was counted or answered — the window runs from HERE (review idI57 B-2). */
  lastAt: number;
}

export function attemptLimiter(limits: AttemptLimits = {}): AttemptLimiter {
  const perName = positive(limits.perName ?? 5, 'perName');
  const perAddress = positive(limits.perAddress ?? 20, 'perAddress');
  const windowMs = positive(limits.windowMinutes ?? 15, 'windowMinutes') * 60_000;
  const backoffMs = nonNegative(limits.backoffMs ?? 1_000, 'backoffMs');
  const maxEntries = positive(limits.maxEntries ?? 10_000, 'maxEntries');
  const names = boundedCounters(maxEntries, windowMs, (c) => c.attempts >= 2);
  const addresses = boundedCounters(maxEntries, windowMs, (c) => c.attempts >= 2);

  const delayFor = (prior: number): number =>
    prior <= 1 ? 0 : backoffMs * Math.min(8, 2 ** (prior - 2));

  return {
    get size() {
      return names.size + addresses.size;
    },
    begin(name, address, now) {
      const bucket = addressBucket(address);
      const byName = names.get(name, now);
      if (byName !== undefined && (byName.inFlight > 0 || byName.attempts >= perName)) {
        const left = byName.inFlight > 0 ? 1_000 : byName.lastAt + windowMs - now;
        return { kind: 'refuse', retryAfterSeconds: Math.max(1, Math.ceil(left / 1000)) };
      }
      const nameCounter = byName ?? names.create(name, now);
      if (nameCounter === undefined) return { kind: 'busy', retryAfterSeconds: 5 };
      const addressCounter = addresses.get(bucket, now) ?? addresses.create(bucket, now);
      if (addressCounter === undefined) {
        if (byName === undefined) names.drop(name);
        return { kind: 'busy', retryAfterSeconds: 5 };
      }
      // The delay comes from attempts already counted — the address's scaled
      // so it reaches its cap at `perAddress`.
      const addressPrior = Math.ceil((addressCounter.attempts * perName) / perAddress);
      const delayMs = Math.max(delayFor(nameCounter.attempts), delayFor(addressPrior));
      nameCounter.attempts += 1;
      nameCounter.inFlight += 1;
      nameCounter.lastAt = now;
      addressCounter.attempts += 1;
      addressCounter.inFlight += 1;
      addressCounter.lastAt = now;
      return { kind: 'allow', delayMs, ticket: { name, address: bucket } };
    },
    failed(ticket, now) {
      names.settle(ticket.name, 0, now);
      addresses.settle(ticket.address, 0, now);
    },
    succeeded(ticket) {
      names.drop(ticket.name);
      // A right password is not a strike against the address (a proxy's
      // morning of sign-ins must not slow everybody).
      addresses.settle(ticket.address, 1);
    },
    abandoned(ticket) {
      names.settle(ticket.name, 1);
      addresses.settle(ticket.address, 1);
    },
  };
}

/**
 * One bounded map of counters. Least recently used first; a counter that is
 * penalising (in flight, or `penalising(counter)` within its window) is never
 * evicted — a new key is refused (`undefined`) instead.
 */
function boundedCounters(
  maxEntries: number,
  windowMs: number,
  penalising: (counter: Counter) => boolean,
) {
  const map = new Map<string, Counter>();
  // AD's own rule ("reset account lockout counter after"): a counter is
  // forgotten only once a FULL window has passed since its LAST attempt. A
  // window fixed at the first attempt let a patient guesser space attempts
  // across the boundary and land twice the budget inside one AD window.
  const live = (c: Counter, now: number) => now - c.lastAt < windowMs;
  return {
    get size() {
      return map.size;
    },
    get(key: string, now: number): Counter | undefined {
      const counter = map.get(key);
      if (counter === undefined) return undefined;
      if (!live(counter, now) && counter.inFlight === 0) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, counter);
      return counter;
    },
    create(key: string, now: number): Counter | undefined {
      if (map.size >= maxEntries && !evictOne(now)) return undefined;
      const counter = { attempts: 0, inFlight: 0, lastAt: now };
      map.set(key, counter);
      return counter;
    },
    /** One attempt answered: out of flight, and `uncount` attempts taken back; a failure moves `lastAt`. */
    settle(key: string, uncount: number, now?: number): void {
      const counter = map.get(key);
      if (counter === undefined) return;
      counter.inFlight = Math.max(0, counter.inFlight - 1);
      counter.attempts = Math.max(0, counter.attempts - uncount);
      if (now !== undefined) counter.lastAt = Math.max(counter.lastAt, now);
    },
    drop(key: string): void {
      const counter = map.get(key);
      if (counter !== undefined && counter.inFlight > 1) counter.inFlight -= 1;
      else map.delete(key);
    },
  };

  function evictOne(now: number): boolean {
    for (const [key, counter] of map) {
      if (counter.inFlight > 0) continue;
      if (live(counter, now) && penalising(counter)) continue;
      map.delete(key);
      return true;
    }
    return false;
  }
}

/**
 * The address a budget is kept for: an IPv4 address as is; an IPv6 address by
 * its /64 (the first four groups) — one network, however many addresses it
 * rotates through.
 */
export function addressBucket(address: string): string {
  if (!address.includes(':')) return address;
  const groups = expandIPv6(address);
  return groups === undefined ? address : `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIPv6(address: string): string[] | undefined {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  const halves = bare.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : (halves[0] as string).split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? (halves[1] as string).split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return undefined;
  return groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
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
