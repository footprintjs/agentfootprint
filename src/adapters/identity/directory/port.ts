/**
 * directory/port — the four directory operations `directory-password` needs,
 * as a port, so the rules run over a fake directory in tests and over LDAPS
 * (`ldapDirectory`, through `ldapts`) in a deployment.
 */

import type { AdSubCodeName } from '../../../hosting/signin/audit.js';

/** One entry a search found. Binary attributes (objectGUID, objectSid) arrive as bytes. */
export interface DirectoryEntry {
  readonly dn: string;
  readonly objectGUID?: Buffer;
  readonly displayName?: string;
}

/**
 * A refused bind that says WHY: Active Directory's sub-code from the LDAP
 * error (`… data 52e, v1db1` → `'52e'`). For the operator's audit record only —
 * the person gets one answer whatever it says.
 */
export interface DirectoryBindRefused {
  readonly kind: 'invalid';
  /** AD's sub-code, lower-case hex, when the error carried one. */
  readonly adSubCode?: string;
}

/** What a bind answered: `'ok'`, or a refusal — bare, or with AD's sub-code. */
export type DirectoryBind = 'ok' | 'invalid' | DirectoryBindRefused;

/** One connection, used for exactly one sign-in attempt, then closed. */
export interface DirectorySession {
  /**
   * A simple bind, sent ONCE — never retried. `'ok'` when the directory
   * authenticated the name and password; `'invalid'` (or
   * `{ kind: 'invalid', adSubCode }`) for ANY wrong credential. The sub-code
   * reaches the audit record and never the person. Throws only when it could
   * not ask.
   */
  bind(name: string, password: string): Promise<DirectoryBind>;
  /** RFC 4532 "Who am I?" — the authzId the directory says this connection is, e.g. `u:CORP\\alice`. Empty = anonymous. */
  whoAmI(): Promise<string>;
  /** A search below `base` (subtree) or AT `base` (`scope: 'base'`). */
  search(base: string, filter: string, scope: 'sub' | 'base'): Promise<readonly DirectoryEntry[]>;
  close(): Promise<void>;
}

/** Where connections come from. */
export interface Directory {
  open(): Promise<DirectorySession>;
}

/** AD bind sub-codes by name (MS-ADTS; the `data <code>` in an LDAP 49 error). */
const AD_SUB_CODES: Readonly<Record<string, AdSubCodeName>> = {
  '52e': 'bad-password',
  '775': 'locked',
  '532': 'password-expired',
  '773': 'must-change',
  '533': 'disabled',
  '701': 'account-expired',
};

/**
 * What an AD bind sub-code means: `52e` bad password, `775` locked, `532`
 * password expired, `773` must change at next logon, `533` disabled, `701`
 * account expired; anything else (`525` no such user, `530`/`531` logon
 * hours/workstation, a code a later AD invents) is `'unknown'`.
 */
export function adSubCodeName(code: string): AdSubCodeName {
  const known = Object.prototype.hasOwnProperty.call(AD_SUB_CODES, code.toLowerCase());
  return known ? (AD_SUB_CODES[code.toLowerCase()] as AdSubCodeName) : 'unknown';
}

/**
 * RFC 4515 §3: escape a value for an LDAP search filter. A string escapes `*`,
 * `(`, `)`, `\` and NUL (and every non-ASCII byte, so nothing depends on how a
 * server reads UTF-8 in a filter); bytes are escaped whole.
 */
export function escapeFilterValue(value: string | Buffer): string {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  let out = '';
  for (const byte of bytes) {
    const plain =
      byte >= 0x20 &&
      byte < 0x7f &&
      byte !== 0x2a &&
      byte !== 0x28 &&
      byte !== 0x29 &&
      byte !== 0x5c;
    out += plain ? String.fromCharCode(byte) : `\\${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/**
 * A SID in SDDL string form (`S-1-5-21-…-1104`) as the binary `objectSid` a
 * filter compares, or `undefined` when it is not one.
 */
export function sidToBytes(sid: string): Buffer | undefined {
  const parts = /^S-1-(\d+)((?:-\d+){0,15})$/.exec(sid);
  if (parts === null) return undefined;
  const authority = BigInt(parts[1] as string);
  const subs = (parts[2] as string)
    .split('-')
    .filter((p) => p.length > 0)
    .map(Number);
  if (authority >= 2n ** 48n || subs.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)) {
    return undefined;
  }
  const out = Buffer.alloc(8 + subs.length * 4);
  out[0] = 1;
  out[1] = subs.length;
  for (let i = 0; i < 6; i += 1) out[2 + i] = Number((authority >> BigInt(8 * (5 - i))) & 0xffn);
  subs.forEach((n, i) => out.writeUInt32LE(n, 8 + i * 4));
  return out;
}
