/**
 * The sign-in door's audit trail — `signInDoor({ onAudit, log })`.
 * 7-pattern tests (unit · scenario · integration · property · security ·
 * performance · ROI), mostly against a FAKE directory that answers with
 * Active Directory's own bind sub-codes.
 *
 * The laws being pinned:
 *   • ONE record per sign-in outcome — signed in, refused, limited,
 *     unavailable, signed out, expired — at the exit the door reached.
 *   • The same record goes to the typed sink AND, as one JSON line, to `log`
 *     (default `console.info`): an install has the trail with zero code.
 *   • The account is the checker's budget key: `user`, `DOMAIN\user` and
 *     `user@dns.domain` are all the sAMAccountName.
 *   • AD's sub-code AND its name ride the record; the person's answer is the
 *     same sentence whatever the sub-code.
 *   • The address is the one trusted-proxy resolution names; a forged
 *     `X-Forwarded-For` from an untrusted peer is not believed.
 *   • Never the password, the cookie, the sign-in key or a token.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  memorySignIns,
  signInAuditLine,
  SIGN_IN_AUDIT_PREFIX,
  WRONG_CREDENTIAL_SENTENCE,
  type PasswordChecker,
  type SignInAuditRecord,
} from '../../src/hosting/index.js';
import {
  adSubCodeName,
  directoryPasswords,
  identityConfigFromEnv,
  identityFromConfig,
  ldapDirectory,
} from '../../src/identity.js';
import { attemptLimiter } from '../../src/hosting/signin/limits.js';
import { intermediateCaSubjects } from '../../src/adapters/identity/directory/ldapDirectory.js';
import { fakeDirectory, type FakeAccount } from '../adapters/identity/conformance/fakeDirectory.js';
import {
  TEST_CA_PEM,
  TEST_INTERMEDIATE_CA_PEM,
} from '../adapters/identity/conformance/testCertificates.js';
import { call, login, mountDoor, type MountedDoor } from './signInDoorHarness.js';
import { browserSignIn, mountRedirect } from './signInRedirectHarness.js';

const GROUP = 'CN=Neo Users,OU=G,DC=corp,DC=example';
const ACCOUNTS: FakeAccount[] = [
  { sam: 'alice', password: 'Quartz-River-41!', displayName: 'Alice', memberOf: [GROUP] },
  { sam: 'bob', password: 'Maple-Stone-52!', memberOf: [GROUP] },
  { sam: 'carol', password: 'Cobalt-Harbor-63!', state: 'locked', memberOf: [GROUP] },
  { sam: 'dan', password: 'Dan-Disabled-1!', state: 'disabled', memberOf: [GROUP] },
  { sam: 'erin', password: 'Erin-Expired-2!', state: 'password-expired', memberOf: [GROUP] },
  { sam: 'fay', password: 'Fay-Change-3!', state: 'must-change', memberOf: [GROUP] },
  { sam: 'gus', password: 'Gus-Gone-4!', state: 'account-expired', memberOf: [GROUP] },
  { sam: 'hal', password: 'Hal-Outside-5!' },
];
const ALL_PASSWORDS = ACCOUNTS.map((a) => a.password);

function directoryChecker(extra: Partial<Parameters<typeof directoryPasswords>[0]> = {}) {
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

/** A door that collects its records and its log lines. */
async function auditedDoor(extra: Parameters<typeof mountDoor>[0] = {}) {
  const records: SignInAuditRecord[] = [];
  const lines: string[] = [];
  const m = await mountDoor({
    onAudit: (r) => records.push(r),
    log: (l) => lines.push(l),
    ...extra,
  });
  open.push(m);
  return { m, records, lines };
}

