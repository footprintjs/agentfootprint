/**
 * verify/discovery — read an issuer's OpenID discovery document, and say which
 * of three things happened.
 *
 * The classification is the point (rule 9: config errors refuse at boot,
 * outages answer 503). A mistyped issuer path that answers 404 is REACHABLE BUT
 * WRONG; calling it an outage would turn a typo into a permanent 503 that
 * nobody is ever told to fix. So:
 *
 *   • `outage` — a network error, a timeout, or a 5xx. The IdP may come back.
 *   • `misconfigured` — any other non-2xx (a redirect included: it is never
 *     followed), a body that is not a JSON object, a
 *     document with no `issuer` or no `jwks_uri`, an `issuer` that is not the
 *     configured one (compared exactly — OpenID Connect Discovery §4.3), or a
 *     key-set URL that is not `https`. The configuration names the wrong thing.
 *   • `ready` — a document that passed every check above.
 *
 * `access_token_issuer` (AD FS) is read from a `ready` document only. AD FS
 * signs access tokens with `iss` = `http://<host>/adfs/services/trust` while
 * its discovery `issuer` is `https://<host>/adfs`; a verifier pinned to the
 * second refuses every AD FS access token. That value is COMPARED, never
 * fetched, so the https rule does not apply to it.
 *
 * Nothing here throws: the three outcomes are values, and the caller decides
 * what each means at boot and at request time.
 */

import { isLoopbackBind } from '../../../hosting/doorGuard.js';

/** The checked facts a verifier needs out of the document. */
export interface DiscoveredIssuer {
  /** The document's `issuer` — equal to the configured one by construction. */
  readonly issuer: string;
  /** Where the signing keys are. */
  readonly jwksUri: string;
  /** AD FS's second issuer for access tokens, when the document names one. */
  readonly accessTokenIssuer?: string;
}

export type DiscoveryOutcome =
  | { readonly kind: 'ready'; readonly issuer: DiscoveredIssuer }
  | { readonly kind: 'outage'; readonly reason: string }
  | { readonly kind: 'misconfigured'; readonly check: string };

/** The one fetch this module makes — injectable, so tests need no socket. */
export type DiscoveryFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string>; redirect: 'manual' },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface ReadDiscoveryOptions {
  readonly fetch: DiscoveryFetch;
  readonly timeoutMs: number;
  /** Plain `http` on a loopback host is accepted (development only). */
  readonly allowLoopbackHttp: boolean;
}

/** `<issuer>/.well-known/openid-configuration`, a trailing `/` removed first. */
export function discoveryUrlFor(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

/**
 * Why `raw` is not a URL this library may fetch a credential-bearing answer
 * from — or `undefined` when it is. `https`, or `http` on a loopback host when
 * the caller allows it.
 */
export function fetchableUrlProblem(raw: string, allowLoopbackHttp: boolean): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not an absolute URL';
  }
  if (url.protocol === 'https:') return undefined;
  if (url.protocol === 'http:') {
    if (allowLoopbackHttp && isLoopbackBind(url.hostname)) return undefined;
    return allowLoopbackHttp
      ? 'is plain http on a host that is not this machine — use https'
      : 'is plain http — use https (http is accepted only for localhost, outside production)';
  }
  return `uses ${url.protocol} — use https`;
}

/** Fetch and classify. Never throws. */
export async function readDiscovery(
  configuredIssuer: string,
  options: ReadDiscoveryOptions,
): Promise<DiscoveryOutcome> {
  const url = discoveryUrlFor(configuredIssuer);
  let status: number;
  let text: string;
  try {
    const signal = AbortSignal.timeout(options.timeoutMs);
    const res = await options.fetch(url, {
      signal,
      headers: { accept: 'application/json' },
      // Never followed: the document chooses the signing keys, so it is read
      // from the issuer's own URL or not at all (OIDC Discovery §4).
      redirect: 'manual',
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name;
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return {
      kind: 'outage',
      reason: timedOut
        ? `${url} did not answer within ${options.timeoutMs} ms`
        : `${url} could not be reached`,
    };
  }
  if (status >= 500) return { kind: 'outage', reason: `${url} answered HTTP ${status}` };
  if (status >= 300 && status < 400) {
    return {
      kind: 'misconfigured',
      check:
        `${url} redirected (HTTP ${status}). The document is read only from the issuer's own ` +
        `URL — a redirect could hand the choice of signing keys to another origin, or to ` +
        `plain http — so the issuer must be the URL the document lives under.`,
    };
  }
  if (status < 200 || status >= 300) {
    return {
      kind: 'misconfigured',
      check:
        `${url} answered HTTP ${status}. The issuer must be the URL the discovery document ` +
        `lives under (for AD FS, 'https://<host>/adfs'; for Entra ID, ` +
        `'https://login.microsoftonline.com/<tenant>/v2.0').`,
    };
  }
  return checkDocument(configuredIssuer, url, text, options.allowLoopbackHttp);
}

function checkDocument(
  configuredIssuer: string,
  url: string,
  text: string,
  allowLoopbackHttp: boolean,
): DiscoveryOutcome {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { kind: 'misconfigured', check: `${url} did not answer JSON` };
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { kind: 'misconfigured', check: `${url} did not answer a JSON object` };
  }
  const { issuer, jwks_uri: jwksUri, access_token_issuer: ati } = doc as Record<string, unknown>;
  if (typeof issuer !== 'string' || issuer.length === 0) {
    return { kind: 'misconfigured', check: `${url} names no 'issuer'` };
  }
  if (issuer !== configuredIssuer) {
    return {
      kind: 'misconfigured',
      check:
        `${url} names the issuer '${issuer}', not the configured '${configuredIssuer}'. ` +
        `They are compared exactly, trailing '/' included — copy the document's value.`,
    };
  }
  if (typeof jwksUri !== 'string' || jwksUri.length === 0) {
    return { kind: 'misconfigured', check: `${url} names no 'jwks_uri'` };
  }
  const keysProblem = fetchableUrlProblem(jwksUri, allowLoopbackHttp);
  if (keysProblem !== undefined) {
    return { kind: 'misconfigured', check: `the document's jwks_uri '${jwksUri}' ${keysProblem}` };
  }
  if (ati !== undefined && (typeof ati !== 'string' || ati.length === 0)) {
    return {
      kind: 'misconfigured',
      check: `${url} names an 'access_token_issuer' that is not a string`,
    };
  }
  return {
    kind: 'ready',
    issuer: { issuer, jwksUri, ...(typeof ati === 'string' && { accessTokenIssuer: ati }) },
  };
}
