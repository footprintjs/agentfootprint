/**
 * strategies/config — the identity config object, its boot refusal, and the
 * mapping from environment variables onto it.
 *
 * One prefix, `IDENTITY_`. The library reads a plain object
 * ({@link IdentityConfig}); {@link identityConfigFromEnv} is the one mapping
 * from `process.env`-shaped input onto it, so an app that keeps its settings
 * elsewhere builds the object itself and loses nothing.
 */

import type { ClaimPath } from '../verify/claims.js';
import {
  IDENTITY_STRATEGIES,
  KEYS_IN_A_LATER_RELEASE,
  KEYS_IN_THIS_RELEASE,
  type ConfigKey,
  type IdentityStrategyName,
} from './vocabulary.js';

/**
 * How a deployment proves who is calling. Every field is optional in the TYPE
 * because which ones are required depends on the strategy; the boot check
 * ({@link identityFromConfig}) refuses a missing one by name.
 */
export interface IdentityConfig {
  /** `IDENTITY_STRATEGY`. Unset means `open` — outside production only. */
  readonly strategy?: IdentityStrategyName;
  /** `IDENTITY_ISSUER` — the issuer exactly as its discovery document names it. */
  readonly issuer?: string;
  /** `IDENTITY_AUDIENCE` — this API's name at the IdP, never a client's id. */
  readonly audience?: string | readonly string[];
  /** `IDENTITY_USER_ID_CLAIM` — the claim that names the person. No default. */
  readonly userIdClaim?: string;
  /** `IDENTITY_REQUIRED_SCOPE` — the scope only this API's person tokens carry. */
  readonly requiredScope?: string;
  /** `IDENTITY_SCOPE_CLAIM` — default `scp`; `scope` for Keycloak and Okta. */
  readonly scopeClaim?: string;
  /** `IDENTITY_ALLOWED_CLIENTS` — comma-separated client ids, or `any`. */
  readonly allowedClients?: readonly string[] | 'any';
  /** `IDENTITY_ROLES_CLAIM` — a claim name, or (env) a JSON array path such as `["realm_access","roles"]`. */
  readonly rolesClaim?: ClaimPath;
  /** `IDENTITY_JWKS_URL` — overrides the discovery document's `jwks_uri`. */
  readonly jwksUrl?: string;
  /** `IDENTITY_CLOCK_TOLERANCE_SECONDS` — default 60. */
  readonly clockToleranceSeconds?: number;
  /** `IDENTITY_CLIENT_ID` — the browser client's id at the IdP (`oidc-token` browser sign-in). */
  readonly clientId?: string;
  /** `IDENTITY_CLIENT_KEY_FILE` — a PEM private key file for `private_key_jwt` (preferred). */
  readonly clientKeyFile?: string;
  /** `IDENTITY_CLIENT_SECRET_FILE` — a file holding the client secret (accepted). */
  readonly clientSecretFile?: string;
  /** `IDENTITY_PKCE` — `required` (default) or `off` (AD FS 2016). */
  readonly pkce?: string;
  /** `IDENTITY_COOKIE_KEY_FILE` — 32 bytes that seal sign-in attempts; shared by replicas. */
  readonly cookieKeyFile?: string;
  /** `IDENTITY_SCOPE` — the OAuth scopes the browser asks for: `openid` and this API's scope. */
  readonly scope?: string;
  /** `IDENTITY_RESOURCE` — AD FS: the Web API identifier, sent as `resource`. */
  readonly resource?: string;
  /** `IDENTITY_DISPLAY_NAME_CLAIM` — the access-token claim the page shows. */
  readonly displayNameClaim?: string;
  /** `IDENTITY_PUBLIC_URL` — the URL people open the app at (browser sign-in, `local-password`). */
  readonly publicUrl?: string;
  /** `IDENTITY_LOCAL_USERS` — `name:scrypt$…` entries, comma separated (`local-password`). */
  readonly localUsers?: string;
  /** `IDENTITY_SIGN_IN_HOURS` — a sign-in's absolute lifetime. Default 8. */
  readonly signInHours?: number;
  /** `IDENTITY_SIGN_IN_IDLE_MINUTES` — idle limit. Default 60 under a password strategy. */
  readonly signInIdleMinutes?: number;
  /** `IDENTITY_SIGN_IN_MAX` — the most sign-ins kept in memory. Default 10 000. */
  readonly signInMax?: number;
  /** `IDENTITY_LDAP_URL` — `ldaps://dc1.corp.example:636` (`directory-password`; `ldap://` refused). */
  readonly ldapUrl?: string;
  /** `IDENTITY_LDAP_CA_FILE` — the company CA (PEM) the DC certificate chains to. */
  readonly ldapCaFile?: string;
  /** `IDENTITY_LDAP_DOMAIN` — the DNS domain people bind as `<name>@<domain>`. */
  readonly ldapDomain?: string;
  /** `IDENTITY_LDAP_NETBIOS_DOMAIN` — the NetBIOS domain Who-am-I must name. */
  readonly ldapNetbiosDomain?: string;
  /** `IDENTITY_LDAP_BASE_DN` — where accounts are searched. */
  readonly ldapBaseDn?: string;
  /** `IDENTITY_LDAP_REQUIRED_GROUP` — optional: the group (DN) people must be in, nested. */
  readonly ldapRequiredGroup?: string;
  /** `IDENTITY_LDAP_LOCKOUT_THRESHOLD` — AD's account-lockout threshold (0 = AD never locks). */
  readonly ldapLockoutThreshold?: number;
  /** `IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES` — AD's "reset account lockout counter after" window. */
  readonly ldapLockoutWindowMinutes?: number;
  /**
   * `IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD=yes` — boot although AD locks after 1
   * or 2 wrong passwords, a threshold this door cannot stay under. Refused for
   * any other threshold (a setting that does nothing is refused, not ignored).
   */
  readonly ldapAcceptLowThreshold?: string;
  /** `IDENTITY_PROXY_HEADER` — where the proxy puts the token (`proxy-token`). Default `authorization`. */
  readonly proxyHeader?: string;
  /** `IDENTITY_PROXY_TOKEN` — what the proxy forwards. Required; only `access-token` is accepted. */
  readonly proxyToken?: string;
  /** `IDENTITY_TRUSTED_PROXIES` — peers whose `X-Forwarded-For` is believed. */
  readonly trustedProxies?: readonly string[];
}

