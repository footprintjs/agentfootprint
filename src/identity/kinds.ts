/**
 * Built-in credential kinds — small strategies implementing the {@link Credential}
 * protocol. Each is a factory returning `{ kind, ...rawFields, toHeaders() }`.
 *
 * The framework + tools only ever call `cred.toHeaders()` (generic — no `kind`
 * switching); the raw fields are there for the rare non-HTTP case. A custom kind
 * is any object implementing `Credential` — no library change needed.
 */

import type { Credential } from './types.js';

/** Cross-env base64 (browser `btoa` / Node `Buffer`). */
function base64(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B) return B.from(s, 'utf8').toString('base64');
  throw new Error('basic(): no base64 encoder available in this runtime.');
}

export interface BearerCredential extends Credential {
  readonly kind: 'bearer';
  readonly token: string;
}
/** OAuth / bearer token → `Authorization: Bearer <token>`. */
export function bearer(token: string): BearerCredential {
  return { kind: 'bearer', token, toHeaders: () => ({ authorization: `Bearer ${token}` }) };
}

export interface ApiKeyCredential extends Credential {
  readonly kind: 'apiKey';
  readonly key: string;
  readonly headerName: string;
}
/** API key → a single header (default `x-api-key`). */
export function apiKey(key: string, headerName = 'x-api-key'): ApiKeyCredential {
  return { kind: 'apiKey', key, headerName, toHeaders: () => ({ [headerName]: key }) };
}

export interface BasicCredential extends Credential {
  readonly kind: 'basic';
  readonly username: string;
  readonly password: string;
}
/** HTTP Basic auth → `Authorization: Basic base64(user:pass)`. */
export function basic(username: string, password: string): BasicCredential {
  const encoded = base64(`${username}:${password}`);
  return {
    kind: 'basic',
    username,
    password,
    toHeaders: () => ({ authorization: `Basic ${encoded}` }),
  };
}

export interface HeadersCredential extends Credential {
  readonly kind: 'headers';
  readonly headers: Readonly<Record<string, string>>;
}
/** The universal escape: arbitrary auth headers. Any scheme reduces to this, so
 *  a provider with no matching typed kind can always return `headers(...)`. */
export function headers(map: Readonly<Record<string, string>>): HeadersCredential {
  const copy = { ...map };
  return { kind: 'headers', headers: copy, toHeaders: () => ({ ...copy }) };
}
