/**
 * oidcIdentity — verify a PERSON's access token from the company's OpenID
 * Connect identity provider (AD FS 2016+, Entra ID, Keycloak, Okta, Ping).
 *
 * Pattern: Adapter over `jose` + OpenID discovery, behind the vendor-neutral
 *          {@link IdentityVerifier} port. The `oidc-token` strategy's verifier.
 * Role:    everything `jwksIdentity` checks (signature, `iss`, `aud`, `exp`
 *          required, `nbf`), plus what makes a signed token a PERSON:
 *
 *   1. **Discovery, then pinning, with failures classified.** The issuer's
 *      `/.well-known/openid-configuration` is read before any token is
 *      accepted. An unreachable IdP is an OUTAGE (503, retried on later
 *      requests); a 404, a body that is not JSON, a document without
 *      `jwks_uri` or naming another issuer is a CONFIG ERROR (every request
 *      answers 503 "misconfigured", and `identityFromConfig` refuses to boot).
 *   2. **Issuer.** `iss` must equal the configured issuer, or AD FS's
 *      `access_token_issuer` from a document that passed (1).
 *   3. **`exp` is required.** A token with no lifetime is refused.
 *   4. **The stable id claim is required config** — no `sub` default. On both
 *      Microsoft IdPs `sub` is pairwise per application, not the person.
 *   5. **The person test** (`verify/personTest.ts`): the required scope, no
 *      app-only shape, an allowed client. Refusals `not-a-user-token` and
 *      `wrong-client`.
 *   6. **Roles: a string is ONE role**; a path reads nested roles.
 *   7. **Unknown is not none**: a roles claim replaced by an overage pointer
 *      is refused as `roles-unknown`.
 *   8. **Clock tolerance** defaults to 60 s.
 *
 * Emits nothing. The door that called it reports the refusal — by CLASS. The
 * token, its claims and the IdP's own text never appear in an error.
 *
 * @example
 *   const verifier = oidcIdentity({
 *     issuer: 'https://login.microsoftonline.com/<tenant>/v2.0',
 *     audience: '<API client id>',
 *     userIdClaim: 'oid',
 *     requiredScope: 'access_as_user',
 *     allowedClients: ['<web client id>'],
 *   });
 *   standingAgent({ …, identity: { verify: verifier.verify } });
 */

import { IdentityNotVerifiedError, VerifierUnavailableError } from '../../hosting/errors.js';
import type { IdentityVerifier, VerifiedIdentity } from '../../hosting/identityVerification.js';
import { claimAt, rolesOf, type ClaimPath } from './verify/claims.js';
import {
  fetchableUrlProblem,
  readDiscovery,
  type DiscoveredIssuer,
  type DiscoveryFetch,
} from './verify/discovery.js';
import {
  DEFAULT_ALGORITHMS,
  loadJose,
  verifySignedToken,
  type JoseBackend,
} from './verify/jwtCore.js';
import { personTestFailure, rolesAreElsewhere } from './verify/personTest.js';

export type { DiscoveryFetch } from './verify/discovery.js';

