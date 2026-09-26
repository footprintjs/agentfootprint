/**
 * hosting/signin/memorySignIns — the bounded in-memory {@link SignInStore}.
 *
 * Bounded (rule 19), and fair — one person can never sign everybody else out
 * (review idI34 S-1):
 *
 *  - **A per-account cap** (default 10 live sign-ins per `userId`). A person's
 *    eleventh sign-in ends THAT person's oldest; nobody else's.
 *  - **Dead rows are swept** before anything is counted — past their lifetime,
 *    or idle longer than `idleMinutes` when given (the door's own idle limit;
 *    review idI57 N-12) — so dead sign-ins never crowd out live ones.
 *  - **A full store REFUSES** a new sign-in ({@link SignInStoreFullError}, the
 *    door answers 503) rather than evicting another account's live sign-in.
 *  - **Every end is announced** through `onDelete`, which `signInSource` turns
 *    into its `onEnd` — so a socket carrying an ended sign-in closes at once.
 *
 * Per process, and stated: a restart signs everybody out, and a second replica
 * does not know the first one's sign-ins. Run one replica, pin each browser to
 * one (sticky sessions), or put a shared store behind the same verbs.
 */

import { MemorySignInsConfigError, SignInStoreFullError } from './errors.js';
import type { SignIn, SignInStore } from './types.js';

export { MemorySignInsConfigError } from './errors.js';

export interface MemorySignInsOptions {
  /** The most live sign-ins kept at once. Default 10 000. */
  readonly max?: number;
  /** The most live sign-ins one account may hold. Default 10. */
  readonly perAccount?: number;
  /**
   * Minutes without use after which a row is dead — pass the door's
   * `idleMinutes` so an idle sign-in stops holding a place against `max`.
   * Absent: only the lifetime (`expiresAt`) is swept.
   */
  readonly idleMinutes?: number;
  /** The clock, epoch ms, for sweeping expired rows. Default `Date.now`. */
  readonly now?: () => number;
  /** Told once when the store passes 90 % of `max`. Default: `console.warn`. */
  readonly warn?: (message: string) => void;
}

/** The in-memory store, plus what a banner or a test needs to read. */
export interface MemorySignIns extends SignInStore {
  /** How many sign-ins are kept right now. */
  readonly size: number;
  /** The cap. */
  readonly max: number;
  /** The per-account cap. */
  readonly perAccount: number;
  onDelete(listener: (key: string) => void): () => void;
}

export const DEFAULT_SIGN_IN_MAX = 10_000;
export const DEFAULT_SIGN_INS_PER_ACCOUNT = 10;

export function memorySignIns(options: MemorySignInsOptions = {}): MemorySignIns {
  const max = whole(options.max ?? DEFAULT_SIGN_IN_MAX, 'max');
  const perAccount = whole(options.perAccount ?? DEFAULT_SIGN_INS_PER_ACCOUNT, 'perAccount');
  const idleMs =
    options.idleMinutes === undefined ? Infinity : positiveMinutes(options.idleMinutes) * 60_000;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  // A Map iterates in insertion order: the first key is the oldest sign-in.
  const rows = new Map<string, SignIn>();
  const byAccount = new Map<string, Set<string>>();
  const listeners = new Set<(key: string) => void>();
  let warned = false;

  const remove = (key: string): void => {
    const row = rows.get(key);
    if (row === undefined) return;
    rows.delete(key);
    const keys = byAccount.get(row.identity.userId);
    keys?.delete(key);
    if (keys?.size === 0) byAccount.delete(row.identity.userId);
    for (const listener of [...listeners]) {
      try {
        listener(key);
      } catch {
        // A listener's fault is the listener's; the row is gone regardless.
      }
    }
  };

  const sweep = (): void => {
    const at = now();
    for (const [key, row] of rows) {
      if (row.expiresAt <= at || at - row.lastSeenAt >= idleMs) remove(key);
    }
  };

  return {
    get size() {
      return rows.size;
    },
    max,
    perAccount,
    onDelete(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async create(signIn) {
      remove(signIn.key);
      sweep();
      const account = signIn.identity.userId;
      const mine = byAccount.get(account);
      while (mine !== undefined && mine.size >= perAccount) {
        remove(mine.values().next().value as string);
      }
      if (rows.size >= max) throw new SignInStoreFullError(max);
      rows.set(signIn.key, { ...signIn });
      const keys = byAccount.get(account) ?? new Set<string>();
      keys.add(signIn.key);
      byAccount.set(account, keys);
      if (!warned && rows.size >= Math.ceil(max * 0.9)) {
        warned = true;
        warn(
          `[hosting] memorySignIns holds ${rows.size} of at most ${max} live sign-ins. At the cap ` +
            `new sign-ins are refused (503). Raise IDENTITY_SIGN_IN_MAX or use a shared store.`,
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
      remove(key);
    },
  };
}

function positiveMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MemorySignInsConfigError('idleMinutes', 'idleMinutes is a positive number');
  }
  return value;
}

function whole(value: number, option: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MemorySignInsConfigError(option, `${option} is a positive whole number`);
  }
  return value;
}
