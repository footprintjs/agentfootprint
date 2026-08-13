/**
 * hosting/admission — decide whether a request runs, before it costs anything.
 *
 * A standing agent's cheapest refusal is the one made before the first model
 * call. Everything else the composer does about load is about ORDER —
 * `onConcurrentInvoke` decides whether a session's second turn waits or is
 * refused, the pool decides which instance answers — and none of it can say
 * "this person has had twenty turns in the last hour and that is enough".
 *
 * That question needs two things the composer already has and never joined: WHO
 * is asking (verified, since 9.26) and what that person has spent (the token
 * and cost events every run already emits). This module is the join, plus the
 * seam where an operator's own rule goes.
 *
 * ── One decision, three answers, no fourth ───────────────────────────────────
 * `'allow'` · `{ queue: true }` · `{ refuse: '<sentence>' }`. Deliberately not
 * "delay by N ms" (a sleep is a thread the caller is paying for), not "degrade
 * to a cheaper model" (that is the run's business, and silently answering from
 * a different brain is the accepted-and-silently-wrong failure), and not a
 * numeric priority (a priority means a scheduler, and this is a door).
 *
 * ── The refusal is the operator's sentence, and that is deliberate ───────────
 * The policy WRITES the words. A limit and its reset are facts only the
 * operator has, and a library-authored "rate limit exceeded" is a support
 * ticket rather than something a caller can act on. `turnsPerHour` shows the
 * shape: name the limit, name when it resets, name what to do.
 *
 * ── What "spend" honestly means here ─────────────────────────────────────────
 * PER PROCESS. This ledger counts what THIS process served, in a rolling
 * window, in memory. Two replicas keep two windows; a restart forgets. That is
 * not a defect to be apologised for — it is what an in-process accountant can
 * truthfully claim — and it is stated on {@link RecentSpend} so nobody builds a
 * billing control on it by accident. A deployment that needs one number across
 * a fleet writes a `decide` that reads its own store; the seam is the same.
 */

import type { VerifiedIdentity } from './identityVerification.js';

/**
 * What one caller has spent inside the rolling window, as THIS PROCESS saw it.
 *
 * Every field is a measurement, never an estimate — with one stated exception
 * noted on `usd`. A number this ledger cannot know is absent rather than zero:
 * zero is a claim, and "we did not measure that" is a different fact.
 */
export interface RecentSpend {
  /** Turns admitted for this caller inside the window. */
  readonly turns: number;
  /** Prompt tokens billed to this caller's runs, summed from `stream.llm_end`. */
  readonly inputTokens: number;
  /** Completion tokens, from the same source. */
  readonly outputTokens: number;
  /**
   * Estimated USD, summed from `cost.tick`.
   *
   * **Absent unless a `pricingTable` is configured on the agent** — money is
   * something only a pricing table can turn tokens into, and a zero here would
   * read as "this caller has spent nothing" when the truth is "nobody is
   * counting". Estimated, because the pricing table is a local table and the
   * invoice is the vendor's.
   */
  readonly usd?: number;
  /** How far back this window looks, in milliseconds. */
  readonly windowMs: number;
  /**
   * Whether the window is complete for this caller — `false` when the process
   * has been up for LESS than `windowMs`, so the numbers cover a shorter
   * period than they claim to.
   *
   * A policy that refuses on a partial window refuses on less evidence than it
   * thinks it has; one that ignores this is choosing to, which is fine, but it
   * should be a choice.
   */
  readonly complete: boolean;
}

/** What an admission decision is handed. */
export interface AdmissionContext {
  /**
   * WHO is asking, when the door verified anybody. `undefined` for an
   * anonymous request and for a door with no verifier — never a claimed-but-
   * unproven user, because a policy that budgeted an unverified name would
   * budget whatever name the next request invented.
   */
  readonly identity?: VerifiedIdentity;
  /** The conversation this request belongs to, when it named one. */
  readonly sessionId?: string;
  /** This caller's rolling-window spend. See {@link RecentSpend}. */
  readonly recentSpend: RecentSpend;
}

/**
 * What a policy answers.
 *
 *  - `'allow'` — run it now (the shape of every request before this option
 *    existed).
 *  - `{ queue: true }` — run it, but behind whatever this session already has
 *    in flight, even where the host would otherwise refuse a second concurrent
 *    turn. A back-pressure valve that costs latency instead of a failure.
 *  - `{ refuse }` — do not run it, and answer with this sentence.
 */
