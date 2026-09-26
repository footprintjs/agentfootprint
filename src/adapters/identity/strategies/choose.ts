/**
 * strategies/choose — `identityFromConfig`: config in, one strategy out, or a
 * boot refusal that names the key.
 *
 * Pattern: Strategy (GoF), chosen by CONFIG at install time — one per
 *          deployment, behind the existing {@link IdentityVerifier} port.
 * Role:    the one place a deployment's identity settings are judged. Every
 *          door (`standingAgent`, an app's own routes) takes what this returns.
 *
 * ── The laws it enforces at boot (rule 9) ───────────────────────────────────
 *  • **Production names its strategy**, even `open`. Missing config must not
 *    mean "no identity". `production` is an input the APP supplies; the
 *    library never guesses it from `NODE_ENV`.
 *  • **A typo is not `open`.** An unknown strategy, an unknown key, or a key a
 *    later release reads is refused by name.
 *  • **Somebody configured a sign-in and forgot to switch it on**: strategy
 *    unset while `oidc-token` keys are set is refused, in every environment.
 *  • **A half-configured verifier is not a smaller verifier**: every required
 *    key is required; `IDENTITY_USER_ID_CLAIM` has no default.
 *  • **Config errors refuse; outages answer 503.** Discovery runs at boot. A
 *    404, a body that is not JSON, a document without `jwks_uri` or naming
 *    another issuer refuses to boot. An IdP that cannot be reached lets the
 *    app start, says so in the banner, and answers 503 until it is reachable.
 *
 * Asynchronous — a refinement of the design's shape, on purpose: a discovery
 * config error must refuse the BOOT, and discovery is a network read.
 */

import type { IdentityVerificationOptions } from '../../../hosting/identityVerification.js';
import { pathLabel } from '../verify/claims.js';
import { discoveryUrlFor, fetchableUrlProblem, type DiscoveryFetch } from '../verify/discovery.js';
import type { JoseBackend } from '../verify/jwtCore.js';
import { oidcIdentity, type OidcDiscoveryState, type OidcIdentityOptions } from '../oidc.js';
import { IdentityConfigError, readStrategy, type IdentityConfig } from './config.js';
import {
  KEYS_IN_A_LATER_RELEASE,
  KEYS_IN_THIS_RELEASE,
  STRATEGIES_IN_THIS_RELEASE,
  keyLabel,
  type IdentityStrategyName,
} from './vocabulary.js';

/** What the app tells the library about where it is running. */
export interface IdentityBootOptions {
  /**
   * Is this a production deployment? REQUIRED — the app decides (e.g.
   * `NODE_ENV === 'production' || APP_ENV === 'production'`), because only the
   * app knows every way it spells it. Production refuses an unset strategy and
   * plain-`http` issuers on `localhost`.
   */
  readonly production: boolean;
  /** The fetch discovery uses. Default: the runtime's `fetch`. */
  readonly fetch?: DiscoveryFetch;
  /** An already-imported `jose`, for a bundled app. */
  readonly backend?: JoseBackend;
}

/** The chosen strategy, ready to hand to every door. */
export interface IdentityChoice {
  /** Which strategy this deployment runs. */
  readonly strategy: IdentityStrategyName;
  /**
   * What `standingAgent({ identity })` and every app door take. ABSENT for
   * `open`: nothing about a request changes.
   */
  readonly identity?: IdentityVerificationOptions;
  /**
   * Lines to print at boot: the strategy, what it checks, what it does not,
   * and every warning. No secret, token, or claim value is ever in it.
   */
  readonly banner: readonly string[];
}

/**
 * Judge a deployment's identity config and build its strategy — or refuse to
 * boot with an {@link IdentityConfigError} naming the key.
 *
 * @example
 *   const choice = await identityFromConfig(identityConfigFromEnv(process.env), {
 *     production: process.env.NODE_ENV === 'production',
 *   });
 *   for (const line of choice.banner) console.log(line);
 *   const host = await standingAgent({ agent, sessions, host, identity: choice.identity });
 */
export async function identityFromConfig(
  config: IdentityConfig,
  boot: IdentityBootOptions,
): Promise<IdentityChoice> {
  const production = checkBoot(boot);
  const fields = checkFields(config);
  if (config.strategy === undefined) return unsetStrategy(fields, production);
  const strategy = readStrategy(config.strategy);
  if (!STRATEGIES_IN_THIS_RELEASE.includes(strategy)) {
    throw new IdentityConfigError(
      `IDENTITY_STRATEGY is '${strategy}', which is not in this release. This release starts ` +
        `${STRATEGIES_IN_THIS_RELEASE.join(' and ')}; the others are named so a deployment ` +
        `that asks for one is refused rather than run as something else.`,
      'IDENTITY_STRATEGY',
    );
  }
  if (strategy === 'open') return openChoice(fields, true);
  return oidcChoice(config, boot, production);
}

