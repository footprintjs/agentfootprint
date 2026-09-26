/**
 * localPassword — the `local-password` strategy: a password list the server
 * holds, for development, tests and a demo box. Refused in production by
 * `identityFromConfig` (Q3): a list in an environment variable is not a
 * production identity store.
 *
 * Pattern: a {@link PasswordChecker} behind the sign-in door. The door owns
 *          everything a password door must do around the check (the guard,
 *          attempt limits, one answer, a minimum response time); this file only
 *          answers "is this the password for that name?".
 *
 * ── Hashed passwords only, with scrypt ──────────────────────────────────────
 * A list entry is `name:scrypt$<log2 N>$<r>$<p>$<salt>$<key>` — never a plain
 * password. Make one with {@link hashPassword}.
 *
 * Why scrypt: it is in `node:crypto`, so it adds no dependency (argon2 needs a
 * native module; bcrypt a package), and it is memory-hard, which PBKDF2 is not.
 * The default cost is OWASP's recommended scrypt setting (N = 2^17, r = 8,
 * p = 1: 128 MiB and a noticeable fraction of a second per check — on purpose).
 * The cost travels in the hash, so a list made with other parameters still
 * checks; anything weaker than N = 2^14, r = 8, p = 1 is refused.
 *
 * ── Ids ─────────────────────────────────────────────────────────────────────
 * The one exception to "never a name a person types" (rule 7): a local
 * password's id IS its configured name, matched exactly (the door trims the
 * typed name once, as the app's own door did) — so one person cannot get two
 * owners by typing `Alice` and `alice`. Renaming someone orphans their
 * conversations.
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import type { PasswordAccepted, PasswordChecker } from '../../hosting/signin/types.js';

/** The scrypt cost this library writes. OWASP Password Storage Cheat Sheet: N=2^17, r=8, p=1. */
export const SCRYPT_DEFAULT = { log2N: 17, r: 8, p: 1 } as const;
/** The weakest cost a stored hash may carry. */
export const SCRYPT_FLOOR = { log2N: 14, r: 8, p: 1 } as const;

const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** The cost of a hash, for {@link hashPassword}. */
export interface ScryptCost {
  readonly log2N: number;
  readonly r: number;
  readonly p: number;
}

/** A local-password list entry is refused. */
export class LocalPasswordConfigError extends Error {
  readonly code = 'ERR_LOCAL_PASSWORD_CONFIG' as const;

  constructor(sentence: string) {
    super(`[identity] ${sentence}`);
    this.name = 'LocalPasswordConfigError';
  }
}

/**
 * Hash a password for a `local-password` list entry.
 *
 * @example
 *   // npx tsx -e "import('agentfootprint/security').then(m => m.hashPassword('…')).then(console.log)"
 *   IDENTITY_LOCAL_USERS=priya:scrypt$17$8$1$…$…
 */
export async function hashPassword(
  password: string,
  cost: ScryptCost = SCRYPT_DEFAULT,
): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new LocalPasswordConfigError('hashPassword needs a non-empty password.');
  }
  checkCost(cost, 'hashPassword');
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, cost);
  return [
    'scrypt',
    cost.log2N,
    cost.r,
    cost.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * The `local-password` checker over a list: `name:hash` entries, comma
 * separated (the `IDENTITY_LOCAL_USERS` form), or a `{ name: hash }` object.
 * Refused at construction: an empty list, a plain password, a malformed or
 * too-weak hash, a name with `:` `,` or a control character, a duplicate name.
 */
export function localPasswords(
  users: string | Readonly<Record<string, string>>,
): PasswordChecker & { readonly names: readonly string[] } {
  const entries = typeof users === 'string' ? parseList(users) : Object.entries(users);
  if (entries.length === 0) throw new LocalPasswordConfigError('the local-password list is empty.');
  const table = new Map<string, StoredHash>();
  for (const [rawName, hash] of entries) {
    const name = checkName(rawName);
    if (table.has(name)) {
      throw new LocalPasswordConfigError(`the local-password list names '${name}' twice.`);
    }
    table.set(name, parseHash(name, hash));
  }
  // Checked against when the name is unknown, so an unknown name costs what a
  // known one does.
  const decoy = [...table.values()][0] as StoredHash;

  return {
    strategy: 'local-password',
    names: [...table.keys()],
    async check(username: string, password: string): Promise<PasswordAccepted | undefined> {
      const stored = table.get(username);
      const against = stored ?? decoy;
      const key = await derive(password, against.salt, against.cost);
      const match = timingSafeEqual(key, against.key);
      if (stored === undefined || !match) return undefined;
      return { identity: { userId: username }, displayName: username };
    },
  };
}

// ─── Pieces ──────────────────────────────────────────────────────────

interface StoredHash {
  readonly cost: ScryptCost;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parseList(list: string): [string, string][] {
  return list
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const colon = entry.indexOf(':');
      if (colon <= 0) {
        throw new LocalPasswordConfigError(
          `a local-password entry is 'name:scrypt$…' (an entry has no name).`,
        );
      }
      return [entry.slice(0, colon), entry.slice(colon + 1)];
    });
}

function checkName(raw: string): string {
  const name = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (name.length === 0 || name.length > 256 || /[:,\u0000-\u001f\u007f]/.test(name)) {
    throw new LocalPasswordConfigError(
      `a local-password name is 1–256 characters with no ':', ',' or control character.`,
    );
  }
  return name;
}

function parseHash(name: string, hash: string): StoredHash {
  const parts = hash.trim().split('$');
  if (parts[0] !== 'scrypt') {
    throw new LocalPasswordConfigError(
      `the local-password entry for '${name}' is not a scrypt hash. Plain passwords are never ` +
        `accepted; make one with hashPassword().`,
    );
  }
  const [, log2N, r, p, salt, key] = parts;
  const cost = { log2N: Number(log2N), r: Number(r), p: Number(p) };
  const saltBytes = Buffer.from(salt ?? '', 'base64url');
  const keyBytes = Buffer.from(key ?? '', 'base64url');
  if (parts.length !== 6 || saltBytes.length < 16 || keyBytes.length !== KEY_BYTES) {
    throw new LocalPasswordConfigError(`the local-password hash for '${name}' is malformed.`);
  }
  checkCost(cost, `the local-password hash for '${name}'`);
  return { cost, salt: saltBytes, key: keyBytes };
}

function checkCost(cost: ScryptCost, who: string): void {
  const ok =
    Number.isInteger(cost.log2N) &&
    Number.isInteger(cost.r) &&
    Number.isInteger(cost.p) &&
    cost.log2N >= SCRYPT_FLOOR.log2N &&
    cost.log2N <= 20 &&
    cost.r >= SCRYPT_FLOOR.r &&
    cost.r <= 32 &&
    cost.p >= SCRYPT_FLOOR.p &&
    cost.p <= 16;
  if (!ok) {
    throw new LocalPasswordConfigError(
      `${who} has a scrypt cost below the floor (N=2^14, r=8, p=1) or past the ceiling ` +
        `(N=2^20, r=32, p=16).`,
    );
  }
}

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  const N = 2 ** cost.log2N;
  const options: ScryptOptions = {
    N,
    r: cost.r,
    p: cost.p,
    maxmem: 256 * N * cost.r + 1024 * 1024,
  };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}