export interface OidcIdentityOptions {
  /**
   * The issuer, exactly as the discovery document names it (compared
   * exactly, trailing `/` included). With discovery on it must be `https` —
   * it is FETCHED — except `http` on a loopback host when
   * {@link allowLoopbackHttp} is set. With discovery off it is a literal,
   * compared and never fetched.
   */
  readonly issuer: string;
  /** THIS API's name at the IdP — never a client's id. */
  readonly audience: string | readonly string[];
  /**
   * The claim that names the person — REQUIRED, no default. It decides who
   * owns every conversation, forever. `oid` on Entra ID; a custom
   * `objectGUID` claim on AD FS; `sub` is wrong on both. A top-level name (a
   * URI is fine; dots are never split). The value is taken as bytes: never
   * trimmed or case-folded.
   */
  readonly userIdClaim: string;
  /**
   * The OAuth scope only this API's PERSON tokens carry (Entra
   * `access_as_user`, an AD FS scope granted to the web client, a Keycloak
   * client scope). One scope, no spaces, compared exactly.
   */
  readonly requiredScope: string;
  /** Where the scopes are. Default `'scp'` (Entra, AD FS); `'scope'` for RFC 9068 IdPs (Keycloak, Okta). */
  readonly scopeClaim?: string;
  /**
   * The clients allowed to obtain a person token for this API, read from
   * `azp`, else `appid`, else `cid`, else `client_id`. `'any'` turns the check
   * off — the banner says so. A token naming no client is refused.
   */
  readonly allowedClients: readonly string[] | 'any';
  /** The roles claim: a top-level name or a path (`['realm_access', 'roles']`). Default `'roles'`. A string is one role. */
  readonly rolesClaim?: ClaimPath;
  /** Overrides the discovery document's `jwks_uri`. REQUIRED when discovery is off. Must be `https`. */
  readonly jwksUrl?: string;
  /** `'on'` (default) reads the issuer's discovery document; `'off'` needs {@link jwksUrl} and treats `issuer` as a literal. */
  readonly discovery?: 'on' | 'off';
  /** Seconds of clock skew tolerated on `exp`/`nbf`. Default 60. */
  readonly clockToleranceSeconds?: number;
  /** Signature algorithms. Default: the RSA and ECDSA families (never `HS*`). */
  readonly algorithms?: readonly string[];
  /** Accept `http` URLs on a loopback host (development only). Default `false`. */
  readonly allowLoopbackHttp?: boolean;
  /** Timeout for the discovery fetch, in ms. Default 5000. */
  readonly discoveryTimeoutMs?: number;
  /** After an outage, the least time between two discovery attempts, in ms. Default 5000. */
  readonly discoveryRetryMs?: number;
  /** The fetch discovery uses. Default: the runtime's `fetch`. */
  readonly fetch?: DiscoveryFetch;
  /** An already-imported `jose` (see `jwksIdentity`'s `backend`). */
  readonly backend?: JoseBackend;
}

/**
 * Where discovery stands. `ready` is final for the life of the verifier;
 * `outage` is retried on a later request; `misconfigured` is final.
 */
export type OidcDiscoveryState =
  | { readonly kind: 'ready'; readonly issuer: DiscoveredIssuer }
  | { readonly kind: 'outage'; readonly reason: string }
  | { readonly kind: 'misconfigured'; readonly check: string };

/** The verifier, plus its discovery state for a boot check or a banner. */
export interface OidcIdentity extends IdentityVerifier {
  /**
   * Run discovery now (or return the settled answer). Never throws. A second
   * call after an outage retries, no sooner than `discoveryRetryMs`.
   */
  discover(): Promise<OidcDiscoveryState>;
}

const VERIFIER = 'oidcIdentity';
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;
const DEFAULT_DISCOVERY_RETRY_MS = 5_000;

export function oidcIdentity(options: OidcIdentityOptions): OidcIdentity {
  const settings = checkOptions(options);
  const discovery = discoveryCell(settings);
  let keyring: Promise<{ jose: JoseBackend; keys: unknown }> | undefined;

  const keysFor = (jwksUri: string): Promise<{ jose: JoseBackend; keys: unknown }> =>
    (keyring ??= (async () => {
      const jose = options.backend ?? (await loadJose());
      return { jose, keys: jose.createRemoteJWKSet(new URL(jwksUri)) };
    })().catch((err) => {
      keyring = undefined;
      throw err;
    }));

  return {
    discover: discovery.read,
    async verify(token: string): Promise<VerifiedIdentity> {
      const state = await discovery.read();
      if (state.kind === 'outage') {
        throw new VerifierUnavailableError(VERIFIER, `discovery failed: ${state.reason}`);
      }
      if (state.kind === 'misconfigured') {
        throw new VerifierUnavailableError(VERIFIER, `identity is misconfigured: ${state.check}`);
      }
      const { jose, keys } = await keysFor(settings.jwksUrl ?? state.issuer.jwksUri);
      const payload = await verifySignedToken(jose, keys, token, {
        issuer: acceptedIssuers(state.issuer),
        audience: settings.audience,
        algorithms: settings.algorithms,
        clockToleranceSeconds: settings.clockToleranceSeconds,
        verifierName: VERIFIER,
      });
      return personFrom(payload, settings);
    },
  };
}