// ─── The three outcomes ──────────────────────────────────────────────

function unsetStrategy(fields: readonly string[], production: boolean): IdentityChoice {
  if (production) {
    throw new IdentityConfigError(
      `IDENTITY_STRATEGY is not set, and this is production. Production names its strategy — ` +
        `even 'open' — so an env file that failed to load cannot start a door with no identity. ` +
        `Set IDENTITY_STRATEGY=open to run with no identity on purpose.`,
      'IDENTITY_STRATEGY',
    );
  }
  if (fields.length > 0) {
    throw new IdentityConfigError(
      `${fields.map(keyLabel).join(', ')} ${fields.length === 1 ? 'is' : 'are'} set but ` +
        `IDENTITY_STRATEGY is not. Somebody configured a sign-in and did not switch it on. ` +
        `Set IDENTITY_STRATEGY=oidc-token, or remove the keys.`,
      'IDENTITY_STRATEGY',
    );
  }
  return openChoice(fields, false);
}

function openChoice(fields: readonly string[], stated: boolean): IdentityChoice {
  return {
    strategy: 'open',
    banner: [
      stated
        ? 'identity: strategy open'
        : 'identity: strategy open (IDENTITY_STRATEGY is not set; production would refuse this)',
      'identity: no identity — anyone who can reach this port can use it, and the record names nobody',
      ...fields.map(
        (f) =>
          `identity: WARNING ${keyLabel(f)} is set, but the strategy is open, so it does nothing`,
      ),
    ],
  };
}

async function oidcChoice(
  config: IdentityConfig,
  boot: IdentityBootOptions,
  production: boolean,
): Promise<IdentityChoice> {
  const options = oidcOptions(config, boot, production);
  const verifier = buildVerifier(options);
  const state = await verifier.discover();
  if (state.kind === 'misconfigured') {
    throw new IdentityConfigError(
      `oidc-token discovery refused: ${state.check.replace(/\.$/, '')}. Check IDENTITY_ISSUER.`,
      'IDENTITY_ISSUER',
    );
  }
  return {
    strategy: 'oidc-token',
    identity: { verify: verifier.verify },
    banner: oidcBanner(options, state, production),
  };
}

// ─── oidc-token: required keys, then the verifier's options ──────────

/** The verifier's own construction refusals are boot refusals too. */
function buildVerifier(options: OidcIdentityOptions): ReturnType<typeof oidcIdentity> {
  try {
    return oidcIdentity(options);
  } catch (err) {
    const text =
      err instanceof Error ? err.message.replace(/^\[identity\] oidcIdentity: /, '') : String(err);
    throw new IdentityConfigError(`oidc-token cannot start: ${text}`);
  }
}

function oidcOptions(
  config: IdentityConfig,
  boot: IdentityBootOptions,
  production: boolean,
): OidcIdentityOptions {
  const issuer = required(
    config.issuer,
    'issuer',
    'the issuer URL your IdP names in its discovery document',
  );
  checkUrl(issuer, 'issuer', production);
  const audience = config.audience;
  if (audience === undefined || (typeof audience === 'string' && audience.trim() === '')) {
    missing(
      'audience',
      `this API's name at the IdP (the Web API identifier on AD FS, the API registration's client id on Entra ID) — never a client's id`,
    );
  }
  const userIdClaim = required(
    config.userIdClaim,
    'userIdClaim',
    `the claim that names the person ('oid' on Entra ID, your objectGUID claim on AD FS). ` +
      `There is no default: 'sub' is pairwise per application on both Microsoft IdPs, and ` +
      `this claim decides who owns every conversation`,
  );
  const requiredScope = required(
    config.requiredScope,
    'requiredScope',
    `the OAuth scope only this API's PERSON tokens carry (Entra 'access_as_user'). Without ` +
      `it an application's own token passes as a person`,
  );
  if (/\s/.test(requiredScope)) {
    throw new IdentityConfigError(
      `${keyLabel('requiredScope')} is ONE scope, with no spaces.`,
      'IDENTITY_REQUIRED_SCOPE',
    );
  }
  if (
    config.allowedClients === undefined ||
    (Array.isArray(config.allowedClients) && config.allowedClients.length === 0)
  ) {
    missing(
      'allowedClients',
      `the client ids allowed to obtain a person token for this API, comma-separated, or 'any' ` +
        `to turn the client check off. Required because browser sign-in (which would default ` +
        `it to its own client) is not in this release`,
    );
  }
  if (config.jwksUrl !== undefined) checkUrl(config.jwksUrl, 'jwksUrl', production);
  return {
    issuer,
    audience,
    userIdClaim,
    requiredScope,
    allowedClients: config.allowedClients,
    ...(config.scopeClaim !== undefined && { scopeClaim: config.scopeClaim }),
    ...(config.rolesClaim !== undefined && { rolesClaim: config.rolesClaim }),
    ...(config.jwksUrl !== undefined && { jwksUrl: config.jwksUrl }),
    ...(config.clockToleranceSeconds !== undefined && {
      clockToleranceSeconds: config.clockToleranceSeconds,
    }),
    allowLoopbackHttp: !production,
    ...(boot.fetch !== undefined && { fetch: boot.fetch }),
    ...(boot.backend !== undefined && { backend: boot.backend }),
  } as OidcIdentityOptions;
}

