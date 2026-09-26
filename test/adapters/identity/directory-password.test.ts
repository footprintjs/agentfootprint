/**
 * directory-password — Active Directory over LDAPS (design §4.5, §9 step 7).
 * 7-pattern tests (unit · scenario · integration · property · security ·
 * performance · ROI) against a FAKE directory that applies AD's bind-name
 * precedence (explicit UPN before implicit sAMAccountName@domain).
 *
 * The laws being pinned:
 *   • An empty password never reaches the directory.
 *   • The username is checked before the bind; only the configured domain's
 *     suffix is removed.
 *   • Who-am-I, not the typed name, decides who signed in; exactly one entry;
 *     the id is THAT entry's objectGUID — the rename collision is closed.
 *   • Who-am-I empty, naming another domain, or a `dn:` form → refused.
 *   • Every wrong credential is one answer; a directory that is down is 503.
 *   • The nested required group; a group DN with parentheses is escaped.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  directoryPasswords,
  escapeFilterValue,
  identityConfigFromEnv,
  identityFromConfig,
  ldapDirectory,
} from '../../../src/identity.js';
import {
  accountFilter,
  accountName,
} from '../../../src/adapters/identity/directory/directoryPasswords.js';
import { sidToBytes } from '../../../src/adapters/identity/directory/port.js';
import { call, login } from '../../hosting/signInDoorHarness.js';
import { mountDoor, type MountedDoor } from '../../hosting/signInDoorHarness.js';
import { fakeDirectory, type FakeAccount } from './conformance/fakeDirectory.js';
import { TEST_CA_PEM } from './conformance/testCertificates.js';
import { PasswordCheckUnreachableError } from '../../../src/hosting/index.js';

const ACCOUNTS: FakeAccount[] = [
  {
    sam: 'alice',
    password: 'Quartz-River-41!',
    displayName: 'Alice Archer',
    memberOf: ['CN=SAN-Ops,OU=G,DC=corp,DC=example'],
  },
  { sam: 'bob', password: 'Maple-Stone-52!', displayName: 'Bob Baker' },
  // The rename collision: Jane kept the explicit UPN jsmith@corp.example after
  // her sAMAccountName moved to jsmith2; a new John got sAMAccountName jsmith.
  { sam: 'jsmith2', password: 'jane-pw', upn: 'jsmith@corp.example', displayName: 'Jane Smith' },
  { sam: 'jsmith', password: 'john-pw', displayName: 'John Smith' },
];

function checker(extra: Partial<Parameters<typeof directoryPasswords>[0]> = {}) {
  const directory = fakeDirectory(ACCOUNTS);
  const passwords = directoryPasswords({
    directory,
    domain: 'corp.example',
    netbiosDomain: 'CORP',
    baseDn: 'DC=corp,DC=example',
    ...extra,
  });
  return { directory, passwords };
}

const open: MountedDoor[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

// ─── 1. UNIT ─────────────────────────────────────────────────────────

describe('directory-password — unit', () => {
  it('the name check: the configured domain suffix is removed; anything else odd never reaches the directory', () => {
    const suffix = '@corp.example';
    expect(accountName('alice', suffix)).toBe('alice');
    expect(accountName(' alice@CORP.example ', suffix)).toBe('alice');
    for (const bad of [
      'alice@other.example',
      'CORP\\alice',
      'CN=alice,DC=x',
      'a*',
      'a(b)',
      'a=b',
      '',
      'x'.repeat(65),
      'al ice',
      'ali\u0000ce',
    ]) {
      expect(accountName(bad, suffix), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('Who-am-I parsing: our NetBIOS domain or a SID; empty, another domain and dn: are refused', () => {
    expect(accountFilter('u:CORP\\alice', 'CORP')).toBe(
      '(&(objectClass=user)(sAMAccountName=alice))',
    );
    expect(accountFilter('u:corp\\alice', 'CORP')).toContain('sAMAccountName=alice');
    expect(accountFilter('', 'CORP')).toBeUndefined();
    expect(accountFilter('u:', 'CORP')).toBeUndefined();
    expect(accountFilter('u:OTHER\\alice', 'CORP')).toBeUndefined();
    expect(accountFilter('dn:CN=alice,DC=corp', 'CORP')).toBeUndefined();
    // The SID form carries the same objectClass guard as the NetBIOS form (review idI57 N-8).
    expect(accountFilter('u:S-1-5-21-1-2-3-1104', 'CORP')).toMatch(
      /^\(&\(objectClass=user\)\(objectSid=\\01\\05/,
    );
  });

  it('RFC 4515 escaping: * ( ) \\ NUL and non-ASCII; bytes escaped whole', () => {
    expect(escapeFilterValue('CN=Neo Users (Prod),OU=G')).toBe('CN=Neo Users \\28Prod\\29,OU=G');
    expect(escapeFilterValue('a*b\\c\u0000')).toBe('a\\2ab\\5cc\\00');
    expect(escapeFilterValue('é')).toBe('\\c3\\a9');
    expect(escapeFilterValue(Buffer.from([0x01, 0x41]))).toBe('\\01A');
    expect(sidToBytes('S-1-5-32-544')?.toString('hex')).toBe('01020000000000052000000020020000');
    expect(sidToBytes('not-a-sid')).toBeUndefined();
  });

  it('ldapDirectory refuses ldap:// and a CA that is not a PEM certificate', () => {
    expect(() =>
      ldapDirectory({ url: 'ldap://dc1:389', caPem: '-----BEGIN CERTIFICATE-----' }),
    ).toThrow(/clear/);
    expect(() => ldapDirectory({ url: 'ldaps://dc1:636', caPem: 'nope' })).toThrow(/PEM/);
  });
});

describe('ldapDirectory — TLS options (unit)', () => {
  it('checks the chain against the given CA and the host name against the URL — no switch to skip either', async () => {
    const seen: Record<string, unknown>[] = [];
    class Client {
      constructor(options: Record<string, unknown>) {
        seen.push(options);
      }
      async bind() {}
      async exop() {
        return { value: 'u:CORP\\alice' };
      }
      async search() {
        return { searchEntries: [] };
      }
      async unbind() {}
    }
    const directory = ldapDirectory({
      url: 'ldaps://dc1.corp.example:636',
      caPem: TEST_CA_PEM,
      backend: { Client } as never,
    });
    await (await directory.open()).close();
    const tls = seen[0]?.tlsOptions as Record<string, unknown>;
    expect(seen[0]?.url).toBe('ldaps://dc1.corp.example:636');
    expect(tls.rejectUnauthorized).toBe(true);
    expect(tls.ca).toEqual([TEST_CA_PEM]);
    expect(tls.checkServerIdentity).toBeUndefined(); // Node's own host-name check applies
  });
});

// ─── 2. SCENARIO — the laws ──────────────────────────────────────────

describe('directory-password — scenarios', () => {
  it('a person signs in: the id is their objectGUID (base64), with their display name', async () => {
    const { directory, passwords } = checker();
    const who = await passwords.check('alice', 'Quartz-River-41!');
    expect(who).toEqual({
      identity: { userId: directory.guidOf('alice') },
      displayName: 'Alice Archer',
    });
    expect(directory.binds).toEqual(['alice@corp.example']);
  });

  it('THE RENAME COLLISION: Jane typing `jsmith` and HER password is Jane — never John', async () => {
    const { directory, passwords } = checker();
    const jane = await passwords.check('jsmith', 'jane-pw');
    expect(jane?.identity.userId).toBe(directory.guidOf('jsmith2'));
    expect(jane?.identity.userId).not.toBe(directory.guidOf('jsmith'));
    // …and John's own password under that name is refused (the explicit UPN wins).
    expect(await passwords.check('jsmith', 'john-pw')).toBeUndefined();
  });

  it('a case-variant name reaches the same objectGUID', async () => {
    const { passwords } = checker();
    const a = await passwords.check('alice', 'Quartz-River-41!');
    const b = await passwords.check('ALICE', 'Quartz-River-41!');
    expect(b?.identity.userId).toBe(a?.identity.userId);
  });

  it('an empty password NEVER reaches the directory (an unauthenticated bind can "succeed")', async () => {
    const { directory, passwords } = checker();
    expect(await passwords.check('alice', '')).toBeUndefined();
    expect(directory.binds).toEqual([]);
  });

  it('Who-am-I empty (anonymous), naming another domain, or a dn: form → refused', async () => {
    for (const fixed of ['', 'u:OTHER\\alice', 'dn:CN=alice,DC=corp,DC=example']) {
      const { directory, passwords } = checker();
      directory.whoAmIForm = { fixed };
      expect(await passwords.check('alice', 'Quartz-River-41!'), fixed).toBeUndefined();
    }
  });

  it('the SID form of Who-am-I finds the account by objectSid', async () => {
    const directory = fakeDirectory([
      { sam: 'sid-user', password: 'p', sid: 'S-1-5-21-11-22-33-1104' },
    ]);
    directory.whoAmIForm = 'sid';
    const passwords = directoryPasswords({
      directory,
      domain: 'corp.example',
      netbiosDomain: 'CORP',
      baseDn: 'DC=corp,DC=example',
    });
    expect((await passwords.check('sid-user', 'p'))?.identity.userId).toBe(
      directory.guidOf('sid-user'),
    );
  });

  it('two entries for the authenticated account → refused (exactly one, or nobody)', async () => {
    const { directory, passwords } = checker();
    directory.duplicate = 'alice';
    expect(await passwords.check('alice', 'Quartz-River-41!')).toBeUndefined();
  });

  it('the required group, nested; a group DN with parentheses is escaped', async () => {
    const group = 'CN=Neo Users (Prod),OU=G,DC=corp,DC=example';
    const { directory, passwords } = checker({ requiredGroup: group });
    directory.groups['CN=SAN-Ops,OU=G,DC=corp,DC=example'] = [group];
    expect(await passwords.check('alice', 'Quartz-River-41!')).toBeDefined();
    expect(directory.lastFilter).toContain('Neo Users \\28Prod\\29');
    expect(await passwords.check('bob', 'Maple-Stone-52!')).toBeUndefined();
  });

  it('a user@other.example name is refused before the bind; user@corp.example is the user', async () => {
    const { directory, passwords } = checker();
    expect(await passwords.check('alice@other.example', 'Quartz-River-41!')).toBeUndefined();
    expect(directory.binds).toEqual([]);
    expect(await passwords.check('alice@corp.example', 'Quartz-River-41!')).toBeDefined();
  });

  it('a directory that cannot be reached THROWS (503 at the door), never "wrong password"', async () => {
    const { directory, passwords } = checker();
    directory.down = true;
    // Unreachable: the password never left, so the door un-counts it (idI57 S-6).
    const err = await passwords.check('alice', 'Quartz-River-41!').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PasswordCheckUnreachableError);
    expect(String((err as Error).cause)).toMatch(/ECONNREFUSED/);
  });
});

// ─── 3. INTEGRATION — through the sign-in door ───────────────────────

describe('directory-password — integration', () => {
  it('through the door: one answer for every wrong credential; 503 when the directory is down', async () => {
    const { directory, passwords } = checker();
    const m = await mountDoor({ passwords });
    open.push(m);
    const unknown = await login(m.url, 'mallory', 'x');
    const wrong = await login(m.url, 'alice', 'x');
    const odd = await login(m.url, 'alice@other.example', 'x');
    expect(unknown.body).toEqual(wrong.body);
    expect(odd.body).toEqual(wrong.body);
    const right = await login(m.url, 'alice', 'Quartz-River-41!');
    expect(right.status).toBe(200);
    expect(right.body.displayName).toBe('Alice Archer');
    directory.down = true;
    expect((await login(m.url, 'bob', 'Maple-Stone-52!')).status).toBe(503);
    expect(
      (await call(m.url, '/auth/me', { headers: { cookie: right.cookie as string } })).status,
    ).toBe(200);
  });
});

// ─── 4. PROPERTY ─────────────────────────────────────────────────────

describe('directory-password — properties', () => {
  it('no typed name containing a filter or DN metacharacter ever reaches the directory', async () => {
    const { directory, passwords } = checker();
    const meta = ['*', '(', ')', '\\', ',', '=', '@x.example', '\u0000', '\n'];
    for (let i = 0; i < 200; i += 1) {
      const name = `al${meta[i % meta.length]}ice${i}`;
      await passwords.check(name, 'p');
    }
    expect(directory.binds).toEqual([]);
  });
});

// ─── 5. SECURITY ─────────────────────────────────────────────────────

describe('directory-password — security', () => {
  it('the password never appears in a bind NAME, a log line or a filter', async () => {
    const lines: string[] = [];
    const { directory, passwords } = checker({ log: (l) => lines.push(l) });
    directory.duplicate = 'alice';
    await passwords.check('alice', 'Quartz-River-41!');
    expect(JSON.stringify([...directory.binds, directory.lastFilter, ...lines])).not.toContain(
      'Quartz-River',
    );
  });
});

// ─── 6. PERFORMANCE ──────────────────────────────────────────────────

describe('directory-password — performance', () => {
  it('one connection, one bind, one Who-am-I and one search per sign-in (two with a group)', async () => {
    const { directory, passwords } = checker();
    await passwords.check('bob', 'Maple-Stone-52!');
    expect(directory.binds).toHaveLength(1);
  });
});

// ─── 7. ROI — from config ────────────────────────────────────────────

describe('directory-password — ROI', () => {
  it("from IDENTITY_* in production: limits come from AD's threshold; the banner states the MFA bypass", async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'af-ldap-'));
    writeFileSync(join(dir, 'ca.pem'), TEST_CA_PEM);
    const env = {
      IDENTITY_STRATEGY: 'directory-password',
      IDENTITY_PUBLIC_URL: 'https://neo.corp.example',
      IDENTITY_LDAP_URL: 'ldaps://dc1.corp.example:636',
      IDENTITY_LDAP_CA_FILE: join(dir, 'ca.pem'),
      IDENTITY_LDAP_DOMAIN: 'corp.example',
      IDENTITY_LDAP_NETBIOS_DOMAIN: 'CORP',
      IDENTITY_LDAP_BASE_DN: 'DC=corp,DC=example',
      IDENTITY_LDAP_LOCKOUT_THRESHOLD: '10',
      IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES: '30',
    };
    const choice = await identityFromConfig(identityConfigFromEnv(env), {
      production: true,
      crossSite: { allowedHosts: ['neo.corp.example'] },
    });
    expect(choice.strategy).toBe('directory-password');
    expect(choice.mode).toBe('password');
    const banner = choice.banner.join('\n');
    // A THIRD of AD's 10, per ACCOUNT, reset 30 min after the LAST failure (idI57 B-1/B-2/S-4).
    expect(banner).toMatch(/3 per account \(a third of AD's 10; alice, ALICE, CORP\\alice/);
    expect(banner).toMatch(/counter reset 30 min after the LAST failure/);
    expect(banner).toMatch(/separate UPN prefix has two budgets/);
    expect(banner).toMatch(/bypasses the company's MFA/);
    expect(choice.signInDoor?.cookieName).toBe('__Host-Http-af-signin');
    // Refusals: ldap://, a missing lockout key, an OIDC key beside it.
    await expect(
      identityFromConfig(identityConfigFromEnv({ ...env, IDENTITY_LDAP_URL: 'ldap://dc1:389' }), {
        production: true,
        crossSite: { allowedHosts: ['neo.corp.example'] },
      }),
    ).rejects.toMatchObject({ key: 'IDENTITY_LDAP_URL' });
    const { IDENTITY_LDAP_LOCKOUT_THRESHOLD: _t, ...noThreshold } = env;
    await expect(
      identityFromConfig(identityConfigFromEnv(noThreshold), { production: true }),
    ).rejects.toMatchObject({ key: 'IDENTITY_LDAP_LOCKOUT_THRESHOLD' });
    await expect(
      identityFromConfig(identityConfigFromEnv({ ...env, IDENTITY_ISSUER: 'https://x' }), {
        production: true,
      }),
    ).rejects.toMatchObject({ key: 'IDENTITY_ISSUER' });
    await expect(
      identityFromConfig(identityConfigFromEnv(env), { production: true }),
    ).rejects.toMatchObject({ key: undefined });
  });
});
