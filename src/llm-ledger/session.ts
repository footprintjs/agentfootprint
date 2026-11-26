/**
 * llm-ledger/session — the one spelling of a session id: minted by the host, checked before any path.
 *
 * Pattern: one grammar, one minter. A session id is `ls_` and 26 Crockford
 *          base32 characters holding 128 random bits (the first character is
 *          0–7: the two bits above the 128 are zero). The host mints it;
 *          nothing accepts an id from the agent.
 * Role:    every door that takes a session checks it here FIRST — the file
 *          store forms `<dir>/<session>.jsonl` only from an id this file
 *          accepts, so no id can name a path outside the store's directory.
 * Emits:   N/A.
 */
import { randomBytes } from './digest.js';

/** Crockford's base32 alphabet: no I, L, O or U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const SESSION_ID = /^ls_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Whether `value` is a session id as `mintSessionId` writes it. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

/** The session id of exactly 16 bytes: `ls_` + 26 characters, most significant bits first. */
export function sessionIdOf(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new RangeError('sessionIdOf: a session id is made of exactly 16 bytes');
  }
  let id = 'ls_';
  // 130 bits, read 5 at a time: two zero bits, then the 128 bits of `bytes`.
  for (let char = 0; char < 26; char++) {
    let value = 0;
    for (let b = 0; b < 5; b++) {
      const bit = char * 5 + b - 2;
      const set = bit < 0 ? 0 : ((bytes[bit >> 3] as number) >> (7 - (bit & 7))) & 1;
      value = (value << 1) | set;
    }
    id += CROCKFORD[value];
  }
  return id;
}

/** A new session id from 128 random bits. */
export function mintSessionId(): string {
  return sessionIdOf(randomBytes(16));
}
