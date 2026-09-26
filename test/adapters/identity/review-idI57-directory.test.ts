/**
 * Review idI57 — the directory-password findings, ported INVERTED: every
 * `FINDING` of the review's battery is now a pin of the fix.
 *
 *   B-1  the budget is kept per ACCOUNT (the checker's key), not per spelling
 *   B-2  the counter resets a full window after the LAST failure (AD's rule)
 *   S-4  a third of AD's threshold; 1 or 2 refused unless overridden
 *   S-6  a bind that timed out after it was sent stays counted
 *   N-7  a control character in a password never reaches a directory
 *   N-8  the SID form carries the objectClass guard
 *   N-9  `<NETBIOS>\name` is accepted when it is ours
 *   N-10 a CA file must hold a CA; the base DN must parse
 *   D12  a 15-byte objectGUID is refused
 *
 * The fake directory applies AD's LOCKOUT semantics: badPwdCount per ACCOUNT
 * (case-insensitive, `<name>` = `<name>@<domain>` = `CORP\<name>`, and a UPN
 * prefix that differs from the sAMAccountName is a second logon name of the
 * SAME account), reset only a full window after the LAST bad password, locked
 * at the threshold.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  memorySignIns,
  nodeHost,
  PasswordCheckUnreachableError,
  signInDoor,
  type SignInDoor,
} from '../../../src/hosting/index.js';
import {
  directoryPasswords,
  hashPassword,
  identityConfigFromEnv,
  identityFromConfig,
  ldapDirectory,
  localPasswords,
  type Directory,
  type DirectorySession,
} from '../../../src/identity.js';
import {
  accountBudgetKey,
  accountFilter,
  accountName,
} from '../../../src/adapters/identity/directory/directoryPasswords.js';
import { fakeDirectory } from './conformance/fakeDirectory.js';
import { TEST_CA_PEM, TEST_LEAF_PEM } from './conformance/testCertificates.js';

interface AdAccount {
  readonly sam: string;
  readonly upnPrefix?: string;
  readonly password: string;
  bad: number;
  lastBad: number;
  locked: boolean;
}

/** A directory with AD's lockout rule; `alice`, and Jane with two logon names. */
function lockingDirectory(clock: () => number, threshold: number, windowMs: number) {
  const accounts: AdAccount[] = [
    { sam: 'alice', password: 'Right-Pass-1!', bad: 0, lastBad: 0, locked: false },
    {
      sam: 'jsmith2',
      upnPrefix: 'jsmith',
      password: 'Jane-Pass-1!',
      bad: 0,
      lastBad: 0,
      locked: false,
    },
  ];
  const binds: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const find = (bindName: string): AdAccount | undefined => {
    const name = bindName.toLowerCase().replace(/@corp\.example$/, '');
    return accounts.find((a) => a.upnPrefix === name) ?? accounts.find((a) => a.sam === name);
  };
  const dir: Directory & {
    account(sam: string): AdAccount;
    binds: string[];
    readonly peak: number;
  } = {
    account: (sam) => accounts.find((a) => a.sam === sam) as AdAccount,
    binds,
    get peak() {
      return peak;
    },
    async open(): Promise<DirectorySession> {
      let who = '';
      return {
        async bind(name, password) {
          binds.push(name);
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          const a = find(name);
          if (a === undefined) return 'invalid';
          const now = clock();
          if (now - a.lastBad >= windowMs) a.bad = 0; // AD: a window since the LAST bad password
          if (a.locked) return 'invalid';
          if (a.password !== password) {
            a.bad += 1;
            a.lastBad = now;
            if (threshold > 0 && a.bad >= threshold) a.locked = true;
            return 'invalid';
          }
          a.bad = 0;
          who = `u:CORP\\${a.sam}`;
          return 'ok';
        },
        async whoAmI() {
          return who;
        },
        async search() {
          return [{ dn: 'CN=x,DC=corp,DC=example', objectGUID: Buffer.alloc(16, 1) }];
        },
        async close() {},
      };
    },
  };
  return dir;
}

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

