/**
 * hosting/signin/source — the lifetimes, applied in ONE place.
 *
 * `signInSource` turns a {@link SignInStore} (which only keeps records) into a
 * {@link SignInSource} (which answers "who is behind this key, right now?").
 * A sign-in is live while BOTH clocks allow it:
 *
 *  - the absolute lifetime (`SignIn.expiresAt`, fixed when it was created —
 *    8 hours by default at the sign-in door), and
 *  - the idle limit (`idleMinutes` since `SignIn.lastSeenAt`) — 30 minutes
 *    under an SSO strategy, where signing in again is silent, and 60 under a
 *    password strategy, where it means retyping.
 *
 * A sign-in found past either clock is DELETED and reported ended, so the next
 * request does not find it either and an open socket carrying it closes. The
 * honest costs, stated rather than implied: a person disabled at the IdP keeps
 * access until their sign-in ends, and their roles are frozen at sign-in for
 * the same time — the library does not poll the IdP.
 */

import type { VerifiedIdentity } from '../identityVerification.js';
import type { SignInSource, SignInStore } from './types.js';

export interface SignInSourceOptions {
  /** Where sign-ins are kept. */
  readonly store: SignInStore;
  /** Minutes of inactivity after which a sign-in ends. */
  readonly idleMinutes: number;
  /** The clock, epoch ms. Default `Date.now`. */
  readonly now?: () => number;
}

/** A {@link SignInSource} that can also END a sign-in (sign-out). */
export interface SignIns extends SignInSource {
  onEnd(listener: (key: string) => void): () => void;
  /** End a sign-in now: delete it and tell every `onEnd` listener. Idempotent. */
  end(key: string): Promise<void>;
}

export function signInSource(options: SignInSourceOptions): SignIns {
  const { store } = options;
  const idleMs = checkIdle(options.idleMinutes) * 60_000;
  const now = options.now ?? Date.now;
  const listeners = new Set<(key: string) => void>();

  const tell = (key: string): void => {
    for (const listener of [...listeners]) {
      try {
        listener(key);
      } catch {
        // A listener that throws is told nothing more; the sign-in is over regardless.
      }
    }
  };

  // Every end the store reports is announced once — including the ends a
  // store performs itself (a sweep, a per-account cap).
  const storeAnnounces = typeof store.onDelete === 'function';
  if (storeAnnounces) store.onDelete?.(tell);

  const end = async (key: string): Promise<void> => {
    await store.delete(key);
    if (!storeAnnounces) tell(key);
  };

  return {
    async identify(key: string): Promise<VerifiedIdentity | undefined> {
      const signIn = await store.find(key);
      if (signIn === undefined) return undefined;
      const at = now();
      if (at >= signIn.expiresAt || at - signIn.lastSeenAt >= idleMs) {
        await end(key);
        return undefined;
      }
      await store.touch(key, at);
      return signIn.identity;
    },
    onEnd(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    end,
  };
}

function checkIdle(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new TypeError(
      `[hosting] signInSource needs idleMinutes, a positive number of minutes (got ${String(
        minutes,
      )}).`,
    );
  }
  return minutes;
}
