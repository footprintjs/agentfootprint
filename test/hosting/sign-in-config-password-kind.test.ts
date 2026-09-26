/**
 * `GET /auth/config` says WHICH password a password door takes —
 * `passwordKind: 'directory' | 'local'` — so a page can label its form
 * ("Windows username" for the company directory, "Username" for a local list)
 * instead of guessing from `mode: 'password'`, which both strategies answer.
 *
 * The laws being pinned:
 *   • Additive: `mode` is unchanged; `passwordKind` rides beside it only on a
 *     password door whose checker declares `kind`.
 *   • A fact, not words: the answer is the checker's declared kind; the label
 *     stays the page's.
 *   • Never a guess: a checker that declares no kind adds no key; a kind
 *     outside the vocabulary refuses at construction (the page branches on it).
 *   • The built-ins declare it: `directoryPasswords` → `'directory'`,
 *     `localPasswords` → `'local'`.
 *
 * Test types (Convention 3): unit (the built-ins' kind) · integration (the
 * door's answer over HTTP) · boundary (no kind, a foreign kind).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { memorySignIns, SignInDoorConfigError, signInDoor } from '../../src/hosting/index.js';
import type { PasswordChecker, PasswordKind } from '../../src/hosting/index.js';
import { directoryPasswords, localPasswords } from '../../src/identity.js';
import { call, mountDoor, testUsers, type MountedDoor } from './signInDoorHarness.js';

const open: MountedDoor[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});
async function mounted(extra: Parameters<typeof mountDoor>[0] = {}): Promise<MountedDoor> {
  const m = await mountDoor(extra);
  open.push(m);
  return m;
}

/** A directory checker whose directory is never opened here. */
function directoryChecker(): PasswordChecker {
  return directoryPasswords({
    directory: {
      open: () => Promise.reject(new Error('not opened in this test')),
    } as unknown as Parameters<typeof directoryPasswords>[0]['directory'],
    domain: 'corp.example',
    netbiosDomain: 'CORP',
    baseDn: 'DC=corp,DC=example',
  });
}

const custom = (kind?: PasswordKind): PasswordChecker => ({
  strategy: 'my-directory',
  ...(kind !== undefined && { kind }),
  check: () => Promise.resolve(undefined),
});

describe('passwordKind — the built-in checkers declare it', () => {
  it("directoryPasswords is 'directory'; localPasswords is 'local'", async () => {
    expect(directoryChecker().kind).toBe('directory');
    expect(localPasswords(await testUsers()).kind).toBe('local');
  });
});

describe('GET /auth/config — passwordKind beside mode', () => {
  it("a local-password door answers { mode: 'password', passwordKind: 'local' }", async () => {
    const m = await mounted();
    expect((await call(m.url, '/auth/config')).body).toEqual({
      mode: 'password',
      passwordKind: 'local',
    });
  });

  it("a directory-password door answers passwordKind: 'directory' — the page labels it a Windows username", async () => {
    const m = await mounted({ passwords: directoryChecker() });
    expect((await call(m.url, '/auth/config')).body).toEqual({
      mode: 'password',
      passwordKind: 'directory',
    });
  });

  it('a checker that declares no kind adds no key — the answer is what it was', async () => {
    const m = await mounted({ passwords: custom() });
    const body = (await call(m.url, '/auth/config')).body;
    expect(body).toEqual({ mode: 'password' });
    expect(Object.keys(body)).toEqual(['mode']);
  });

  it('a custom checker may declare a kind of its own', async () => {
    const m = await mounted({ passwords: custom('directory') });
    expect((await call(m.url, '/auth/config')).body).toEqual({
      mode: 'password',
      passwordKind: 'directory',
    });
  });

  it('a kind outside the vocabulary refuses at construction, naming the option', () => {
    const build = () =>
      signInDoor({
        passwords: { ...custom(), kind: 'windows' as unknown as PasswordKind },
        store: memorySignIns({ warn: () => undefined }),
        publicUrl: 'http://127.0.0.1:5350',
        production: false,
      });
    expect(build).toThrow(SignInDoorConfigError);
    expect(build).toThrow(/passwords\.kind is 'directory' or 'local'/);
  });
});
