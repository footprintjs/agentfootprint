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
export const STRATEGIES_IN_THIS_RELEASE: readonly IdentityStrategyName[] = [
  'open',
  'oidc-token',
  'local-password',
  'directory-password',
  'proxy-token',
];

/** How an environment value becomes a config value. */
export type EnvReading = 'text' | 'strategy' | 'clients' | 'list' | 'claim-path' | 'whole-number';

/** One key this release reads: its env name, its config field, how it parses. */
export interface ConfigKey {
  readonly env: string;
  readonly field: string;
  readonly reading: EnvReading;
  /** The strategies that read it (absent for `IDENTITY_STRATEGY`). */
  readonly owners?: readonly IdentityStrategyName[];
}

/** The keys this release reads, each owned by the strategies that read it (and `IDENTITY_STRATEGY`). */
export const KEYS_IN_THIS_RELEASE: readonly ConfigKey[] = [
  { env: 'IDENTITY_STRATEGY', field: 'strategy', reading: 'strategy' },
  {
    env: 'IDENTITY_ISSUER',
    field: 'issuer',
    reading: 'text',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_AUDIENCE',
    field: 'audience',
    reading: 'text',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_USER_ID_CLAIM',
    field: 'userIdClaim',
    reading: 'text',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_REQUIRED_SCOPE',
    field: 'requiredScope',
    reading: 'text',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_SCOPE_CLAIM',
    field: 'scopeClaim',
    reading: 'text',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_ALLOWED_CLIENTS',
    field: 'allowedClients',
    reading: 'clients',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_ROLES_CLAIM',
    field: 'rolesClaim',
    reading: 'claim-path',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_JWKS_URL',
    field: 'jwksUrl',
    reading: 'text',
    owners: ['oidc-token', 'proxy-token'],
  },
  {
    env: 'IDENTITY_CLOCK_TOLERANCE_SECONDS',
    field: 'clockToleranceSeconds',
    reading: 'whole-number',
    owners: ['oidc-token', 'proxy-token'],
  },
  { env: 'IDENTITY_CLIENT_ID', field: 'clientId', reading: 'text', owners: ['oidc-token'] },
  {
    env: 'IDENTITY_CLIENT_SECRET_FILE',
    field: 'clientSecretFile',
    reading: 'text',
    owners: ['oidc-token'],
  },
  {
    env: 'IDENTITY_CLIENT_KEY_FILE',
    field: 'clientKeyFile',
    reading: 'text',
    owners: ['oidc-token'],
  },
  { env: 'IDENTITY_PKCE', field: 'pkce', reading: 'text', owners: ['oidc-token'] },
  {
    env: 'IDENTITY_COOKIE_KEY_FILE',
    field: 'cookieKeyFile',
    reading: 'text',
    owners: ['oidc-token'],
  },
  { env: 'IDENTITY_SCOPE', field: 'scope', reading: 'text', owners: ['oidc-token'] },
  { env: 'IDENTITY_RESOURCE', field: 'resource', reading: 'text', owners: ['oidc-token'] },
  {
    env: 'IDENTITY_DISPLAY_NAME_CLAIM',
    field: 'displayNameClaim',
    reading: 'text',
    owners: ['oidc-token'],
  },
  {
    env: 'IDENTITY_PUBLIC_URL',
    field: 'publicUrl',
    reading: 'text',
    owners: ['oidc-token', 'local-password', 'directory-password', 'proxy-token'],
  },
  {
    env: 'IDENTITY_SIGN_IN_HOURS',
    field: 'signInHours',
    reading: 'whole-number',
    owners: ['oidc-token', 'local-password', 'directory-password'],
  },
  {
    env: 'IDENTITY_SIGN_IN_IDLE_MINUTES',
    field: 'signInIdleMinutes',
    reading: 'whole-number',
    owners: ['oidc-token', 'local-password', 'directory-password'],
  },
  {
    env: 'IDENTITY_SIGN_IN_MAX',
    field: 'signInMax',
    reading: 'whole-number',
    owners: ['oidc-token', 'local-password', 'directory-password'],
  },
  { env: 'IDENTITY_LOCAL_USERS', field: 'localUsers', reading: 'text', owners: ['local-password'] },
  {
    env: 'IDENTITY_TRUSTED_PROXIES',
    field: 'trustedProxies',
    reading: 'list',
    owners: ['local-password', 'directory-password', 'proxy-token'],
  },
  {
    env: 'IDENTITY_LDAP_URL',
    field: 'ldapUrl',
    reading: 'text',
    owners: ['directory-password'],
  },
  {
    env: 'IDENTITY_LDAP_CA_FILE',
    field: 'ldapCaFile',
    reading: 'text',
    owners: ['directory-password'],
  },
  {
    env: 'IDENTITY_LDAP_DOMAIN',
    field: 'ldapDomain',
    reading: 'text',
    owners: ['directory-password'],
  },
  {
    env: 'IDENTITY_LDAP_NETBIOS_DOMAIN',
    field: 'ldapNetbiosDomain',
    reading: 'text',
    owners: ['directory-password'],
  },
  {
    env: 'IDENTITY_LDAP_BASE_DN',
    field: 'ldapBaseDn',
    reading: 'text',
    owners: ['directory-password'],
  },
  {
    env: 'IDENTITY_LDAP_REQUIRED_GROUP',
    field: 'ldapRequiredGroup',
    reading: 'text',
    owners: ['directory-password'],
  },
  {
    env: 'IDENTITY_LDAP_LOCKOUT_THRESHOLD',
    field: 'ldapLockoutThreshold',
    reading: 'whole-number',
    owners: ['directory-password'],
  },
  {
    env: 'IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES',
    field: 'ldapLockoutWindowMinutes',
    reading: 'whole-number',
    owners: ['directory-password'],
  },
  { env: 'IDENTITY_PROXY_HEADER', field: 'proxyHeader', reading: 'text', owners: ['proxy-token'] },
  { env: 'IDENTITY_PROXY_TOKEN', field: 'proxyToken', reading: 'text', owners: ['proxy-token'] },
];

/** What a key a later release reads belongs to — named in its refusal. */
export type LaterFeature = 'the first-token report' | 'the role gate' | 'the proxy sign-out link';

/**
 * Keys named in the design and read by a later release. Refused by name.
 *
 * (Browser sign-in for `oidc-token` has moved in, and with it the two boot
 * refusals it needs — design §3 H1, door hardening, and §5.3, `IDENTITY_AUDIENCE`
 * never equal to `IDENTITY_CLIENT_ID`: see `browserChoice.ts · browserSettings`.)
 */
export const KEYS_IN_A_LATER_RELEASE: Readonly<Record<string, LaterFeature>> = {
  IDENTITY_DIAGNOSE: 'the first-token report',
  IDENTITY_REQUIRED_ROLE: 'the role gate',
  IDENTITY_PROXY_SIGN_OUT_URL: 'the proxy sign-out link',
};

/** `issuer` → `IDENTITY_ISSUER (issuer)`: both spellings, so either reader finds it. */
export function keyLabel(field: string): string {
  const key = KEYS_IN_THIS_RELEASE.find((k) => k.field === field);
  return key === undefined ? field : `${key.env} (${field})`;
}