/**
 * The deployment's identity configuration cannot be started. Raised at BOOT,
 * never per request: a wrong or missing setting must stop the install, not
 * turn into a door that is quietly open or permanently 503.
 *
 * Names the key, says why, says what to set. Never prints a secret or a claim
 * value — only names and URLs the operator wrote.
 */
export class IdentityConfigError extends Error {
  readonly code = 'ERR_IDENTITY_CONFIG' as const;
  /** The env name of the key at fault, when one key is. */
  readonly key?: string;

  constructor(sentence: string, key?: string) {
    super(`[identity] ${sentence}`);
    this.name = 'IdentityConfigError';
    if (key !== undefined) this.key = key;
  }
}

/**
 * Map `IDENTITY_*` environment variables onto an {@link IdentityConfig}.
 *
 * An empty value counts as unset (an env file's `KEY=`). Values are trimmed —
 * they are configuration, not ids. Refused here, by name:
 *
 *  - a lower-case `identity_*` name (a likely typo that would otherwise be ignored);
 *  - a key a LATER release reads (`IDENTITY_LDAP_URL`, `IDENTITY_CLIENT_ID`, …)
 *    — "not in this release", never silently ignored;
 *  - any other `IDENTITY_*` name — a typo must not become a default;
 *  - a strategy name that is not one of the five;
 *  - a value that does not parse (`IDENTITY_CLOCK_TOLERANCE_SECONDS=soon`).
 *
 * Skipped, never read or printed: the {@link FOREIGN_PLATFORM_KEYS} a hosting
 * platform injects (`IDENTITY_ENDPOINT`, `IDENTITY_HEADER`, …).
 *
 * @example
 *   const choice = await identityFromConfig(identityConfigFromEnv(process.env), {
 *     production: process.env.NODE_ENV === 'production',
 *   });
 */
