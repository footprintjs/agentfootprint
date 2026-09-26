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
 *  - a key a LATER release reads (`IDENTITY_LDAP_URL`, `IDENTITY_CLIENT_ID`, …)
 *    — "not in this release", never silently ignored;
 *  - any other `IDENTITY_*` name — a typo must not become a default;
 *  - a strategy name that is not one of the five;
 *  - a value that does not parse (`IDENTITY_CLOCK_TOLERANCE_SECONDS=soon`).
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
    if (!name.startsWith('IDENTITY_')) continue;
    const raw = env[name];
    if (raw === undefined || raw.trim().length === 0) continue;
    const key = KEYS_IN_THIS_RELEASE.find((k) => k.env === name);
    if (key === undefined) refuseUnread(name);
    else config[key.field] = readValue(key, raw.trim());
  }
  return config as IdentityConfig;
}

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
    case 'claim-path':
      return readClaimPath(value);
    case 'seconds':
      return readSeconds(key.env, value);
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

function readSeconds(name: string, value: string): number {
  if (/^\d{1,6}$/.test(value)) return Number(value);
  throw new IdentityConfigError(`${name} is a whole number of seconds (got '${value}').`, name);
}