// ─── The steps, in order ─────────────────────────────────────────────

interface Settings {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly userIdClaim: string;
  readonly requiredScope: string;
  readonly scopeClaim: string;
  readonly allowedClients: readonly string[] | 'any';
  readonly rolesClaim: ClaimPath;
  readonly jwksUrl?: string;
  readonly discovery: 'on' | 'off';
  readonly clockToleranceSeconds: number;
  readonly algorithms: readonly string[];
  readonly allowLoopbackHttp: boolean;
  readonly discoveryTimeoutMs: number;
  readonly discoveryRetryMs: number;
  readonly fetch?: DiscoveryFetch;
}

/** The token's claims → a person, or the refusal that says why not. */
function personFrom(payload: Record<string, unknown>, settings: Settings): VerifiedIdentity {
  const failure = personTestFailure(payload, settings);
  if (failure !== undefined) throw new IdentityNotVerifiedError(failure, false);
  const userId = payload[settings.userIdClaim];
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new IdentityNotVerifiedError('unverifiable', false);
  }
  if (rolesAreElsewhere(payload, settings.rolesClaim)) {
    throw new IdentityNotVerifiedError('roles-unknown', false);
  }
  const roles = rolesOf(claimAt(payload, settings.rolesClaim), 'list');
  return { userId, ...(roles !== undefined && { roles }), claims: payload };
}

function acceptedIssuers(discovered: DiscoveredIssuer): string | readonly string[] {
  const { issuer, accessTokenIssuer } = discovered;
  return accessTokenIssuer === undefined || accessTokenIssuer === issuer
    ? issuer
    : [issuer, accessTokenIssuer];
}

/**
 * Discovery as one cell: single-flight, `ready`/`misconfigured` settle for
 * good, an `outage` is retried by a later call no sooner than the retry gap.
 */
function discoveryCell(settings: Settings): { read(): Promise<OidcDiscoveryState> } {
  if (settings.discovery === 'off') {
    const ready: OidcDiscoveryState = {
      kind: 'ready',
      issuer: { issuer: settings.issuer, jwksUri: settings.jwksUrl as string },
    };
    return { read: () => Promise.resolve(ready) };
  }
  let settled: OidcDiscoveryState | undefined;
  let inFlight: Promise<OidcDiscoveryState> | undefined;
  let lastOutage: { at: number; state: OidcDiscoveryState } | undefined;
  const read = (): Promise<OidcDiscoveryState> => {
    if (settled !== undefined) return Promise.resolve(settled);
    if (inFlight !== undefined) return inFlight;
    if (lastOutage !== undefined && Date.now() - lastOutage.at < settings.discoveryRetryMs) {
      return Promise.resolve(lastOutage.state);
    }
    inFlight = readDiscovery(settings.issuer, {
      fetch: settings.fetch ?? defaultFetch(),
      timeoutMs: settings.discoveryTimeoutMs,
      allowLoopbackHttp: settings.allowLoopbackHttp,
    }).then((outcome) => {
      inFlight = undefined;
      if (outcome.kind === 'outage') lastOutage = { at: Date.now(), state: outcome };
      else settled = outcome;
      return outcome;
    });
    return inFlight;
  };
  return { read };
}

function defaultFetch(): DiscoveryFetch {
  if (typeof fetch !== 'function') {
    throw new TypeError(
      '[identity] oidcIdentity needs a global fetch (Node 18+) to read the discovery document, ' +
        'or a `fetch` option.',
    );
  }
  return (url, init) => fetch(url, init);
}

// ─── Construction refusals ───────────────────────────────────────────