async function mount(door: SignInDoor): Promise<string> {
  const { createServer } = await import('node:net');
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
  const host = nodeHost({
    port,
    hostname: '127.0.0.1',
    signIn: door.hostSignIn,
    onUnhandled: (q, r) => void door.handle(q, r).then((ok) => ok || r.writeHead(404).end()),
  });
  const handle = await host.serve((_q, reply) => reply.complete('ok'));
  open.push(handle);
  return `http://127.0.0.1:${port}`;
}

const post = (url: string, username: string, password: string) =>
  fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then((r) => r.status);

const DIRECTORY = { domain: 'corp.example', netbiosDomain: 'CORP', baseDn: 'DC=corp,DC=example' };

/** The door as `directoryPasswordChoice` builds it: a third of the threshold, AD's window. */
function adDoor(dir: Directory, threshold: number, windowMinutes: number, now?: () => number) {
  return signInDoor({
    passwords: directoryPasswords({ directory: dir, ...DIRECTORY }),
    store: memorySignIns({ warn: () => undefined }),
    publicUrl: 'http://127.0.0.1:1',
    production: false,
    limits: { perName: Math.floor(threshold / 3), windowMinutes, backoffMs: 0 },
    minimumResponseMs: 0,
    ...(now !== undefined && { now }),
  });
}

