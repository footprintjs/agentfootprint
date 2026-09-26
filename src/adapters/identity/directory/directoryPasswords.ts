/**
 * directory/directoryPasswords — the `directory-password` strategy's check:
 * a person types their Windows username and password, and Active Directory
 * says who they are (design §4.5).
 *
 * The steps, in order (the sign-in door around this already applied the door
 * guard, the JSON body, the minimum time and the attempt limits):
 *
 *  1. **An empty password is refused before the directory is touched.** RFC
 *     4513 §5.1.2: a simple bind with a name and an empty password is an
 *     UNAUTHENTICATED bind, which a directory may answer as a success.
 *  2. **The username is checked before the bind**: 1–64 characters of
 *     `A–Z a–z 0–9 . _ -`, after removing a trailing `@<domain>` only when it
 *     is exactly the configured domain (people paste their UPN). Anything else
 *     — another `@domain`, `\`, `,`, `=`, parentheses, `*` — never reaches the
 *     directory.
 *  3. **Bind as `<name>@<domain>`** with the typed password, over LDAPS only.
 *     No service account, so no stored directory secret.
 *  4. **Ask who it authenticated: RFC 4532 Who-am-I**, on the same connection.
 *     An empty answer is anonymous and refused (a second guard behind step 1).
 *  5. **Parse the answer**: `u:<NETBIOS>\<sAMAccountName>` (the domain must be
 *     the configured NetBIOS domain) or `u:<SID>`. Anything else is refused.
 *  6. **Find EXACTLY ONE entry** for that account under the base DN, by
 *     `sAMAccountName` or `objectSid`, every value escaped (RFC 4515). Zero or
 *     two is a refusal. The id is THAT entry's `objectGUID` (base64 of its 16
 *     bytes) — never re-derived from the typed text.
 *  7. **The required group**, when set: nested membership of that same DN
 *     (`LDAP_MATCHING_RULE_IN_CHAIN`), the group DN escaped as a filter value.
 *
 * ── Why Who-am-I (the rename collision, review B-3) ─────────────────────────
 * AD does not authenticate "the object whose name is the typed text". An
 * explicit userPrincipalName beats another object's implicit
 * `sAMAccountName@domain` (MS-ADTS "Simple Authentication"). If Jane's UPN is
 * `jsmith@corp` and a new John's sAMAccountName is `jsmith`, Jane typing
 * `jsmith` and HER password authenticates Jane — and a search for
 * `sAMAccountName=jsmith` finds John. Asking the directory which object it
 * authenticated is the only answer that cannot hand Jane John's conversations.
 *
 * Every wrong credential — an unknown name, a wrong password, an expired or
 * must-change password (AD sub-codes 52e, 525, 530, 531, 532, 533, 701, 773,
 * 775), a name that fails the pattern, a missing group — is ONE answer
 * (`undefined`). A directory that cannot be reached throws (the door answers
 * 503). The password is never stored, logged or forwarded.
 */

import type { PasswordAccepted, PasswordChecker } from '../../../hosting/signin/types.js';
import { escapeFilterValue, sidToBytes, type Directory, type DirectorySession } from './port.js';

export interface DirectoryPasswordsOptions {
  /** Where connections come from — `ldapDirectory({ … })`, or a fake in tests. */
  readonly directory: Directory;
  /** The DNS domain people bind as `<name>@<domain>` (`corp.example`). */
  readonly domain: string;
  /** The NetBIOS domain Who-am-I must name (`CORP`). */
  readonly netbiosDomain: string;
  /** Where the account's entry is searched (`DC=corp,DC=example`). */
  readonly baseDn: string;
  /** Optional: the DN of a group the person must be in, directly or nested. */
  readonly requiredGroup?: string;
  /** Told the directory's refusal reason for an operator log — never the password. */
  readonly log?: (line: string) => void;
}

const NAME = /^[A-Za-z0-9._-]{1,64}$/;
/** LDAP_MATCHING_RULE_IN_CHAIN: nested group membership. */
const IN_CHAIN = '1.2.840.113556.1.4.1941';

export function directoryPasswords(options: DirectoryPasswordsOptions): PasswordChecker {
  const domain = required(options.domain, 'domain');
  const netbios = required(options.netbiosDomain, 'netbiosDomain').toUpperCase();
  const baseDn = required(options.baseDn, 'baseDn');
  const suffix = `@${domain}`.toLowerCase();

  return {
    strategy: 'directory-password',
    async check(typed: string, password: string): Promise<PasswordAccepted | undefined> {
      if (password.length === 0) return undefined;
      const name = accountName(typed, suffix);
      if (name === undefined) return undefined;
      const session = await options.directory.open();
      try {
        return await authenticated(session, name, password);
      } finally {
        await session.close().catch(() => undefined);
      }
    },
  };

  async function authenticated(
    session: DirectorySession,
    name: string,
    password: string,
  ): Promise<PasswordAccepted | undefined> {
    if ((await session.bind(`${name}@${domain}`, password)) !== 'ok') return undefined;
    const filter = accountFilter(await session.whoAmI(), netbios);
    if (filter === undefined) {
      options.log?.(
        '[identity] directory-password: Who-am-I did not name an account of this domain',
      );
      return undefined;
    }
    const entries = await session.search(baseDn, filter, 'sub');
    if (entries.length !== 1) {
      options.log?.(
        `[identity] directory-password: ${entries.length} entries matched the authenticated account`,
      );
      return undefined;
    }
    const entry = entries[0] as (typeof entries)[number];
    if (entry.objectGUID === undefined || entry.objectGUID.length !== 16) return undefined;
    if (options.requiredGroup !== undefined) {
      const member = await session.search(
        entry.dn,
        `(memberOf:${IN_CHAIN}:=${escapeFilterValue(options.requiredGroup)})`,
        'base',
      );
      if (member.length !== 1) return undefined;
    }
    const userId = entry.objectGUID.toString('base64');
    return {
      identity: { userId },
      ...(entry.displayName !== undefined &&
        entry.displayName.length > 0 && {
          displayName: entry.displayName,
        }),
    };
  }
}

/** The account name to bind as, or `undefined` for a name that never reaches the directory. */
export function accountName(typed: string, domainSuffix: string): string | undefined {
  let name = typed.trim();
  if (name.toLowerCase().endsWith(domainSuffix)) name = name.slice(0, -domainSuffix.length);
  return NAME.test(name) ? name : undefined;
}

/**
 * Who-am-I's answer → the filter for exactly that account, or `undefined`.
 * `u:CORP\alice` → `(sAMAccountName=alice)` (the domain must be ours);
 * `u:S-1-5-21-…` → `(objectSid=<bytes>)`; anything else (empty = anonymous,
 * `dn:` = AD LDS) is refused.
 */
export function accountFilter(authzId: string, netbiosDomain: string): string | undefined {
  if (!authzId.startsWith('u:')) return undefined;
  const who = authzId.slice(2);
  const sid = sidToBytes(who);
  if (sid !== undefined) return `(objectSid=${escapeFilterValue(sid)})`;
  const slash = who.indexOf('\\');
  if (slash <= 0) return undefined;
  if (who.slice(0, slash).toUpperCase() !== netbiosDomain.toUpperCase()) return undefined;
  const sam = who.slice(slash + 1);
  if (sam.length === 0) return undefined;
  return `(&(objectClass=user)(sAMAccountName=${escapeFilterValue(sam)}))`;
}

function required(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`[identity] directoryPasswords: ${name} is required.`);
  }
  return value.trim();
}