function oidcBanner(
  options: OidcIdentityOptions,
  state: Exclude<OidcDiscoveryState, { kind: 'misconfigured' }>,
  production: boolean,
): string[] {
  const clients =
    options.allowedClients === 'any'
      ? `any — the client check is OFF`
      : options.allowedClients.join(', ');
  const lines = [
    'identity: strategy oidc-token (bearer access tokens; browser sign-in is not in this release)',
    `identity: issuer ${options.issuer}`,
    `identity: audience ${[options.audience].flat().join(', ')}`,
    `identity: user id claim ${options.userIdClaim} (taken as bytes: never trimmed or case-folded)`,
    `identity: person test — required scope '${options.requiredScope}' in '${
      options.scopeClaim ?? 'scp'
    }'; app-only tokens refused; allowed clients: ${clients}`,
    `identity: roles claim ${pathLabel(options.rolesClaim ?? 'roles')} (a string is one role)`,
    `identity: clock tolerance ${
      options.clockToleranceSeconds ?? 60
    } s; every token must carry exp`,
  ];
  if (state.kind === 'ready') {
    lines.push(`identity: discovery ok — ${discoveryUrlFor(options.issuer)}`);
    if (
      state.issuer.accessTokenIssuer !== undefined &&
      state.issuer.accessTokenIssuer !== options.issuer
    ) {
      lines.push(
        `identity: access tokens may also carry iss ${state.issuer.accessTokenIssuer} (the document's access_token_issuer)`,
      );
    }
    lines.push(`identity: signing keys ${options.jwksUrl ?? state.issuer.jwksUri}`);
  } else {
    lines.push(
      `identity: WARNING discovery is unreachable (${state.reason}). Every request answers 503 until a later request finds the document.`,
    );
  }
  if (!production && /^http:/i.test(options.issuer)) {
    lines.push('identity: WARNING plain-http issuer accepted because this is not production');
  }
  return lines;
}

// ─── Checks ──────────────────────────────────────────────────────────

function checkBoot(boot: IdentityBootOptions): boolean {
  if (boot === null || typeof boot !== 'object' || typeof boot.production !== 'boolean') {
    throw new IdentityConfigError(
      `identityFromConfig needs { production: true | false } from the app. The library never ` +
        `guesses it: an app that treats more than NODE_ENV as production must say so.`,
    );
  }
  return boot.production;
}

/** The set fields other than `strategy`; an unknown field refuses. */
function checkFields(config: IdentityConfig): string[] {
  if (config === null || typeof config !== 'object') {
    throw new IdentityConfigError(
      'identityFromConfig needs a config object (identityConfigFromEnv builds one).',
    );
  }
  const known = new Set(KEYS_IN_THIS_RELEASE.map((k) => k.field));
  const set: string[] = [];
  for (const [field, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (!known.has(field)) refuseUnknownField(field);
    if (field !== 'strategy') set.push(field);
  }
  return set;
}

function refuseUnknownField(field: string): never {
  const env = `IDENTITY_${field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
  const later = KEYS_IN_A_LATER_RELEASE[env];
  throw new IdentityConfigError(
    later !== undefined
      ? `'${field}' belongs to ${later}, which is not in this release. Remove it.`
      : `'${field}' is not a setting this release reads. The settings are: ` +
        `${KEYS_IN_THIS_RELEASE.map((k) => k.field).join(', ')}.`,
    later !== undefined ? env : undefined,
  );
}

function required(value: string | undefined, field: string, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) missing(field, what);
  return value as string;
}

function missing(field: string, what: string): never {
  const key = KEYS_IN_THIS_RELEASE.find((k) => k.field === field);
  throw new IdentityConfigError(`oidc-token needs ${keyLabel(field)}: ${what}.`, key?.env);
}

function checkUrl(url: string, field: string, production: boolean): void {
  const problem = fetchableUrlProblem(url, !production);
  if (problem === undefined) return;
  const key = KEYS_IN_THIS_RELEASE.find((k) => k.field === field);
  throw new IdentityConfigError(`${keyLabel(field)} '${url}' ${problem}.`, key?.env);
}