describe('review idI57 B-1 — one budget per ACCOUNT, whatever the spelling', () => {
  it('four spellings of alice share ONE budget: at most perName binds reach AD, and alice can still sign in', async () => {
    const t = Date.now();
    const threshold = 10; // perName 3
    const dir = lockingDirectory(() => t, threshold, 30 * 60_000);
    const url = await mount(adDoor(dir, threshold, 30));
    const statuses: number[] = [];
    for (const spelling of ['alice', 'Alice', 'ALICE', 'alice@corp.example', 'CORP\\alice']) {
      for (let i = 0; i < 5; i += 1) statuses.push(await post(url, spelling, `wrong-${i}`));
    }
    expect(statuses.filter((s) => s === 401)).toHaveLength(3);
    expect(dir.binds).toHaveLength(3);
    expect(dir.account('alice').locked).toBe(false);
  });

  it('one check in flight per ACCOUNT: four spellings in parallel run one bind at a time', async () => {
    const dir = lockingDirectory(() => Date.now(), 10, 30 * 60_000);
    const url = await mount(adDoor(dir, 10, 30));
    const statuses = await Promise.all(
      ['alice', 'Alice', 'aLice', 'alice@corp.example'].map((v) => post(url, v, 'wrong')),
    );
    expect(dir.peak).toBe(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });

  it('the key: lower-cased, any DOMAIN\\ prefix and any @suffix removed, NFC', () => {
    for (const typed of ['alice', ' ALICE ', 'Alice@corp.example', 'CORP\\alice', 'x\\ALICE@y']) {
      expect(accountBudgetKey(typed), typed).toBe('alice');
    }
    expect(accountBudgetKey('José')).toBe('josé');
    const checker = directoryPasswords({ directory: fakeDirectory([]), ...DIRECTORY });
    expect(checker.budgetKey?.('ALICE@corp.example')).toBe('alice');
  });

  it('local-password keys on the name the list compares (trimmed, NFC; case kept — two entries)', async () => {
    const hash = await hashPassword('pw', { log2N: 14, r: 8, p: 1 });
    const checker = localPasswords(`priya:${hash}`);
    expect(checker.budgetKey?.(' priya ')).toBe('priya');
    expect(checker.budgetKey?.('Priya')).toBe('Priya');
  });
});

describe("review idI57 B-2 — the window runs from the LAST failure, as AD's does", () => {
  it('a slow guesser spacing attempts across the first window never locks the account', async () => {
    let t = 1_000_000;
    const threshold = 10; // perName 3
    const windowMs = 30 * 60_000;
    const dir = lockingDirectory(() => t, threshold, windowMs);
    const url = await mount(adDoor(dir, threshold, 30, () => t));
    expect(await post(url, 'alice', 'w0')).toBe(401);
    t += windowMs - 60_000;
    expect(await post(url, 'alice', 'w1')).toBe(401);
    expect(await post(url, 'alice', 'w2')).toBe(401);
    expect(await post(url, 'alice', 'w3')).toBe(429);
    t += 60_000; // the FIRST attempt's window is over; the last failure's is not
    expect(await post(url, 'alice', 'x0')).toBe(429);
    expect(await post(url, 'alice', 'x1')).toBe(429);
    t += windowMs; // a full window after the last failure: AD has reset too
    expect(await post(url, 'alice', 'Right-Pass-1!')).toBe(200);
    expect(dir.account('alice').locked).toBe(false);
  });
});

describe('review idI57 S-4 — a third, and the two-logon-name residual', () => {
  it("an account with a separate UPN prefix has two budgets, and together they stay under AD's threshold", async () => {
    const t = Date.now();
    const threshold = 10;
    const dir = lockingDirectory(() => t, threshold, 30 * 60_000);
    const url = await mount(adDoor(dir, threshold, 30));
    for (const name of ['jsmith', 'jsmith2']) {
      for (let i = 0; i < 5; i += 1) await post(url, name, `wrong-${i}`);
    }
    expect(dir.account('jsmith2').bad).toBe(6); // 2 × ⌊10/3⌋
    expect(dir.account('jsmith2').locked).toBe(false);
    expect(await post(url, 'jsmith', 'Jane-Pass-1!')).toBe(429); // her budget is spent…
    expect(dir.account('jsmith2').locked).toBe(false); // …but AD never locked her
  });
});

describe('review idI57 S-6 — a bind that timed out after it was sent stays counted', () => {
  it('a timed-out bind answers 503 AND spends the budget; an unreachable directory spends nothing', async () => {
    const dir = fakeDirectory([{ sam: 'alice', password: 'pw-1' }]);
    const door = signInDoor({
      passwords: directoryPasswords({ directory: dir, ...DIRECTORY }),
      store: memorySignIns({ warn: () => undefined }),
      publicUrl: 'http://127.0.0.1:1',
      production: false,
      limits: { perName: 2, backoffMs: 0 },
      minimumResponseMs: 0,
    });
    const url = await mount(door);
    dir.down = true;
    for (let i = 0; i < 4; i += 1) expect(await post(url, 'alice', 'x')).toBe(503);
    dir.down = false;
    dir.bindTimesOut = true;
    expect(await post(url, 'alice', 'x')).toBe(503);
    expect(await post(url, 'alice', 'x')).toBe(503);
    expect(await post(url, 'alice', 'x')).toBe(429); // two timed-out binds = the whole budget
    expect(dir.binds).toHaveLength(2);
  });

  it('ldapDirectory: a bind that never connected is PasswordCheckUnreachableError; one that timed out after connecting is not', async () => {
    const make = (connect: boolean) => {
      class Client {
        private readonly options: Record<string, unknown>;
        constructor(options: Record<string, unknown>) {
          this.options = options;
        }
        async bind() {
          if (connect) {
            // The adapter's own connection hook ran and the TLS handshake finished.
            const create = this.options.createSecureConnection as (
              p: number,
              h: string,
              o: object,
            ) => import('node:events').EventEmitter;
            const socket = create(1, '127.0.0.1', {});
            socket.on('error', () => undefined);
            socket.emit('secureConnect');
            (socket as unknown as { destroy(): void }).destroy();
            throw new Error('BindRequest: Operation timed out');
          }
          throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        }
        async exop() {
          return {};
        }
        async search() {
          return { searchEntries: [] };
        }
        async unbind() {}
      }
      return ldapDirectory({
        url: 'ldaps://127.0.0.1:1',
        caPem: TEST_CA_PEM,
        backend: { Client } as never,
        log: () => undefined,
      });
    };
    const refused = await (await make(false).open()).bind('a@b', 'x').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PasswordCheckUnreachableError);
    const timedOut = await (await make(true).open()).bind('a@b', 'x').catch((e: unknown) => e);
    expect(timedOut).toBeInstanceOf(Error);
    expect(timedOut).not.toBeInstanceOf(PasswordCheckUnreachableError);
  });
});

