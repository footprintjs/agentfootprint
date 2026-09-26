/**
 * hosting/signin/memorySignIns — the bounded in-memory {@link SignInStore}.
 *
 * Bounded (rule 19): at most `max` sign-ins (default 10 000). Past the cap the
 * OLDEST sign-in ends first — creation order, not last use, so a busy person
 * cannot keep a stale sign-in alive at a newcomer's expense. The store warns
 * once when it passes 90 % of the cap.
 *
 * Per process, and stated: a restart signs everybody out, and a second replica
 * does not know the first one's sign-ins. Run one replica, pin each browser to
 * one (sticky sessions), or put a shared store behind the same four verbs.
 */

import type { SignIn, SignInStore } from './types.js';

export interface MemorySignInsOptions {
  /** The most sign-ins kept at once. Default 10 000. */
  readonly max?: number;
  /** Told once when the store passes 90 % of `max`. Default: `console.warn`. */
  readonly warn?: (message: string) => void;
}

/** The in-memory store, plus what a banner or a test needs to read. */
export interface MemorySignIns extends SignInStore {
  /** How many sign-ins are kept right now. */
  readonly size: number;
  /** The cap. */
  readonly max: number;
}

export const DEFAULT_SIGN_IN_MAX = 10_000;

export function memorySignIns(options: MemorySignInsOptions = {}): MemorySignIns {
  const max = options.max ?? DEFAULT_SIGN_IN_MAX;
  if (!Number.isInteger(max) || max <= 0) {
    throw new TypeError(
      `[hosting] memorySignIns({ max: ${String(max)} }) — max is a positive whole number.`,
    );
  }
  const warn = options.warn ?? ((message: string) => console.warn(message));
  // A Map iterates in insertion order: the first key is the oldest sign-in.
  const rows = new Map<string, SignIn>();
  let warned = false;

  return {
    get size() {
      return rows.size;
    },
    max,
    async create(signIn) {
      rows.delete(signIn.key);
      rows.set(signIn.key, { ...signIn });
      while (rows.size > max) {
        const oldest = rows.keys().next().value as string;
        rows.delete(oldest);
      }
      if (!warned && rows.size >= Math.ceil(max * 0.9)) {
        warned = true;
        warn(
          `[hosting] memorySignIns holds ${rows.size} of at most ${max} sign-ins. Past the cap ` +
            `the oldest sign-in ends first. Raise IDENTITY_SIGN_IN_MAX or use a shared store.`,
        );
      }
    },
    async find(key) {
      const row = rows.get(key);
      return row === undefined ? undefined : { ...row };
    },
    async touch(key, at) {
      const row = rows.get(key);
      // Updated IN PLACE: touching never moves a sign-in in the eviction order.
      if (row !== undefined) rows.set(key, { ...row, lastSeenAt: at });
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}