function checkOptions(options: OidcIdentityOptions): Settings {
  const discovery = options.discovery ?? 'on';
  if (discovery !== 'on' && discovery !== 'off') {
    refuse(`discovery must be 'on' or 'off' (got ${JSON.stringify(discovery)})`);
  }
  const allowLoopbackHttp = options.allowLoopbackHttp === true;
  const issuer = nonEmpty(options.issuer, 'issuer', 'the issuer URL your IdP names');
  if (discovery === 'on') {
    const problem = fetchableUrlProblem(issuer, allowLoopbackHttp);
    if (problem !== undefined) refuse(`the issuer '${issuer}' ${problem}`);
  }
  if (options.jwksUrl !== undefined) {
    const problem = fetchableUrlProblem(options.jwksUrl, allowLoopbackHttp);
    if (problem !== undefined) refuse(`the jwksUrl '${options.jwksUrl}' ${problem}`);
  } else if (discovery === 'off') {
    refuse('discovery is off, so jwksUrl is required — there is no document to read it from');
  }
  if (emptyNames(options.audience)) {
    refuse(
      `audience is required — this API's name at the IdP. Without it a token minted for a ` +
        `different service verifies here (the confused-deputy shape).`,
    );
  }
  const userIdClaim = nonEmpty(
    options.userIdClaim,
    'userIdClaim',
    `the claim that names the person ('oid' on Entra ID, your objectGUID claim on AD FS). ` +
      `There is no default: it decides who owns every conversation`,
  );
  const requiredScope = nonEmpty(
    options.requiredScope,
    'requiredScope',
    `the OAuth scope only this API's person tokens carry. Without it an application's own ` +
      `token passes as a person`,
  );
  if (/\s/.test(requiredScope)) refuse(`requiredScope is ONE scope, with no spaces`);
  const allowedClients = checkClients(options.allowedClients);
  return {
    issuer,
    audience: options.audience,
    userIdClaim,
    requiredScope,
    scopeClaim: options.scopeClaim ?? 'scp',
    allowedClients,
    rolesClaim: checkPath(options.rolesClaim ?? 'roles'),
    ...(options.jwksUrl !== undefined && { jwksUrl: options.jwksUrl }),
    discovery,
    clockToleranceSeconds: checkSeconds(options.clockToleranceSeconds),
    algorithms: options.algorithms ?? DEFAULT_ALGORITHMS,
    allowLoopbackHttp,
    discoveryTimeoutMs: options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
    discoveryRetryMs: options.discoveryRetryMs ?? DEFAULT_DISCOVERY_RETRY_MS,
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  };
}

function checkClients(value: readonly string[] | 'any' | undefined): readonly string[] | 'any' {
  if (value === 'any') return 'any';
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((c) => typeof c !== 'string' || c.length === 0)
  ) {
    refuse(
      `allowedClients is required: the client ids allowed to obtain a person token for this ` +
        `API, or 'any' to turn the client check off`,
    );
  }
  return value as readonly string[];
}

function checkPath(path: ClaimPath): ClaimPath {
  const ok =
    typeof path === 'string'
      ? path.length > 0
      : Array.isArray(path) && path.length > 0 && path.every((p) => typeof p === 'string' && p);
  if (!ok) refuse(`rolesClaim is a claim name or a non-empty path of names`);
  return path;
}

function checkSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CLOCK_TOLERANCE_SECONDS;
  if (!Number.isFinite(value) || value < 0) {
    refuse(`clockToleranceSeconds is a number of seconds, 0 or more (got ${String(value)})`);
  }
  return value;
}

function nonEmpty(value: unknown, name: string, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    refuse(`${name} is required — ${what}`);
  return value as string;
}

function emptyNames(value: string | readonly string[] | undefined): boolean {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value))
    return value.length === 0 || value.some((v) => typeof v !== 'string' || !v);
  return true;
}

function refuse(sentence: string): never {
  throw new TypeError(`[identity] oidcIdentity: ${sentence}.`);
}
