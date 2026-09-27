/**
 * strategies/directoryChoice — `directory-password` from config: plain Active
 * Directory over LDAPS, for a company with no federation server (design §4.5).
 *
 * Allowed in production (unlike `local-password`) — it is the company's real
 * directory — and the banner says what it costs: a password bind skips
 * whatever MFA the company's single sign-on enforces.
 *
 * Attempt limits come from AD's OWN lockout policy, which the AD admin
 * supplies (review idI57 B-1, B-2, S-4):
 *  - **a THIRD of the threshold per ACCOUNT**, counted under the account the
 *    name reaches (`alice`, `ALICE`, `CORP\alice` and `alice@corp.example` are
 *    one budget), over a window that — like AD's own "reset account lockout
 *    counter after" — restarts from the LAST failure;
 *  - a third, not a half, because one AD account can have TWO logon names the
 *    door cannot tie together without a service account: the UPN prefix and
 *    the sAMAccountName (Jane: `jsmith@corp`, `jsmith2`). Two budgets of
 *    ⌊T/3⌋ still leave AD a third of its threshold for the person's VPN, mail
 *    and typos. The residual: an account with THREE distinct logon names (an
 *    alternative UPN suffix) could reach T through this door alone;
 *  - a threshold of 1 or 2 is REFUSED at boot — no budget of whole attempts
 *    stays under it — unless `IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD=yes`, whose
 *    banner says the door cannot protect those accounts;
 *  - a threshold of 0 means AD never locks; the door keeps its default.
 * This REDUCES lockout risk; it cannot rule it out (AD counts every source).
 * The protection that holds whatever this door does is AD's own: a lockout
 * DURATION of minutes, not "until an admin unlocks", and a threshold of 10 or
 * more (the Microsoft security baseline's number).
 */

import { readFileSync } from 'node:fs';

import { memorySignIns } from '../../../hosting/signin/memorySignIns.js';
import { DEFAULT_IDLE_MINUTES, signInDoor, type SignInDoor } from '../../../hosting/signin/door.js';
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
  let passwords;
  try {
    passwords = directoryPasswords({
      directory,
      domain,
      netbiosDomain,
      baseDn,
      ...(config.ldapRequiredGroup !== undefined && { requiredGroup: config.ldapRequiredGroup }),
      log: (line) => console.warn(line),
    });
  } catch (err) {
    const text = err instanceof Error ? err.message.replace(/^\[identity\] /, '') : String(err);
    throw new IdentityConfigError(
      `directory-password cannot start: ${text}`,
      'IDENTITY_LDAP_BASE_DN',
    );
  }
  const perName = attemptsPerAccount(threshold, config.ldapAcceptLowThreshold);
  let door: SignInDoor;
  try {
    door = signInDoor({
      passwords,
      store: memorySignIns({
        ...(config.signInMax !== undefined && { max: config.signInMax }),
        idleMinutes: config.signInIdleMinutes ?? DEFAULT_IDLE_MINUTES.password,
      }),
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
      'identity: directory-password is PENDING INDEPENDENT REVIEW before a company install',
      `identity: user id = the authenticated entry's objectGUID (base64) under ${baseDn}` +
        (config.ldapRequiredGroup !== undefined
          ? `; required group ${config.ldapRequiredGroup}`
          : ''),
      `identity: attempt limits from AD's lockout policy: ${
        perName === undefined
          ? 'AD never locks (threshold 0), door default'
          : `${perName} per account (a third of AD's ${threshold}; alice, ALICE, ${netbiosDomain.toUpperCase()}\\alice and alice@${domain} are one account)`
      }, counter reset ${windowMinutes} min after the LAST failure — this REDUCES lockout risk; AD also counts VPN, mail and typos, and an account with a separate UPN prefix has two budgets`,
      ...(threshold > 0 && threshold < 3
        ? [
            `identity: WARNING AD locks an account after ${threshold} wrong password${
              threshold === 1 ? '' : 's'
            } — this door CANNOT protect accounts from lockout (IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD=yes); raise AD's threshold or set a short lockout duration`,
          ]
        : []),
      "identity: WARNING this strategy bypasses the company's MFA / Conditional Access: a password bind skips whatever the single sign-on enforces",
      ...door.banner,
    ],
  };
}

/**
 * Attempts per account per window: a third of AD's threshold (see the header),
 * the door default when AD never locks, and a boot refusal for 1 or 2 unless
 * the operator said, in so many words, that the door cannot protect them.
 */
function attemptsPerAccount(threshold: number, acceptLow: string | undefined): number | undefined {
  const low = threshold > 0 && threshold < 3;
  if (acceptLow !== undefined && (acceptLow !== 'yes' || !low)) {
    throw new IdentityConfigError(
      acceptLow !== 'yes'
        ? "IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD takes one value, 'yes'."
        : `IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD is set but the threshold is ${threshold}; it only applies to a threshold of 1 or 2, so remove it.`,
      'IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD',
    );
  }
  if (low && acceptLow === undefined) {
    throw new IdentityConfigError(
      `IDENTITY_LDAP_LOCKOUT_THRESHOLD=${threshold}: AD locks an account after ${threshold} wrong ` +
        `password${
          threshold === 1 ? '' : 's'
        }, and no attempt budget through this door can stay under ` +
        `that. Raise AD's threshold (the Microsoft baseline is 10), or set ` +
        `IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD=yes to boot knowing the door cannot protect accounts from lockout.`,
      'IDENTITY_LDAP_LOCKOUT_THRESHOLD',
    );
  }
  if (threshold === 0) return undefined;
  return Math.max(1, Math.floor(threshold / 3));
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
