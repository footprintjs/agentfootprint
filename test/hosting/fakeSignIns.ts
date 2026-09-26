/**
 * A fake SignInStore — a Map with a switch to make it fail — and helpers to
 * mint a sign-in the way the sign-in door will: a random cookie value, stored
 * only by its key.
 */

import { randomBytes } from 'node:crypto';

import { signInKeyOf, type SignIn, type SignInStore } from '../../src/hosting/index.js';

export interface FakeSignInStore extends SignInStore {
  readonly rows: Map<string, SignIn>;
  /** Make every call throw, as an unreachable shared store would. */
  down: boolean;
  readonly calls: { find: number; touch: number; delete: number };
}

export function fakeSignInStore(): FakeSignInStore {
  const rows = new Map<string, SignIn>();
  const calls = { find: 0, touch: 0, delete: 0 };
  const store: FakeSignInStore = {
    rows,
    down: false,
    calls,
    async create(signIn) {
      if (store.down) throw new Error('store unreachable');
      rows.set(signIn.key, signIn);
    },
    async find(key) {
      calls.find += 1;
      if (store.down) throw new Error('store unreachable');
      return rows.get(key);
    },
    async touch(key, at) {
      calls.touch += 1;
      if (store.down) throw new Error('store unreachable');
      const row = rows.get(key);
      if (row !== undefined) rows.set(key, { ...row, lastSeenAt: at });
    },
    async delete(key) {
      calls.delete += 1;
      if (store.down) throw new Error('store unreachable');
      rows.delete(key);
    },
  };
  return store;
}

/** Put a sign-in for `userId` in the store; returns the COOKIE VALUE and its key. */
export async function signInAs(
  store: SignInStore,
  userId: string,
  options: { now?: number; hours?: number } = {},
): Promise<{ cookie: string; key: string }> {
  const cookie = randomBytes(32).toString('base64url');
  const key = signInKeyOf(cookie);
  const now = options.now ?? Date.now();
  await store.create({
    key,
    identity: { userId, roles: ['member'] },
    strategy: 'test',
    startedAt: now,
    expiresAt: now + (options.hours ?? 8) * 3_600_000,
    lastSeenAt: now,
  });
  return { cookie, key };
}
