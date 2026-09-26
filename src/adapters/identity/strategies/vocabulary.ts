/**
 * strategies/vocabulary — the ONE list of strategy names and config keys.
 *
 * Every name a deployment can write is here, including the ones a later
 * release reads. That is deliberate: a key this release does not read yet is
 * REFUSED by name ("not in this release"), never ignored, because a setting
 * that silently does nothing is a deployment that believes it is protected.
 */

/** The five ways of proving who is calling. One per deployment. */
export type IdentityStrategyName =
  | 'open'
  | 'oidc-token'
  | 'proxy-token'
  | 'directory-password'
  | 'local-password';

export const IDENTITY_STRATEGIES: readonly IdentityStrategyName[] = [
  'open',
  'oidc-token',
  'proxy-token',
  'directory-password',
  'local-password',
];

/** The strategies this release can start. The others are refused by name. */
export const STRATEGIES_IN_THIS_RELEASE: readonly IdentityStrategyName[] = ['open', 'oidc-token'];

/** How an environment value becomes a config value. */
export type EnvReading = 'text' | 'strategy' | 'clients' | 'claim-path' | 'seconds';

/** One key this release reads: its env name, its config field, how it parses. */
export interface ConfigKey {
  readonly env: string;
  readonly field: string;
  readonly reading: EnvReading;
}

/** The keys `oidc-token` reads (and `IDENTITY_STRATEGY`). */
export const KEYS_IN_THIS_RELEASE: readonly ConfigKey[] = [
  { env: 'IDENTITY_STRATEGY', field: 'strategy', reading: 'strategy' },
  { env: 'IDENTITY_ISSUER', field: 'issuer', reading: 'text' },
  { env: 'IDENTITY_AUDIENCE', field: 'audience', reading: 'text' },
  { env: 'IDENTITY_USER_ID_CLAIM', field: 'userIdClaim', reading: 'text' },
  { env: 'IDENTITY_REQUIRED_SCOPE', field: 'requiredScope', reading: 'text' },
  { env: 'IDENTITY_SCOPE_CLAIM', field: 'scopeClaim', reading: 'text' },
  { env: 'IDENTITY_ALLOWED_CLIENTS', field: 'allowedClients', reading: 'clients' },
  { env: 'IDENTITY_ROLES_CLAIM', field: 'rolesClaim', reading: 'claim-path' },
  { env: 'IDENTITY_JWKS_URL', field: 'jwksUrl', reading: 'text' },
  { env: 'IDENTITY_CLOCK_TOLERANCE_SECONDS', field: 'clockToleranceSeconds', reading: 'seconds' },
];

/** What a key a later release reads belongs to — named in its refusal. */
export type LaterFeature =
  | 'browser sign-in'
  | 'the role gate'
  | 'proxy-token'
  | 'directory-password'
  | 'local-password';

/** Keys named in the design and read by a later release. Refused by name. */
export const KEYS_IN_A_LATER_RELEASE: Readonly<Record<string, LaterFeature>> = {
  IDENTITY_PUBLIC_URL: 'browser sign-in',
  IDENTITY_CLIENT_ID: 'browser sign-in',
  IDENTITY_CLIENT_SECRET_FILE: 'browser sign-in',
  IDENTITY_CLIENT_KEY_FILE: 'browser sign-in',
  IDENTITY_PKCE: 'browser sign-in',
  IDENTITY_COOKIE_KEY_FILE: 'browser sign-in',
  IDENTITY_SCOPE: 'browser sign-in',
  IDENTITY_RESOURCE: 'browser sign-in',
  IDENTITY_DISPLAY_NAME_CLAIM: 'browser sign-in',
  IDENTITY_SIGN_IN_HOURS: 'browser sign-in',
  IDENTITY_SIGN_IN_IDLE_MINUTES: 'browser sign-in',
  IDENTITY_SIGN_IN_MAX: 'browser sign-in',
  IDENTITY_DIAGNOSE: 'browser sign-in',
  IDENTITY_TRUSTED_PROXIES: 'browser sign-in',
  IDENTITY_REQUIRED_ROLE: 'the role gate',
  IDENTITY_PROXY_HEADER: 'proxy-token',
  IDENTITY_PROXY_TOKEN: 'proxy-token',
  IDENTITY_PROXY_SIGN_OUT_URL: 'proxy-token',
  IDENTITY_LDAP_URL: 'directory-password',
  IDENTITY_LDAP_CA_FILE: 'directory-password',
  IDENTITY_LDAP_DOMAIN: 'directory-password',
  IDENTITY_LDAP_NETBIOS_DOMAIN: 'directory-password',
  IDENTITY_LDAP_BASE_DN: 'directory-password',
  IDENTITY_LDAP_REQUIRED_GROUP: 'directory-password',
  IDENTITY_LDAP_LOCKOUT_THRESHOLD: 'directory-password',
  IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES: 'directory-password',
  IDENTITY_LOCAL_USERS: 'local-password',
};

/** `issuer` → `IDENTITY_ISSUER (issuer)`: both spellings, so either reader finds it. */
export function keyLabel(field: string): string {
  const key = KEYS_IN_THIS_RELEASE.find((k) => k.field === field);
  return key === undefined ? field : `${key.env} (${field})`;
}