export function identityConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): IdentityConfig {
  const config: Record<string, unknown> = {};
  for (const name of Object.keys(env).sort()) {
    if (!name.toUpperCase().startsWith('IDENTITY_')) continue;
    // Another platform's own variables, never read and never printed.
    if (FOREIGN_PLATFORM_KEYS.includes(name)) continue;
    if (!name.startsWith('IDENTITY_')) {
      throw new IdentityConfigError(
        `${name} looks like an identity setting in the wrong case. Settings are upper-case ` +
          `(${name.toUpperCase()}); a lower-case one would be silently ignored, so it is refused.`,
        name,
      );
    }
    const raw = env[name];
    if (raw === undefined || raw.trim().length === 0) continue;
    const key = KEYS_IN_THIS_RELEASE.find((k) => k.env === name);
    if (key === undefined) refuseUnread(name);
    else config[key.field] = readValue(key, raw.trim());
  }
  return config as IdentityConfig;
}

/**
 * `IDENTITY_*` names another platform injects into every process it hosts, and
 * which therefore are not this library's settings: Azure App Service, Functions
 * and Container Apps set `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` (the managed
 * identity endpoint and its secret header) and may set `IDENTITY_API_VERSION`;
 * Service Fabric sets `IDENTITY_SERVER_THUMBPRINT`. They are skipped — never
 * read, never printed in a refusal or a banner — so
 * `identityConfigFromEnv(process.env)` works on those hosts.
 */
export const FOREIGN_PLATFORM_KEYS: readonly string[] = [
  'IDENTITY_ENDPOINT',
  'IDENTITY_HEADER',
  'IDENTITY_API_VERSION',
  'IDENTITY_SERVER_THUMBPRINT',
];

function refuseUnread(name: string): never {
  const later = KEYS_IN_A_LATER_RELEASE[name];
  if (later !== undefined) {
    throw new IdentityConfigError(
      `${name} belongs to ${later}, which is not in this release. Remove it: a setting that ` +
        `does nothing would let this deployment believe it is doing something.`,
      name,
    );
  }
  throw new IdentityConfigError(
    `${name} is not a setting this release reads — a misspelling must not become a default. ` +
      `The settings are: ${KEYS_IN_THIS_RELEASE.map((k) => k.env).join(', ')}.`,
    name,
  );
}

function readValue(key: ConfigKey, value: string): unknown {
  switch (key.reading) {
    case 'text':
      return value;
    case 'strategy':
      return readStrategy(value);
    case 'clients':
      return readClients(value);
    case 'list':
      return value.split(/[\s,]+/).filter((v) => v.length > 0);
    case 'claim-path':
      return readClaimPath(value);
    case 'whole-number':
      return readWholeNumber(key.env, value);
  }
}

/** Refuse anything but the five names, listing them. */
export function readStrategy(value: unknown): IdentityStrategyName {
  if (typeof value === 'string' && (IDENTITY_STRATEGIES as readonly string[]).includes(value)) {
    return value as IdentityStrategyName;
  }
  throw new IdentityConfigError(
    `IDENTITY_STRATEGY is ${JSON.stringify(value)}, which is not a strategy. It is one of: ` +
      `${IDENTITY_STRATEGIES.join(', ')}. A typo must not become 'open'.`,
    'IDENTITY_STRATEGY',
  );
}

function readClients(value: string): readonly string[] | 'any' {
  const clients = value.split(/[\s,]+/).filter((c) => c.length > 0);
  if (clients.includes('any')) {
    if (clients.length === 1) return 'any';
    throw new IdentityConfigError(
      `IDENTITY_ALLOWED_CLIENTS lists 'any' beside client ids. Say 'any' alone (the client ` +
        `check is off) or list the clients.`,
      'IDENTITY_ALLOWED_CLIENTS',
    );
  }
  return clients;
}

function readClaimPath(value: string): ClaimPath {
  if (!value.startsWith('[')) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = undefined;
  }
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((p) => typeof p === 'string' && p.length > 0)
  ) {
    return parsed as string[];
  }
  throw new IdentityConfigError(
    `IDENTITY_ROLES_CLAIM starts with '[' but is not a JSON array of claim names. Write a ` +
      `nested claim as a path, e.g. ["realm_access","roles"]; a plain name is written bare.`,
    'IDENTITY_ROLES_CLAIM',
  );
}

function readWholeNumber(name: string, value: string): number {
  if (/^\d{1,6}$/.test(value)) return Number(value);
  throw new IdentityConfigError(`${name} is a whole number (got '${value}').`, name);
}