const open: MountedDoor[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// ─── 1. UNIT ─────────────────────────────────────────────────────────

describe('sign-in audit — unit', () => {
  it('the AD sub-code names: the six the checklist names, everything else unknown', () => {
    expect(
      ['52e', '775', '532', '773', '533', '701', '525', '530', '531', 'abc'].map(adSubCodeName),
    ).toEqual([
      'bad-password',
      'locked',
      'password-expired',
      'must-change',
      'disabled',
      'account-expired',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(adSubCodeName('52E')).toBe('bad-password');
    expect(adSubCodeName('toString')).toBe('unknown'); // no prototype key is a name
  });

  it('the log line: the prefix, then the record as JSON with an ISO time in place of `at`', () => {
    const line = signInAuditLine({
      at: Date.UTC(2026, 9, 1, 8, 30),
      outcome: 'refused',
      reason: 'wrong-credential',
      strategy: 'directory-password',
      account: 'ali"ce',
      address: '10.0.0.7',
      adSubCode: '52e',
      adSubCodeName: 'bad-password',
    });
    expect(line.startsWith(`${SIGN_IN_AUDIT_PREFIX} {`)).toBe(true);
    const parsed = JSON.parse(line.slice(SIGN_IN_AUDIT_PREFIX.length + 1)) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({
      time: '2026-10-01T08:30:00.000Z',
      outcome: 'refused',
      reason: 'wrong-credential',
      strategy: 'directory-password',
      account: 'ali"ce', // a quote cannot forge a field
      address: '10.0.0.7',
      adSubCode: '52e',
      adSubCodeName: 'bad-password',
    });
  });

  it('the limiter names WHICH rule refused, and the hard address budget is OFF by default', () => {
    const limiter = attemptLimiter({ perName: 2, backoffMs: 0 });
    const t = (name: string) => {
      const v = limiter.begin(name, '10.0.0.1', 0);
      if (v.kind === 'allow') limiter.failed(v.ticket, 0);
      return v;
    };
    // 40 failures from one address over 20 names: delayed, never refused.
    for (let i = 0; i < 20; i += 1) {
      expect(t(`n${i}`).kind).toBe('allow');
      expect(t(`n${i}`).kind).toBe('allow');
    }
    expect(t('n0')).toMatchObject({ kind: 'refuse', why: 'name-budget' });
    const v = limiter.begin('busy', '10.0.0.2', 0);
    expect(limiter.begin('busy', '10.0.0.2', 0)).toMatchObject({
      kind: 'refuse',
      why: 'name-in-flight',
    });
    if (v.kind === 'allow') limiter.succeeded(v.ticket);
  });

  it('opt-in refuseAddressAfter: refused after N failures, a right password is no strike, bounded by one window', () => {
    const limiter = attemptLimiter({ perName: 100, refuseAddressAfter: 3, windowMinutes: 15 });
    const at = (name: string, now: number, right = false) => {
      const v = limiter.begin(name, '203.0.113.9', now);
      if (v.kind === 'allow') {
        if (right) limiter.succeeded(v.ticket);
        else limiter.failed(v.ticket, now);
      }
      return v;
    };
    expect(at('a', 0, true).kind).toBe('allow'); // a success is not counted
    expect(at('b', 1).kind).toBe('allow');
    expect(at('c', 2).kind).toBe('allow');
    expect(at('d', 3).kind).toBe('allow');
    const refused = at('e', 4);
    expect(refused).toMatchObject({ kind: 'refuse', why: 'address-budget' });
    // Another address is untouched; this one is back a full window after its LAST counted attempt.
    expect(limiter.begin('e', '198.51.100.1', 5).kind).toBe('allow');
    expect(at('f', 3 + 15 * 60_000).kind).toBe('allow');
    expect(() => attemptLimiter({ refuseAddressAfter: 0 })).toThrow(/whole number above 0/);
    expect(() => attemptLimiter({ refuseAddressAfter: 2.5 })).toThrow(/whole number above 0/);
  });

  it('ldapDirectory: the sub-code from an LDAP 49 error, and the bind is sent ONCE — never retried', async () => {
    let binds = 0;
    let failWith: Error = new Error('x');
    class Client {
      async bind() {
        binds += 1;
        throw failWith;
      }
      async exop() {
        return {};
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
    failWith = Object.assign(
      new Error(
        '80090308: LdapErr: DSID-0C0903A9, comment: AcceptSecurityContext error, data 775, v1db1',
      ),
      { code: 49 },
    );
    expect(await (await directory.open()).bind('carol@corp.example', 'x')).toEqual({
      kind: 'invalid',
      adSubCode: '775',
    });
    failWith = Object.assign(new Error('Invalid credentials'), { code: 49 });
    expect(await (await directory.open()).bind('carol@corp.example', 'x')).toBe('invalid');
    expect(binds).toBe(2); // one per session, whatever the answer
  });

  it('ldapDirectory systemCa: Node’s default store (no `ca`), the host-name check on, 5 s timeouts; never both, never neither', async () => {
    const seen: Record<string, unknown>[] = [];
    class Client {
      constructor(options: Record<string, unknown>) {
        seen.push(options);
      }
      async unbind() {}
    }
    const directory = ldapDirectory({
      url: 'ldaps://ad.corp.example:636',
      systemCa: true,
      backend: { Client } as never,
    });
    await (await directory.open()).close();
    const tls = seen[0]?.tlsOptions as Record<string, unknown>;
    expect('ca' in tls).toBe(false);
    expect(tls.rejectUnauthorized).toBe(true);
    expect(tls.checkServerIdentity).toBeUndefined();
    expect(seen[0]?.connectTimeout).toBe(5_000);
    expect(seen[0]?.timeout).toBe(5_000);
    expect(() =>
      ldapDirectory({ url: 'ldaps://ad:636', systemCa: true, caPem: TEST_CA_PEM }),
    ).toThrow(/not both/);
    expect(() => ldapDirectory({ url: 'ldaps://ad:636' })).toThrow(/PEM CA certificate/);
    expect(() => ldapDirectory({ url: 'ldaps://ad:636', systemCa: false as never })).toThrow(
      /systemCa is true/,
    );
  });

  it('ldapDirectory: an unreachable directory is logged by the TLS error CODE, never its text', async () => {
    class Client {
      async bind() {
        throw Object.assign(new Error('self-signed certificate in certificate chain: CN=x'), {
          code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        });
      }
      async unbind() {}
    }
    const lines: string[] = [];
    const directory = ldapDirectory({
      url: 'ldaps://dc1.corp.example:636',
      systemCa: true,
      backend: { Client } as never,
      log: (l) => lines.push(l),
    });
    await (await directory.open()).bind('alice@corp.example', 'pw').catch(() => undefined);
    expect(lines).toEqual([
      '[identity] directory unreachable (no TLS connection opened: UNABLE_TO_VERIFY_LEAF_SIGNATURE)',
    ]);
  });

  it('an intermediate CA is named; a self-signed root is not', () => {
    expect(intermediateCaSubjects(TEST_CA_PEM)).toEqual([]);
    expect(intermediateCaSubjects(TEST_INTERMEDIATE_CA_PEM)).toEqual(['CN=Test Issuing CA']);
    expect(intermediateCaSubjects(`${TEST_CA_PEM}\n${TEST_INTERMEDIATE_CA_PEM}`)).toEqual([
      'CN=Test Issuing CA',
    ]);
  });
});

// ─── 2. SCENARIO — every outcome ─────────────────────────────────────

describe('sign-in audit — every outcome on directory-password', () => {
  it('signed-in: the account, the PROVED id, the address, the strategy — and no sub-code', async () => {
    const { directory, passwords } = directoryChecker();
    const { m, records } = await auditedDoor({ passwords });
    expect((await login(m.url, 'CORP\\Alice', 'Quartz-River-41!')).status).toBe(200);
    expect(records).toEqual([
      {
        at: expect.any(Number),
        outcome: 'signed-in',
        reason: 'accepted',
        strategy: 'directory-password',
        account: 'alice',
        userId: directory.guidOf('alice'),
        address: '127.0.0.1',
      },
    ]);
  });

  it('refused: AD sub-codes 52e 775 533 532 773 701 525 are named — and the person reads one sentence', async () => {
    const { passwords } = directoryChecker();
    const { m, records } = await auditedDoor({ passwords });
    const tries: [string, string, string, string][] = [
      ['alice', 'wrong', '52e', 'bad-password'],
      ['carol@corp.example', 'Cobalt-Harbor-63!', '775', 'locked'],
      ['CORP\\dan', 'Dan-Disabled-1!', '533', 'disabled'],
      ['erin', 'Erin-Expired-2!', '532', 'password-expired'],
      ['fay', 'Fay-Change-3!', '773', 'must-change'],
      ['gus', 'Gus-Gone-4!', '701', 'account-expired'],
      ['mallory', 'whatever', '525', 'unknown'],
    ];
    for (const [name, password] of tries) {
      const answer = await login(m.url, name, password);
      expect(answer.status).toBe(401);
      expect(answer.body).toEqual({ error: WRONG_CREDENTIAL_SENTENCE });
    }
    expect(
      records.map((r) => [r.account, r.outcome, r.reason, r.adSubCode, r.adSubCodeName]),
    ).toEqual([
      ['alice', 'refused', 'wrong-credential', '52e', 'bad-password'],
      ['carol', 'refused', 'wrong-credential', '775', 'locked'],
      ['dan', 'refused', 'wrong-credential', '533', 'disabled'],
      ['erin', 'refused', 'wrong-credential', '532', 'password-expired'],
      ['fay', 'refused', 'wrong-credential', '773', 'must-change'],
      ['gus', 'refused', 'wrong-credential', '701', 'account-expired'],
      ['mallory', 'refused', 'wrong-credential', '525', 'unknown'],
    ]);
    expect(records.every((r) => r.userId === undefined)).toBe(true);
  });

  it('refused before AD: an empty password, a foreign domain, a missing group, an unresolved account', async () => {
    const { directory, passwords } = directoryChecker({ requiredGroup: GROUP });
    const { m, records } = await auditedDoor({ passwords });
    expect((await login(m.url, 'alice', '')).status).toBe(400);
    expect((await login(m.url, 'alice@other.example', 'x')).status).toBe(401);
    expect(directory.binds).toEqual([]); // neither reached the directory
    expect((await login(m.url, 'hal', 'Hal-Outside-5!')).status).toBe(401);
    directory.whoAmIForm = { fixed: 'u:OTHER\\bob' };
    expect((await login(m.url, 'bob', 'Maple-Stone-52!')).status).toBe(401);
    expect(records.map((r) => [r.account, r.reason])).toEqual([
      ['alice', 'malformed-request'],
      ['alice', 'name-refused'],
      ['hal', 'not-in-group'],
      ['bob', 'account-unresolved'],
    ]);
    expect(records.every((r) => r.outcome === 'refused')).toBe(true);
  });

  it('limited: the account budget refuses WITHOUT contacting AD — for an account AD never locks too', async () => {
    const { directory, passwords } = directoryChecker();
    const { m, records } = await auditedDoor({ passwords, limits: { perName: 3, backoffMs: 0 } });
    // The fake directory never locks anybody (a group with no lockout policy).
    for (const spelling of ['bob', 'BOB', 'CORP\\bob', 'bob@corp.example', 'bob']) {
      await login(m.url, spelling, 'wrong');
    }
    expect(directory.binds).toHaveLength(3);
    expect(records.map((r) => [r.outcome, r.reason, r.account])).toEqual([
      ['refused', 'wrong-credential', 'bob'],
      ['refused', 'wrong-credential', 'bob'],
      ['refused', 'wrong-credential', 'bob'],
      ['limited', 'name-budget', 'bob'],
      ['limited', 'name-budget', 'bob'],
    ]);
  });

  it('limited: a second check for an account in flight; the opt-in address budget', async () => {
    let release: () => void = () => undefined;
    const slow: PasswordChecker = {
      strategy: 'slow',
      check: () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
    };
    const a = await auditedDoor({ passwords: slow });
    const first = login(a.m.url, 'alice', 'x');
    await new Promise((r) => setTimeout(r, 50));
    expect((await login(a.m.url, 'alice', 'y')).status).toBe(429);
    release();
    await first;
    expect(a.records.map((r) => r.reason)).toEqual(['name-in-flight', 'wrong-credential']);

    const { directory, passwords } = directoryChecker();
    const b = await auditedDoor({
      passwords,
      limits: { perName: 100, refuseAddressAfter: 2, backoffMs: 0 },
    });
    await login(b.m.url, 'alice', 'wrong');
    await login(b.m.url, 'bob', 'wrong');
    expect((await login(b.m.url, 'erin', 'wrong')).status).toBe(429);
    expect(directory.binds).toHaveLength(2);
    expect(b.records.map((r) => [r.outcome, r.reason])).toEqual([
      ['refused', 'wrong-credential'],
      ['refused', 'wrong-credential'],
      ['limited', 'address-budget'],
    ]);
  });

  it('unavailable: unreachable, failed after it was sent, checks full, counters full, store down', async () => {
    const { directory, passwords } = directoryChecker();
    const a = await auditedDoor({ passwords });
    directory.down = true;
    expect((await login(a.m.url, 'alice', 'Quartz-River-41!')).status).toBe(503);
    directory.down = false;
    directory.bindTimesOut = true;
    expect((await login(a.m.url, 'bob', 'Maple-Stone-52!')).status).toBe(503);
    expect(a.records.map((r) => [r.outcome, r.reason, r.account])).toEqual([
      ['unavailable', 'backend-unreachable', 'alice'],
      ['unavailable', 'check-failed', 'bob'],
    ]);

    let release: () => void = () => undefined;
    const slow: PasswordChecker = {
      strategy: 'slow',
      check: () => new Promise((resolve) => (release = () => resolve(undefined))),
    };
    const b = await auditedDoor({ passwords: slow, checks: { concurrent: 1, queue: 0 } });
    const first = login(b.m.url, 'alice', 'x');
    await new Promise((r) => setTimeout(r, 50));
    expect((await login(b.m.url, 'bob', 'y')).status).toBe(503);
    release();
    await first;
    expect(b.records.map((r) => r.reason)).toEqual(['checks-busy', 'wrong-credential']);

    const c = await auditedDoor({
      passwords: directoryChecker().passwords,
      limits: { maxEntries: 1, backoffMs: 0 },
    });
    await login(c.m.url, 'alice', 'wrong'); // one penalising counter fills the map
    expect((await login(c.m.url, 'bob', 'wrong')).status).toBe(503);
    expect(c.records.map((r) => r.reason)).toEqual(['wrong-credential', 'limits-full']);

    const store = memorySignIns({ warn: () => undefined });
    const d = await auditedDoor({
      passwords: directoryChecker().passwords,
      store: {
        ...store,
        create: async () => {
          throw new Error('disk full');
        },
      },
    });
    expect((await login(d.m.url, 'alice', 'Quartz-River-41!')).status).toBe(503);
    expect(d.records.map((r) => [r.outcome, r.reason, r.userId])).toEqual([
      ['unavailable', 'store-failed', undefined],
    ]);
  });

  it('refused at the guard: a cross-site login is recorded (no body read, so no account)', async () => {
    const { passwords } = directoryChecker();
    const { m, records } = await auditedDoor({ passwords });
    const forged = await call(m.url, '/auth/login', {
      ...json({ username: 'alice', password: 'Quartz-River-41!' }),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(forged.status).toBe(403);
    const form = await call(m.url, '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=alice&password=x',
    });
    expect(form.status).toBe(415);
    expect(records).toEqual([
      expect.objectContaining({ outcome: 'refused', reason: 'cross-site', address: '127.0.0.1' }),
      expect.objectContaining({ outcome: 'refused', reason: 'cross-site' }),
    ]);
    expect(records.every((r) => r.account === undefined)).toBe(true);
    // `/auth/me` refused at the guard is not a sign-in attempt.
    await call(m.url, '/auth/me', { headers: { origin: 'https://evil.example' } });
    expect(records).toHaveLength(2);
  });

  it('signed-out and expired (idle, lifetime): the ending is on the record too', async () => {
    let clock = Date.now();
    const { directory, passwords } = directoryChecker();
    const { m, records } = await auditedDoor({ passwords, now: () => clock });
    const one = await login(m.url, 'alice', 'Quartz-River-41!');
    await call(m.url, '/auth/logout', {
      method: 'POST',
      headers: { cookie: one.cookie as string, 'content-type': 'application/json' },
    });
    // A stale cookie's logout ends nothing anybody could still use: not recorded.
    await call(m.url, '/auth/logout', {
      method: 'POST',
      headers: { cookie: one.cookie as string, 'content-type': 'application/json' },
    });
    const two = await login(m.url, 'alice', 'Quartz-River-41!');
    clock += 61 * 60_000; // past the 60-minute idle limit
    expect(
      (await call(m.url, '/auth/me', { headers: { cookie: two.cookie as string } })).status,
    ).toBe(401);
    const three = await login(m.url, 'bob', 'Maple-Stone-52!');
    for (let i = 0; i < 9; i += 1) {
      clock += 59 * 60_000;
      await call(m.url, '/auth/me', { headers: { cookie: three.cookie as string } });
    }
    const guid = directory.guidOf('alice');
    expect(records.map((r) => [r.outcome, r.reason, r.userId])).toEqual([
      ['signed-in', 'accepted', guid],
      ['signed-out', 'logout', guid],
      ['signed-in', 'accepted', guid],
      ['expired', 'idle', guid],
      ['signed-in', 'accepted', directory.guidOf('bob')],
      ['expired', 'lifetime', directory.guidOf('bob')],
    ]);
    const ended = records.filter((r) => r.outcome === 'expired');
    expect(ended.every((r) => r.address === undefined && r.strategy === 'directory-password')).toBe(
      true,
    );
  });
});

describe('sign-in audit — one end, one record', () => {
  it('two requests racing on one stale cookie file ONE expired; a double-clicked sign-out files ONE signed-out', async () => {
    let clock = Date.now();
    const { passwords } = directoryChecker();
    // A slow lookup (a remote store): every racing request reads the row
    // before any of them has deleted it — the race, made certain.
    const inner = memorySignIns({ warn: () => undefined });
    const store = {
      ...inner,
      find: async (key: string) => {
        const row = await inner.find(key);
        await new Promise((r) => setTimeout(r, 40));
        return row;
      },
    };
    const { m, records } = await auditedDoor({ passwords, now: () => clock, store });
    const a = await login(m.url, 'alice', 'Quartz-River-41!');
    clock += 61 * 60_000;
    await Promise.all(
      [1, 2, 3].map(() => call(m.url, '/auth/me', { headers: { cookie: a.cookie as string } })),
    );
    const b = await login(m.url, 'bob', 'Maple-Stone-52!');
    const out = {
      method: 'POST',
      headers: { cookie: b.cookie as string, 'content-type': 'application/json' },
    };
    await Promise.all([call(m.url, '/auth/logout', out), call(m.url, '/auth/logout', out)]);
    expect(records.map((r) => [r.outcome, r.reason])).toEqual([
      ['signed-in', 'accepted'],
      ['expired', 'idle'],
      ['signed-in', 'accepted'],
      ['signed-out', 'logout'],
    ]);
  });
});

// ─── 3. INTEGRATION — every strategy, and from config ────────────────

describe('sign-in audit — integration', () => {
  it('local-password: an unknown name and a wrong password are told apart on the record only', async () => {
    const { m, records } = await auditedDoor();
    const unknown = await login(m.url, 'mallory', 'x');
    const wrong = await login(m.url, 'alice', 'x');
    expect(unknown.body).toEqual(wrong.body);
    await login(m.url, 'alice', 'alice-pw');
    expect(records.map((r) => [r.strategy, r.outcome, r.reason, r.account, r.userId])).toEqual([
      ['local-password', 'refused', 'unknown-account', 'mallory', undefined],
      ['local-password', 'refused', 'wrong-credential', 'alice', undefined],
      ['local-password', 'signed-in', 'accepted', 'alice', 'alice'],
    ]);
  });

  it('redirect sign-in: the callback is recorded — signed in, and a forged callback refused', async () => {
    const records: SignInAuditRecord[] = [];
    const app = await mountRedirect({
      door: { onAudit: (r) => records.push(r), log: () => undefined },
    });
    try {
      const ok = await browserSignIn(app, 'alice');
      expect(ok.status).toBe(303);
      const forged = await browserSignIn(app, 'bob', { otherBrowser: true });
      expect(forged.location).toMatch(/signin_error=state/);
      expect(records.map((r) => [r.outcome, r.reason, r.strategy])).toEqual([
        ['signed-in', 'accepted', 'oidc-token'],
        ['refused', 'state-mismatch', 'oidc-token'],
      ]);
      expect(records[0]?.userId).toEqual(expect.any(String));
      expect(records[0]?.account).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('from IDENTITY_*: onSignInAudit and signInLog reach the door; CA_FILE=system; the address opt-in; the banner', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'af-audit-'));
    writeFileSync(join(dir, 'int.pem'), TEST_INTERMEDIATE_CA_PEM);
    const tlsSeen: Record<string, unknown>[] = [];
    class Client {
      constructor(options: Record<string, unknown>) {
        tlsSeen.push(options.tlsOptions as Record<string, unknown>);
      }
      async bind() {
        throw Object.assign(new Error('AcceptSecurityContext error, data 52e, v1db1'), {
          code: 49,
        });
      }
      async unbind() {}
    }
    const env = {
      IDENTITY_STRATEGY: 'directory-password',
      IDENTITY_PUBLIC_URL: 'https://neo.corp.example',
      IDENTITY_LDAP_URL: 'ldaps://ad.corp.example:636',
      IDENTITY_LDAP_CA_FILE: 'system',
      IDENTITY_LDAP_DOMAIN: 'corp.example',
      IDENTITY_LDAP_NETBIOS_DOMAIN: 'CORP',
      IDENTITY_LDAP_BASE_DN: 'DC=corp,DC=example',
      IDENTITY_LDAP_LOCKOUT_THRESHOLD: '10',
      IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES: '15',
      IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER: '20',
    };
    const boot = { production: true, crossSite: { allowedHosts: ['neo.corp.example'] } };
    const records: SignInAuditRecord[] = [];
    const lines: string[] = [];
    const choice = await identityFromConfig(identityConfigFromEnv(env), {
      ...boot,
      ldapts: { Client } as never,
      onSignInAudit: (r) => records.push(r),
      signInLog: (l) => lines.push(l),
    });
    const banner = choice.banner.join('\n');
    expect(banner).toMatch(/LDAPS trust = Node's default CA store \(public roots/);
    expect(banner).toMatch(/WARNING no IDENTITY_LDAP_REQUIRED_GROUP/);
    expect(banner).toMatch(/REFUSED after 20 failed sign-ins/);
    expect(banner).toMatch(/3 per account \(a third of AD's 10/);

    const { createServer, request } = await import('node:http');
    const server = createServer((req, res) => void choice.signInDoor?.handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      // The public name in Host, as the company's load balancer would send it.
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/auth/login',
            method: 'POST',
            headers: { 'content-type': 'application/json', host: 'neo.corp.example' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify({ username: 'alice@corp.example', password: 'wrong' }));
      });
      expect(status).toBe(401);
    } finally {
      await new Promise((r) => server.close(r));
    }
    expect('ca' in (tlsSeen[0] ?? { ca: 1 })).toBe(false);
    expect(records).toEqual([
      expect.objectContaining({
        account: 'alice',
        adSubCode: '52e',
        adSubCodeName: 'bad-password',
      }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"adSubCodeName":"bad-password"');

    // An intermediate in the CA file boots with a warning; 0 for the opt-in is refused by name.
    const withFile = await identityFromConfig(
      identityConfigFromEnv({
        ...env,
        IDENTITY_LDAP_CA_FILE: join(dir, 'int.pem'),
        IDENTITY_LDAP_REQUIRED_GROUP: GROUP,
      }),
      { ...boot, ldapts: { Client } as never },
    );
    const fileBanner = withFile.banner.join('\n');
    expect(fileBanner).toMatch(/INTERMEDIATE CA \(CN=Test Issuing CA\)\. Trust the ROOT/);
    expect(fileBanner).not.toMatch(/no IDENTITY_LDAP_REQUIRED_GROUP/);
    await expect(
      identityFromConfig(
        identityConfigFromEnv({ ...env, IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER: '0' }),
        boot,
      ),
    ).rejects.toMatchObject({ key: 'IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER' });
    // Unset is NEVER the system store: the key is still required.
    const { IDENTITY_LDAP_CA_FILE: _drop, ...noCa } = env;
    await expect(identityFromConfig(identityConfigFromEnv(noCa), boot)).rejects.toMatchObject({
      key: 'IDENTITY_LDAP_CA_FILE',
    });
  });
});

// ─── 4. PROPERTY — no secret in any field ────────────────────────────

/** A small seeded generator (fast-check is not a dependency of this repo). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sign-in audit — properties', () => {
  it('for 150 random attempts over every outcome, no record and no line holds the password, the cookie or the key', async () => {
    const random = rng(20261001);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%&*+-=?@^_~';
    const secret = () =>
      `${Array.from({ length: 12 + Math.floor(random() * 20) }, () =>
        alphabet.charAt(Math.floor(random() * alphabet.length)),
      ).join('')}`;
    const { directory, passwords } = directoryChecker({ requiredGroup: GROUP });
    const { m, records, lines } = await auditedDoor({
      passwords,
      limits: { perName: 4, backoffMs: 0 },
    });
    const typed: string[] = [];
    const cookies: string[] = [];
    const names = ['alice', 'CORP\\bob', 'carol@corp.example', 'dan', 'hal', 'mallory', 'x(y)'];
    for (let i = 0; i < 150; i += 1) {
      const pick = random();
      directory.down = pick < 0.05;
      directory.bindTimesOut = pick >= 0.05 && pick < 0.1;
      const account = ACCOUNTS[Math.floor(random() * ACCOUNTS.length)] as FakeAccount;
      const right = random() < 0.3;
      const name = right ? account.sam : (names[i % names.length] as string);
      const password = right ? account.password : secret();
      if (!right) typed.push(password);
      const answer = await login(m.url, name, password);
      if (answer.cookie !== undefined) cookies.push(answer.cookie.split('=')[1] as string);
    }
    expect(records.length).toBe(150); // one per attempt, every outcome included
    expect(new Set(records.map((r) => r.outcome))).toEqual(
      new Set(['signed-in', 'refused', 'limited', 'unavailable']),
    );
    const everything = JSON.stringify(records) + lines.join('\n');
    for (const s of [...typed, ...ALL_PASSWORDS, ...cookies]) {
      expect(everything.includes(s), 'a secret reached the audit trail').toBe(false);
    }
    // Neither the sign-in KEY (the cookie's SHA-256) nor any token is a field.
    const fields = new Set(records.flatMap((r) => Object.keys(r)));
    for (const f of fields) {
      expect([
        'at',
        'outcome',
        'reason',
        'strategy',
        'account',
        'userId',
        'address',
        'adSubCode',
        'adSubCodeName',
      ]).toContain(f);
    }
  });

  it('user, DOMAIN\\user and user@dns.domain — in any case — are always ONE account on the record', async () => {
    const random = rng(7);
    const { passwords } = directoryChecker();
    const { m, records } = await auditedDoor({
      passwords,
      limits: { perName: 1000, backoffMs: 0 },
    });
    for (let i = 0; i < 30; i += 1) {
      const sam = ['alice', 'bob', 'erin'][i % 3] as string;
      const cased = [...sam].map((c) => (random() < 0.5 ? c.toUpperCase() : c)).join('');
      const form = [cased, `CORP\\${cased}`, `${cased}@corp.example`, `corp\\${cased}`][i % 4];
      await login(m.url, form as string, 'wrong');
      expect(records.at(-1)?.account).toBe(sam);
    }
  });
});

// ─── 5. SECURITY ─────────────────────────────────────────────────────

describe('sign-in audit — security', () => {
  it('the address behind trusted proxies is the client hop; a forged X-Forwarded-For from anybody else is ignored', async () => {
    const { passwords } = directoryChecker();
    const behind = await auditedDoor({ passwords, trustedProxies: ['127.0.0.1', '10.0.0.0/8'] });
    await login(behind.m.url, 'alice', 'wrong', {
      'x-forwarded-for': '198.51.100.4, 203.0.113.9, 10.1.2.3',
    });
    await login(behind.m.url, 'alice', 'Quartz-River-41!', {
      'x-forwarded-for': '[2001:db8::7]:5555',
    });
    expect(behind.records.map((r) => r.address)).toEqual(['203.0.113.9', '2001:db8::7']);

    const direct = await auditedDoor({ passwords, warn: () => undefined });
    await login(direct.m.url, 'bob', 'wrong', { 'x-forwarded-for': '203.0.113.66' });
    expect(direct.records[0]?.address).toBe('127.0.0.1');
  });

  it('a sink or a log that throws never changes a sign-in, and is reported once', async () => {
    const warnings: string[] = [];
    const m = await mountDoor({
      passwords: directoryChecker().passwords,
      onAudit: () => {
        throw new TypeError('sink down');
      },
      log: () => {
        throw new RangeError('log down');
      },
      warn: (w) => warnings.push(w),
    });
    open.push(m);
    expect((await login(m.url, 'alice', 'Quartz-River-41!')).status).toBe(200);
    expect((await login(m.url, 'bob', 'wrong')).status).toBe(401);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/onAudit sink threw.*TypeError/);
    expect(warnings[0]).not.toMatch(/sink down/); // never the error's message
  });

  it('a checker note is copied down to the vocabulary: no extra field, no free text', async () => {
    const chatty: PasswordChecker = {
      strategy: 'chatty',
      check: async (_n, password, note) => {
        note?.({
          reason: 'not-a-reason' as never,
          adSubCode: `52e ${password}`,
          adSubCodeName: 'whatever' as never,
          extra: password,
        } as never);
        return undefined;
      },
    };
    const { m, records } = await auditedDoor({ passwords: chatty });
    await login(m.url, 'alice', 'S3cret-typed-here');
    expect(records[0]).toEqual({
      at: expect.any(Number),
      outcome: 'refused',
      reason: 'wrong-credential',
      strategy: 'chatty',
      account: 'alice',
      address: '127.0.0.1',
    });
  });
});

describe('sign-in audit — security (review)', () => {
  it('a note whose getters answer a word to the test and the password to a second read: only the word travels', async () => {
    const sly: PasswordChecker = {
      strategy: 'sly',
      check: async (_n, password, note) => {
        const reads = { reason: 0, code: 0, name: 0 };
        note?.({
          get reason() {
            return (reads.reason++ === 0 ? 'not-in-group' : `x ${password}`) as never;
          },
          get adSubCode() {
            return (reads.code++ === 0 ? '775' : `775 ${password}`) as never;
          },
          get adSubCodeName() {
            return (reads.name++ === 0 ? 'locked' : `n ${password}`) as never;
          },
        });
        return undefined;
      },
    };
    const { m, records, lines } = await auditedDoor({ passwords: sly });
    await login(m.url, 'alice', 'S3cret-typed-here');
    expect(records[0]).toMatchObject({
      reason: 'not-in-group',
      adSubCode: '775',
      adSubCodeName: 'locked',
    });
    expect(JSON.stringify(records) + lines.join('\n')).not.toContain('S3cret-typed-here');
  });

  it('U+2028, U+2029 and bidi controls in a name are escaped on the line, which parses back to the record', () => {
    const account = 'eve\u2028[identity] sign-in {}\u2029\u202eecila\u2066';
    const line = signInAuditLine({
      at: 0,
      outcome: 'refused',
      reason: 'wrong-credential',
      strategy: 'local-password',
      account,
    });
    expect(/[\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(line)).toBe(false);
    expect(JSON.parse(line.slice(SIGN_IN_AUDIT_PREFIX.length + 1)).account).toBe(account);
  });

  it('a malformed body names its account only when the name is plain: no control character, at most 256', async () => {
    const { m, records } = await auditedDoor();
    await call(m.url, '/auth/login', json({ username: 'ann\u0007', password: '' }));
    await call(m.url, '/auth/login', json({ username: 'b'.repeat(257), password: '' }));
    await call(m.url, '/auth/login', json({ username: 'cat', password: '' }));
    expect(records.map((r) => [r.reason, r.account])).toEqual([
      ['malformed-request', undefined],
      ['malformed-request', undefined],
      ['malformed-request', 'cat'],
    ]);
  });

  it('a sign-out with a cookie past its IDLE limit is not a sign-out on the record', async () => {
    let clock = Date.now();
    const { passwords } = directoryChecker();
    const { m, records } = await auditedDoor({ passwords, now: () => clock });
    const one = await login(m.url, 'alice', 'Quartz-River-41!');
    clock += 61 * 60_000; // idle-dead, lifetime still running
    await call(m.url, '/auth/logout', {
      method: 'POST',
      headers: { cookie: one.cookie as string, 'content-type': 'application/json' },
    });
    expect(records.map((r) => r.outcome)).toEqual(['signed-in']);
  });

  it('a JS directory session answering null or a number sub-code is a refusal (401), as before the sub-code', async () => {
    const base = fakeDirectory(ACCOUNTS);
    for (const answer of [null, { kind: 'invalid', adSubCode: 775 }, false]) {
      const passwords = directoryPasswords({
        directory: {
          open: async () => {
            const session = await base.open();
            return {
              bind: async () => answer as never,
              whoAmI: () => session.whoAmI(),
              search: (b, f, sc) => session.search(b, f, sc),
              close: () => session.close(),
            };
          },
        },
        domain: 'corp.example',
        netbiosDomain: 'CORP',
        baseDn: 'DC=corp,DC=example',
      });
      const { m, records } = await auditedDoor({ passwords });
      expect((await login(m.url, 'alice', 'wrong')).status).toBe(401);
      expect(records[0]).toMatchObject({ outcome: 'refused', reason: 'wrong-credential' });
      expect(records[0]?.adSubCode).toBeUndefined();
    }
  });
});

// ─── 6. PERFORMANCE ──────────────────────────────────────────────────

describe('sign-in audit — performance', () => {
  it('exactly one record and one line per attempt; the trail adds no directory call', async () => {
    const { directory, passwords } = directoryChecker();
    const { m, records, lines } = await auditedDoor({
      passwords,
      limits: { perName: 1000, backoffMs: 0 },
    });
    const started = performance.now();
    for (let i = 0; i < 40; i += 1) await login(m.url, i % 2 === 0 ? 'alice' : 'bob', 'wrong');
    expect(records).toHaveLength(40);
    expect(lines).toHaveLength(40);
    expect(directory.binds).toHaveLength(40);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

// ─── 7. ROI — zero code: the default log line ────────────────────────

describe('sign-in audit — ROI', () => {
  it('with no onAudit and no log, every outcome is one console.info line an operator can parse', async () => {
    const seen: string[] = [];
    const original = console.info;
    console.info = (line: unknown) => void seen.push(String(line));
    try {
      const m = await mountDoor({ passwords: directoryChecker().passwords });
      open.push(m);
      await login(m.url, 'carol', 'Cobalt-Harbor-63!');
      await login(m.url, 'alice', 'Quartz-River-41!');
    } finally {
      console.info = original;
    }
    const parsed = seen
      .filter((l) => l.startsWith(SIGN_IN_AUDIT_PREFIX))
      .map((l) => JSON.parse(l.slice(SIGN_IN_AUDIT_PREFIX.length + 1)) as Record<string, string>);
    expect(parsed.map((p) => [p.outcome, p.account, p.adSubCodeName, p.address])).toEqual([
      ['refused', 'carol', 'locked', '127.0.0.1'],
      ['signed-in', 'alice', undefined, '127.0.0.1'],
    ]);
    expect(parsed.every((p) => !Number.isNaN(Date.parse(p.time as string)))).toBe(true);
  });
});