describe('review idI57 N-7 — a control character never reaches a directory', () => {
  it('the checker refuses before the bind; the door answers 400; hashPassword refuses one', async () => {
    const dir = fakeDirectory([{ sam: 'alice', password: 'pw-1' }]);
    const checker = directoryPasswords({ directory: dir, ...DIRECTORY });
    for (const pw of ['pw-1\u0000junk', 'pw\t1', 'pw-1\n', '\u0085pw']) {
      expect(await checker.check('alice', pw)).toBeUndefined();
    }
    expect(dir.binds).toEqual([]);
    const url = await mount(
      signInDoor({
        passwords: checker,
        store: memorySignIns({ warn: () => undefined }),
        publicUrl: 'http://127.0.0.1:1',
        production: false,
        minimumResponseMs: 0,
      }),
    );
    expect(await post(url, 'alice', 'pw-1\u0000junk')).toBe(400);
    expect(dir.binds).toEqual([]);
    await expect(hashPassword('a\u0000b', { log2N: 14, r: 8, p: 1 })).rejects.toThrow(/control/);
  });
});

describe('review idI57 N-8 / N-9 / D12 — filters, names, GUIDs', () => {
  it('the SID form carries (objectClass=user), as the NetBIOS form does', () => {
    expect(accountFilter('u:S-1-5-21-1-2-3-500', 'CORP')).toMatch(
      /^\(&\(objectClass=user\)\(objectSid=\\01\\05/,
    );
  });

  it("CORP\\alice binds as alice; another domain's prefix never reaches the directory", async () => {
    expect(accountName('CORP\\alice', '@corp.example', 'CORP')).toBe('alice');
    expect(accountName('corp\\alice', '@corp.example', 'CORP')).toBe('alice');
    expect(accountName('EVIL\\alice', '@corp.example', 'CORP')).toBeUndefined();
    const dir = fakeDirectory([{ sam: 'alice', password: 'pw-1' }]);
    const checker = directoryPasswords({ directory: dir, ...DIRECTORY });
    expect(await checker.check('CORP\\alice', 'pw-1')).toBeDefined();
    expect(dir.binds).toEqual(['alice@corp.example']);
  });

  it('an entry whose objectGUID is 15 bytes is refused', async () => {
    const dir: Directory = {
      async open() {
        return {
          async bind() {
            return 'ok';
          },
          async whoAmI() {
            return 'u:CORP\\alice';
          },
          async search() {
            return [{ dn: 'CN=a', objectGUID: Buffer.alloc(15, 1) }];
          },
          async close() {},
        };
      },
    };
    const checker = directoryPasswords({ directory: dir, ...DIRECTORY });
    expect(await checker.check('alice', 'x')).toBeUndefined();
  });
});

describe('review idI57 S-4 / N-10 — boot refusals', () => {
  async function env(extra: Record<string, string | undefined> = {}) {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'af-ldap-'));
    writeFileSync(join(dir, 'ca.pem'), TEST_CA_PEM);
    writeFileSync(join(dir, 'leaf.pem'), TEST_LEAF_PEM);
    writeFileSync(
      join(dir, 'junk.pem'),
      '-----BEGIN CERTIFICATE-----\nnot base64\n-----END CERTIFICATE-----\n',
    );
    const all: Record<string, string | undefined> = {
      IDENTITY_STRATEGY: 'directory-password',
      IDENTITY_PUBLIC_URL: 'http://127.0.0.1:18777',
      IDENTITY_LDAP_URL: 'ldaps://dc1.corp.example:636',
      IDENTITY_LDAP_CA_FILE: join(dir, 'ca.pem'),
      IDENTITY_LDAP_DOMAIN: 'corp.example',
      IDENTITY_LDAP_NETBIOS_DOMAIN: 'CORP',
      IDENTITY_LDAP_BASE_DN: 'DC=corp,DC=example',
      IDENTITY_LDAP_LOCKOUT_THRESHOLD: '10',
      IDENTITY_LDAP_LOCKOUT_WINDOW_MINUTES: '30',
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v?.replace('<dir>', dir)])),
    };
    const clean = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined));
    return identityFromConfig(identityConfigFromEnv(clean as Record<string, string>), {
      production: false,
    });
  }

  it.each([
    ['1', 'IDENTITY_LDAP_LOCKOUT_THRESHOLD'],
    ['2', 'IDENTITY_LDAP_LOCKOUT_THRESHOLD'],
  ])('threshold %s is refused: no budget of whole attempts stays under it', async (t, key) => {
    await expect(env({ IDENTITY_LDAP_LOCKOUT_THRESHOLD: t })).rejects.toMatchObject({ key });
  });

  it('threshold 2 with the override boots, and the banner says the door cannot protect it', async () => {
    const choice = await env({
      IDENTITY_LDAP_LOCKOUT_THRESHOLD: '2',
      IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD: 'yes',
    });
    const banner = choice.banner.join('\n');
    expect(banner).toMatch(/1 per account/);
    expect(banner).toMatch(
      /WARNING AD locks an account after 2 wrong passwords — this door CANNOT protect/,
    );
  });

  it('the override is refused where it does nothing, or with any value but yes', async () => {
    await expect(env({ IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD: 'yes' })).rejects.toMatchObject({
      key: 'IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD',
    });
    await expect(
      env({ IDENTITY_LDAP_LOCKOUT_THRESHOLD: '1', IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD: 'true' }),
    ).rejects.toMatchObject({ key: 'IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD' });
  });

  it('threshold 0 (AD never locks) boots with the door default; 3 gives 1 per account', async () => {
    expect((await env({ IDENTITY_LDAP_LOCKOUT_THRESHOLD: '0' })).banner.join('\n')).toMatch(
      /AD never locks \(threshold 0\), door default/,
    );
    expect((await env({ IDENTITY_LDAP_LOCKOUT_THRESHOLD: '3' })).banner.join('\n')).toMatch(
      /1 per account \(a third of AD's 3/,
    );
  });

  it('a CA file holding a LEAF certificate, or junk, is refused naming IDENTITY_LDAP_CA_FILE', async () => {
    await expect(env({ IDENTITY_LDAP_CA_FILE: '<dir>/leaf.pem' })).rejects.toMatchObject({
      key: 'IDENTITY_LDAP_CA_FILE',
      message: expect.stringMatching(/not a CA/),
    });
    await expect(env({ IDENTITY_LDAP_CA_FILE: '<dir>/junk.pem' })).rejects.toMatchObject({
      key: 'IDENTITY_LDAP_CA_FILE',
    });
  });

  it('a base DN that does not parse is refused naming IDENTITY_LDAP_BASE_DN', async () => {
    for (const bad of [')(', 'DC=corp,', 'corp.example', 'DC=corp,DC=(x)']) {
      await expect(env({ IDENTITY_LDAP_BASE_DN: bad }), bad).rejects.toMatchObject({
        key: 'IDENTITY_LDAP_BASE_DN',
      });
    }
    await expect(
      env({ IDENTITY_LDAP_BASE_DN: 'OU=Sales Team,DC=corp,DC=example' }),
    ).resolves.toBeDefined();
  });
});
