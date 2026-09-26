/**
 * strategies/directoryChoice — `directory-password` from config: plain Active
 * Directory over LDAPS, for a company with no federation server (design §4.5).
 *
 * Allowed in production (unlike `local-password`) — it is the company's real
 * directory — and the banner says what it costs: a password bind skips
 * whatever MFA the company's single sign-on enforces.
 *
 * Attempt limits come from AD's OWN lockout policy, which the AD admin
 * supplies: at most half the threshold per name per observation window, so
 * the door never spends more than half of a person's lockout budget (AD also
 * counts their VPN, mail and typos — this REDUCES the risk, it cannot rule it
 * out). A threshold of 0 means AD never locks; the door keeps its default.
 */

import { readFileSync } from 'node:fs';

import { memorySignIns } from '../../../hosting/signin/memorySignIns.js';
import { signInDoor, type SignInDoor } from '../../../hosting/signin/door.js';
import { directoryPasswords } from '../directory/directoryPasswords.js';
import { ldapDirectory, type LdaptsBackend } from '../directory/ldapDirectory.js';
import { IdentityConfigError, type IdentityConfig } from './config.js';
import type { IdentityBootOptions, IdentityChoice } from './choose.js';
import { doorRefusal } from './doorError.js';
import { keyLabel } from './vocabulary.js';

/** Build the `directory-password` choice, or refuse to boot naming the key. */
export function directoryPasswordChoice(
  config: IdentityConfig,
  boot: IdentityBootOptions & { readonly ldapts?: LdaptsBackend },
  production: boolean,
): IdentityChoice {
  const url = need(config.ldapUrl, 'ldapUrl', 'IDENTITY_LDAP_URL');
  const caFile = need(config.ldapCaFile, 'ldapCaFile', 'IDENTITY_LDAP_CA_FILE');
  const domain = need(config.ldapDomain, 'ldapDomain', 'IDENTITY_LDAP_DOMAIN');
  const netbiosDomain = need(
    config.ldapNetbiosDomain,
    'ldapNetbiosDomain',
    'IDENTITY_LDAP_NETBIOS_DOMAIN',
  );
  const baseDn = need(config.ldapBaseDn, 'ldapBaseDn', 'IDENTITY_LDAP_BASE_DN');
  const publicUrl = need(config.publicUrl, 'publicUrl', 'IDENTITY_PUBLIC_URL');
  const threshold = needNumber(config.ldapLockoutThreshold, 'IDENTITY_LDAP_LOCKOUT_THRESHOLD');
  const windowMinutes = needNumber(
    config.ldapLockoutWindowMinutes,
    'IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES',
  );
  if (windowMinutes < 1) {
    throw new IdentityConfigError(
      "IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES is AD's observation window, at least 1 minute.",
      'IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES',
    );
  }
  let caPem: string;
  try {
    caPem = readFileSync(caFile, 'utf8');
  } catch {
    throw new IdentityConfigError(
      'IDENTITY_LDAP_CA_FILE names a file that cannot be read.',
      'IDENTITY_LDAP_CA_FILE',
    );
  }
  let directory;
  try {
    directory = ldapDirectory({
      url,
      caPem,
      ...(boot.ldapts !== undefined && { backend: boot.ldapts }),
    });
  } catch (err) {
    const text = err instanceof Error ? err.message.replace(/^\[identity\] /, '') : String(err);
    throw new IdentityConfigError(
      `directory-password cannot start: ${text}`,
      /caPem/.test(text) ? 'IDENTITY_LDAP_CA_FILE' : 'IDENTITY_LDAP_URL',
    );
  }
  const passwords = directoryPasswords({
    directory,
    domain,
    netbiosDomain,
    baseDn,
    ...(config.ldapRequiredGroup !== undefined && { requiredGroup: config.ldapRequiredGroup }),
    log: (line) => console.warn(line),
  });
  const perName = threshold === 0 ? undefined : Math.max(1, Math.floor(threshold / 2));
  let door: SignInDoor;
  try {
    door = signInDoor({
      passwords,
      store: memorySignIns({ ...(config.signInMax !== undefined && { max: config.signInMax }) }),
      publicUrl,
      production,
      limits: { ...(perName !== undefined && { perName }), windowMinutes },
      ...(boot.crossSite !== undefined && { guard: boot.crossSite }),
      ...(config.signInHours !== undefined && { hours: config.signInHours }),
      ...(config.signInIdleMinutes !== undefined && { idleMinutes: config.signInIdleMinutes }),
      ...(config.trustedProxies !== undefined && { trustedProxies: config.trustedProxies }),
    });
  } catch (err) {
    throw doorRefusal('directory-password', err);
  }
  return {
    strategy: 'directory-password',
    mode: 'password',
    identity: door.identity,
    signInDoor: door,
    hostSignIn: door.hostSignIn,
    banner: [
      `identity: strategy directory-password — ${url}, bind as <name>@${domain}, Who-am-I must name ${netbiosDomain.toUpperCase()}\\…`,
      `identity: user id = the authenticated entry's objectGUID (base64) under ${baseDn}` +
        (config.ldapRequiredGroup !== undefined
          ? `; required group ${config.ldapRequiredGroup}`
          : ''),
      `identity: attempt limits from AD's lockout policy: ${
        perName === undefined ? 'AD never locks (threshold 0), door default' : `${perName} per name`
      } per ${windowMinutes} min — this REDUCES lockout risk; AD also counts VPN, mail and typos`,
      "identity: WARNING this strategy bypasses the company's MFA / Conditional Access: a password bind skips whatever the single sign-on enforces",
      ...door.banner,
    ],
  };
}

function need(value: string | undefined, field: string, key: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  throw new IdentityConfigError(`directory-password needs ${keyLabel(field)}.`, key);
}

function needNumber(value: number | undefined, key: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new IdentityConfigError(
    `directory-password needs ${key}: the AD admin supplies it (a threshold of 0 means AD never locks).`,
    key,
  );
}
