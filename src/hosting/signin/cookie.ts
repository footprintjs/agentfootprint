/**
 * hosting/signin/cookie — the sign-in cookie comes OFF the headers, and only
 * its key goes onward.
 *
 * The law (rule 10, "secrets never travel"): a handler never sees the sign-in
 * cookie. The transport strips it from the headers it hands onward
 * (`HostRequest.headers`, `HostConversation.headers`) and passes the sign-in
 * KEY instead — the value's SHA-256, which the store is keyed by and which
 * cannot be turned back into a cookie. One consumer that logs its headers would
 * otherwise publish an 8-hour credential.
 *
 * `readSignIn` is that stripping, exported for doors that read raw Node
 * headers themselves (an app's own routes beside the host). `withoutCredentials`
 * is the other half: every credential-bearing header removed, for anything that
 * logs.
 */

import { createHash } from 'node:crypto';

import { SIGN_IN_COOKIE } from './types.js';

/** Header bags this module reads: a Node `IncomingMessage['headers']` or a flat record. */
export type HeaderBag = Readonly<Record<string, string | readonly string[] | undefined>>;

/** What {@link readSignIn} found. */
export interface SignInRead {
  /**
   * The sign-in key (SHA-256 of the cookie's value, base64url), or absent when
   * the request carried no sign-in cookie — or carried TWO. Two cookies of the
   * one name name nobody: which one a browser sent first is not a fact this
   * door can rely on, so neither is read.
   */
  readonly key?: string;
  /**
   * The headers, names lower-cased, WITHOUT the sign-in cookie or any sign-in
   * attempt's transaction cookie (`<name>-tx-*`). Other cookies are kept.
   */
  readonly headers: Record<string, string>;
}

/** SHA-256 of a cookie value, base64url — the only form a sign-in is keyed or passed by. */
export function signInKeyOf(cookieValue: string): string {
  return createHash('sha256').update(cookieValue, 'utf8').digest('base64url');
}

/**
 * Take the sign-in cookie off a header bag. Returns the key and the headers
 * without the cookie; everything else is left exactly as it was (names
 * lower-cased, repeated values joined the way the hosts join them).
 *
 * @example
 *   const { key, headers } = readSignIn(req.headers);
 *   const who = key === undefined ? undefined : await signIns.identify(key);
 *   log.info({ path: req.url, headers: withoutCredentials(headers) });
 */
export function readSignIn(headers: HeaderBag, cookieName: string = SIGN_IN_COOKIE): SignInRead {
  const out = flatten(headers);
  const cookie = out.cookie;
  if (cookie === undefined) return { headers: out };
  const kept: string[] = [];
  const values: string[] = [];
  let stripped = false;
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf('=');
    const name = eq < 0 ? trimmed : trimmed.slice(0, eq).trim();
    if (name === cookieName) values.push(eq < 0 ? '' : trimmed.slice(eq + 1).trim());
    // A sign-in attempt's sealed transaction cookie is the door's alone.
    else if (name.startsWith(`${cookieName}-tx-`)) stripped = true;
    else kept.push(trimmed);
  }
  if (values.length === 0 && !stripped) return { headers: out };
  if (kept.length > 0) out.cookie = kept.join('; ');
  else delete out.cookie;
  const value = values.length === 1 ? unquote(values[0] as string) : '';
  return value.length > 0 ? { key: signInKeyOf(value), headers: out } : { headers: out };
}

/**
 * The headers minus every one that carries a credential — for a log line, an
 * error report, anything that leaves the process. Removes `cookie` and
 * `authorization` whole (any cookie may be a credential), every header in
 * {@link CREDENTIAL_HEADERS}, and any header named in `also` — pass the
 * deployment's own `tokenHeader` there. Names are compared lower-cased.
 */
export function withoutCredentials(
  headers: HeaderBag,
  options: { readonly also?: readonly string[] } = {},
): Record<string, string> {
  const out = flatten(headers);
  for (const name of CREDENTIAL_HEADERS) delete out[name];
  for (const name of options.also ?? []) delete out[name.toLowerCase()];
  return out;
}

/**
 * Every header name {@link withoutCredentials} removes:
 *
 * - the standard ones: `authorization`, `proxy-authorization`, `cookie`,
 *   `set-cookie`;
 * - `sec-websocket-protocol`, where a browser dialect carries a bearer token
 *   (a browser's WebSocket cannot set `authorization`);
 * - what authenticating proxies forward a signed token or identity in:
 *   `x-forwarded-access-token`, `x-auth-request-access-token`,
 *   `x-pomerium-jwt-assertion`, `x-amzn-oidc-accesstoken`, `x-amzn-oidc-data`,
 *   `x-amzn-oidc-identity`, `x-goog-iap-jwt-assertion`, `cf-access-jwt-assertion`,
 *   `x-ms-token-aad-access-token`, `x-ms-token-aad-id-token`,
 *   `x-ms-token-aad-refresh-token`, `x-ms-client-principal`;
 * - `x-api-key`.
 *
 * A header this list does not know (a custom token header) is removed only
 * when named in `also`.
 */
export const CREDENTIAL_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'sec-websocket-protocol',
  'x-forwarded-access-token',
  'x-auth-request-access-token',
  'x-pomerium-jwt-assertion',
  'x-amzn-oidc-accesstoken',
  'x-amzn-oidc-data',
  'x-amzn-oidc-identity',
  'x-goog-iap-jwt-assertion',
  'cf-access-jwt-assertion',
  'x-ms-token-aad-access-token',
  'x-ms-token-aad-id-token',
  'x-ms-token-aad-refresh-token',
  'x-ms-client-principal',
  'x-api-key',
];

function flatten(headers: HeaderBag): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join(key === 'cookie' ? '; ' : ', ');
  }
  return out;
}

/** RFC 6265 allows a DQUOTE-wrapped value; the quotes are not part of it. */
function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}
