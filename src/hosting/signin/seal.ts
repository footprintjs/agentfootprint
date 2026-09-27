/**
 * hosting/signin/seal — the sealed transaction cookie: a sign-in attempt's
 * secrets kept in the BROWSER that started it, readable only by this server.
 *
 * An OIDC sign-in needs `state`, `nonce`, the PKCE verifier and `returnTo` to
 * survive the trip to the identity provider and back. Keeping them on the
 * server would be state an unauthenticated `GET /auth/login` loop can grow
 * without bound, and state a second replica does not have. So they are SEALED
 * (AES-256-GCM, authenticated encryption) into a per-attempt cookie:
 *
 *  - nothing is written on the server — the transaction is bounded by the
 *    cookie's own lifetime (10 minutes);
 *  - the cookie name is bound into the seal (GCM additional data), so a sealed
 *    value moved to another attempt's cookie does not open;
 *  - it binds the login to the browser that started it, which is what stops
 *    login forgery (an attacker's own callback URL, completed in a victim's
 *    browser, finds no cookie to open);
 *  - one cookie per attempt, so two tabs signing in at once do not break each
 *    other.
 *
 * The key is `IDENTITY_COOKIE_KEY_FILE` (32 bytes, shared by replicas) or,
 * unset, random per process — a restart then invalidates logins in progress,
 * and the banner says so.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The sealing key: 32 bytes. */
export type SealKey = Buffer;

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A fresh random key, for a process that was given none. */
export function randomSealKey(): SealKey {
  return randomBytes(32);
}

/** Check a key read from a file: exactly 32 bytes, raw or base64/base64url/hex text. */
export function sealKeyFrom(bytes: Buffer): SealKey {
  if (bytes.length === 32) return bytes;
  const text = bytes.toString('utf8').trim();
  for (const encoding of ['base64url', 'base64', 'hex'] as const) {
    const decoded = Buffer.from(text, encoding);
    if (decoded.length === 32) return decoded;
  }
  throw new TypeError(
    `[hosting] a cookie sealing key is 32 bytes (raw, or as base64 / hex text); this one is not. ` +
      `Make one with: openssl rand -base64 32`,
  );
}

/** Seal a JSON value; `bound` (the cookie name) must match when it is opened. */
export function seal(key: SealKey, bound: string, value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(bound, 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Open a sealed value, or `undefined` when it was not sealed by this key for `bound`. */
export function unseal(key: SealKey, bound: string, sealed: string): unknown {
  try {
    const bytes = Buffer.from(sealed, 'base64url');
    if (bytes.length < IV_BYTES + TAG_BYTES + 1) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(bound, 'utf8'));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}