export type AdmissionVerdict = 'allow' | { readonly queue: true } | { readonly refuse: string };

/** The seam. One method, so a policy is a function with a name. */
export interface AdmissionPolicy {
  decide(context: AdmissionContext): AdmissionVerdict | Promise<AdmissionVerdict>;
}

// ─── The shipped reference policy ────────────────────────────────────

export interface TurnsPerHourOptions {
  /** How many turns one caller may start per hour. */
  readonly limit: number;
  /**
   * What an ANONYMOUS caller may start per hour. Default: the same `limit`.
   *
   * Worth setting separately at a door built with `allowAnonymous`, where
   * every anonymous request shares one bucket: the shared bucket makes a
   * per-user limit into a global one for that lane, which is a fact rather
   * than a bug, and this is the dial for it.
   */
  readonly anonymousLimit?: number;
}

/** One hour, in ms — the window this policy's name promises. */
const HOUR_MS = 3_600_000;

/**
 * The reference policy: N turns per caller per hour, refused with the limit and
 * its reset in the sentence.
 *
 * It is deliberately the SIMPLEST honest rule — a count, a window, a sentence —
 * because its job is to show the shape rather than to be everybody's policy.
 * Read it and write yours: a real deployment's rule is usually "this plan, this
 * endpoint, this time of day", which is exactly the knowledge a library does
 * not have.
 *
 * @example
 *   await standingAgent({
 *     agent, sessions, host,
 *     identity: { verify },                    // required for a PER-USER bound
 *     admission: turnsPerHour({ limit: 60 }),
 *   });
 */
export function turnsPerHour(options: TurnsPerHourOptions): AdmissionPolicy {
  const { limit } = options;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError(
      `[hosting] turnsPerHour({ limit: ${String(limit)} }) is not a ceiling. It is how many ` +
        `turns one caller may start per hour, so it has to be a positive integer — a limit of ` +
        `zero would refuse everything, which is a closed door rather than a rate limit.`,
    );
  }
  const anonymousLimit = options.anonymousLimit ?? limit;
  if (!Number.isInteger(anonymousLimit) || anonymousLimit < 0) {
    throw new TypeError(
      `[hosting] turnsPerHour({ anonymousLimit: ${String(anonymousLimit)} }) is not a ceiling. ` +
        `Use a non-negative integer — 0 refuses anonymous callers outright, which is a ` +
        `legitimate posture and should be spelled that way.`,
    );
  }
  return {
    decide({ identity, recentSpend }: AdmissionContext): AdmissionVerdict {
      const ceiling = identity === undefined ? anonymousLimit : limit;
      if (recentSpend.turns < ceiling) return 'allow';
      const who = identity === undefined ? 'Anonymous callers share' : 'You have';
      return {
        refuse:
          `${who} a limit of ${ceiling} turns per hour and ${
            identity === undefined ? 'that bucket is' : 'you are'
          } at ${recentSpend.turns}. ` +
          `The window is rolling, so the next turn becomes available as the oldest one ages ` +
          `past an hour — no reset to wait for at a fixed time.` +
          (identity === undefined
            ? ` Signing in gets you your own bucket rather than the shared anonymous one.`
            : ''),
      };
    },
  };
}

// ─── The in-process accountant ───────────────────────────────────────

/** One recorded turn, kept only long enough to age out of the window. */
interface SpendEntry {
  at: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** Did a pricing table speak for this turn? Absent money and zero money are
   *  different facts, and this is what keeps them apart. */
  priced: boolean;
}

/**
 * The rolling-window ledger the composer feeds and a policy reads.
 *
 * Bounded twice, because an unbounded map keyed by caller-supplied strings is a
 * memory leak with an attacker's finger on it: entries older than the window
 * are dropped on every read, and the number of distinct callers held is capped
 * (the least-recently-touched is evicted). Evicting a caller costs that caller
 * a forgotten window — they are admitted where they might have been refused,
 * which is the safe direction for a bound whose alternative is falling over.
 */
export interface SpendLedger {
  /** Note that a turn was admitted for this caller. */
  admit(key: string): void;
  /** Add measured usage to this caller's most recent turn. */
  add(key: string, usage: { inputTokens?: number; outputTokens?: number; usd?: number }): void;
  /** This caller's window, as of now. */
  read(key: string): RecentSpend;
  /** How many distinct callers are currently held (diagnostic). */
  readonly size: number;
}

/** How many distinct callers one process's ledger holds before evicting. */
const DEFAULT_MAX_CALLERS = 10_000;

export interface SpendLedgerOptions {
  /** Window length in ms. Default one hour — what `turnsPerHour` promises. */
  readonly windowMs?: number;
  /** Distinct callers held before the least-recently-touched is evicted. */
  readonly maxCallers?: number;
  /** @internal Test seam — the clock. */
  readonly _now?: () => number;
}

export function spendLedger(options: SpendLedgerOptions = {}): SpendLedger {
  const windowMs = options.windowMs ?? HOUR_MS;
  const maxCallers = options.maxCallers ?? DEFAULT_MAX_CALLERS;
  const now = options._now ?? Date.now;
  const startedAt = now();
  /** Insertion-ordered, so the FIRST key is the least recently touched — a
   *  `Map` re-inserted on touch is an LRU with no second structure. */
  const byCaller = new Map<string, SpendEntry[]>();

  const touch = (key: string): SpendEntry[] => {
    const held = byCaller.get(key);
    if (held !== undefined) {
      byCaller.delete(key);
      byCaller.set(key, held);
      return held;
    }
    while (byCaller.size >= maxCallers) {
      const oldest = byCaller.keys().next();
      if (oldest.done === true) break;
      byCaller.delete(oldest.value);
    }
    const fresh: SpendEntry[] = [];
    byCaller.set(key, fresh);
    return fresh;
  };

  const prune = (entries: SpendEntry[], at: number): SpendEntry[] => {
    const cutoff = at - windowMs;
    let drop = 0;
    // Entries are appended in time order, so the ones to drop are a PREFIX —
    // one splice rather than a filter that reallocates every window read.
    for (const entry of entries) {
      if (entry.at > cutoff) break;
      drop += 1;
    }
    if (drop > 0) entries.splice(0, drop);
    return entries;
  };

  return {
    admit(key: string): void {
      const at = now();
      const entries = prune(touch(key), at);
      entries.push({ at, inputTokens: 0, outputTokens: 0, usd: 0, priced: false });
    },
    add(key, usage): void {
      const entries = byCaller.get(key);
      // Usage with no admitted turn behind it is dropped rather than opening a
      // turn of its own: the turn count is what a policy bounds, and inventing
      // one from a stray token event would bill a caller for a turn nobody
      // admitted.
      const entry = entries?.[entries.length - 1];
      if (entry === undefined) return;
      entry.inputTokens += usage.inputTokens ?? 0;
      entry.outputTokens += usage.outputTokens ?? 0;
      if (usage.usd !== undefined) {
        entry.usd += usage.usd;
        entry.priced = true;
      }
    },
    read(key: string): RecentSpend {
      const at = now();
      const entries = prune(byCaller.get(key) ?? [], at);
      let inputTokens = 0;
      let outputTokens = 0;
      let usd = 0;
      let priced = false;
      for (const entry of entries) {
        inputTokens += entry.inputTokens;
        outputTokens += entry.outputTokens;
        usd += entry.usd;
        priced ||= entry.priced;
      }
      return {
        turns: entries.length,
        inputTokens,
        outputTokens,
        // Absent, not zero, when nothing priced this window — see RecentSpend.
        ...(priced && { usd }),
        windowMs,
        complete: at - startedAt >= windowMs,
      };
    },
    get size(): number {
      return byCaller.size;
    },
  };
}

/**
 * The ledger key for one caller.
 *
 * A verified user is keyed by the id the TOKEN proved. Everyone else shares one
 * anonymous bucket — and sharing is the honest answer rather than a weakness:
 * there is no other fact to key on. A session id would let a caller mint a
 * fresh budget by asking for a new conversation, and an IP address is neither
 * available to this port nor a person.
 */
export function spendKeyFor(identity: VerifiedIdentity | undefined): string {
  return identity === undefined ? '#anonymous' : `user:${identity.userId}`;
}
