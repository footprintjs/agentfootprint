/**
 * fileStore — permissions, links, the key, the platform and the lock (case table 4.5, 4.7, 4.8).
 *
 * Security: the directory and every file the store opens are refused when they are a link, a
 * hard link, another user's, or open to group or others; the key is checked and copied; the lock
 * waits 2 s, then `locked-timeout`, and a lock older than 30 s is taken over; a load that meets a
 * half-written append waits for its writer instead of refusing a healthy log. "Another user" is
 * reached through the `uid` the host passes (a test cannot own files as someone else).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { noteEntry, openedEntry } from './build.js';
import { fileLedgerStore } from './fileStore.js';
import { mintSessionId } from './session.js';
import { LedgerStoreError } from './store.js';
import type { LedgerEntry } from './types.js';

const AT = '2026-11-25T10:00:00Z';
const UID = process.getuid!();
const made: string[] = [];
afterAll(() =>
  made.forEach((dir) => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }),
);

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-llm-ledger-safety-'));
  made.push(dir);
  return dir;
}
function unwrap<E extends LedgerEntry>(built: { ok: boolean; entry?: E }): E {
  if (!built.ok) throw new Error('fixture refused');
  return built.entry as E;
}
const OPENED = unwrap(openedEntry({ seq: 1, at: AT }, {}));
const note = (seq: number) =>
  unwrap(noteEntry({ seq, at: AT }, { kind: 'claim', text: `n ${seq} 1234`, cites: [] }));

async function refusal(work: Promise<unknown>): Promise<{ code: string; field?: string } | 'ok'> {
  try {
    await work;
    return 'ok';
  } catch (error) {
    if (!(error instanceof LedgerStoreError)) throw error;
    return error.field === undefined
      ? { code: error.code }
      : { code: error.code, field: error.field };
  }
}

/** A store with one opened session in a fresh directory. */
async function withSession() {
  const dir = join(root(), 'store');
  const key = randomBytes(32);
  const store = fileLedgerStore({ dir, key, uid: UID });
  const session = mintSessionId();
  await store.append(session, 0, [OPENED]);
  return {
    dir,
    key,
    store,
    session,
    file: join(dir, `${session}.jsonl`),
    lock: join(dir, `${session}.lock`),
  };
}

describe('construction: the key, the uid and the directory option', () => {
  const dir = join(tmpdir(), 'af-llm-ledger-never-made');

  it('a key is a Uint8Array of at least 32 bytes; the refusal never quotes it', () => {
    const short = randomBytes(31);
    expect(() => fileLedgerStore({ dir, key: short, uid: UID })).toThrow(RangeError);
    try {
      fileLedgerStore({ dir, key: short, uid: UID });
    } catch (error) {
      const message = String((error as Error).message);
      expect(message.includes(short.toString('hex'))).toBe(false);
      expect(message.includes(short.toString('base64'))).toBe(false);
    }
    expect(() => fileLedgerStore({ dir, key: 'k'.repeat(64) as never, uid: UID })).toThrow(
      RangeError,
    );
    expect(() =>
      fileLedgerStore({ dir, key: Array.from(randomBytes(32)) as never, uid: UID }),
    ).toThrow(RangeError);
    expect(() => fileLedgerStore({ dir, key: new Uint8Array(32), uid: UID })).not.toThrow();
    expect(() => fileLedgerStore({ dir, key: randomBytes(64), uid: UID })).not.toThrow();
  });

  it('uid is a whole number; dir a non-empty path; options an object', () => {
    for (const uid of [-1, 1.5, Number.NaN, '501'])
      expect(() => fileLedgerStore({ dir, key: randomBytes(32), uid: uid as number })).toThrow(
        TypeError,
      );
    for (const bad of ['', 'a\0b', 7])
      expect(() => fileLedgerStore({ dir: bad as string, key: randomBytes(32), uid: UID })).toThrow(
        TypeError,
      );
    expect(() => fileLedgerStore(null as never)).toThrow(TypeError);
    expect(existsSync(dir)).toBe(false); // construction touches no disk
  });

  it('the key is copied once: wiping the caller’s array changes nothing', async () => {
    const where = join(root(), 'store');
    const key = randomBytes(32);
    const store = fileLedgerStore({ dir: where, key, uid: UID });
    const session = mintSessionId();
    await store.append(session, 0, [OPENED]);
    key.fill(0);
    expect((await store.load(session)).seq).toBe(1);
    expect(await store.append(session, 1, [note(2)])).toBe(2);
  });
});

describe('the directory', () => {
  it('is created 0700 when missing, with its parents', async () => {
    const dir = join(root(), 'a', 'b', 'store');
    await fileLedgerStore({ dir, key: randomBytes(32), uid: UID }).load(mintSessionId());
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.each([
    [0o700, 'ok'],
    [0o755, 'ok'],
    [0o750, 'ok'],
    [0o770, 'unsafe-file'],
    [0o720, 'unsafe-file'],
    [0o702, 'unsafe-file'],
    [0o777, 'unsafe-file'],
  ])('mode %o is %s', async (mode, expected) => {
    const dir = join(root(), 'store');
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, mode);
    const result = await refusal(
      fileLedgerStore({ dir, key: randomBytes(32), uid: UID }).load(mintSessionId()),
    );
    expect(result === 'ok' ? 'ok' : result.code).toBe(expected);
    if (result !== 'ok') expect(result).toEqual({ code: 'unsafe-file', field: 'dir' });
  });

  it('is refused when it is a link, a file, or another user’s', async () => {
    const base = root();
    const real = join(base, 'real');
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, join(base, 'link'));
    writeFileSync(join(base, 'file'), 'x', { mode: 0o600 });
    const key = randomBytes(32);
    for (const dir of [join(base, 'link'), join(base, 'file')])
      expect(await refusal(fileLedgerStore({ dir, key, uid: UID }).load(mintSessionId()))).toEqual({
        code: 'unsafe-file',
        field: 'dir',
      });
    expect(
      await refusal(
        fileLedgerStore({ dir: real, key, uid: UID + 1 }).append(mintSessionId(), 0, [OPENED]),
      ),
    ).toEqual({
      code: 'unsafe-file',
      field: 'dir',
    });
  });
});

describe('the session file', () => {
  it('a symbolic link at the session path is refused on load and on append (O_NOFOLLOW)', async () => {
    const { dir, store, session, file } = await withSession();
    const target = join(dir, 'elsewhere.jsonl');
    writeFileSync(target, readFileSync(file), { mode: 0o600 });
    rmSync(file);
    symlinkSync(target, file);
    expect(await refusal(store.load(session))).toEqual({ code: 'unsafe-file', field: 'file' });
    expect(await refusal(store.append(session, 1, [note(2)]))).toEqual({
      code: 'unsafe-file',
      field: 'file',
    });
    expect(readFileSync(target).toString().split('\n')).toHaveLength(2); // nothing written through it
  });

  it('a hard link (another name for the same bytes) is refused', async () => {
    const { dir, store, session, file } = await withSession();
    linkSync(file, join(dir, 'second-name'));
    expect(await refusal(store.load(session))).toEqual({ code: 'unsafe-file', field: 'file' });
    expect(await refusal(store.append(session, 1, [note(2)]))).toEqual({
      code: 'unsafe-file',
      field: 'file',
    });
  });

  it.each([0o640, 0o604, 0o610, 0o601, 0o660, 0o666, 0o620])(
    'mode %o is refused: any group or other bit',
    async (mode) => {
      const { store, session, file } = await withSession();
      chmodSync(file, mode);
      expect(await refusal(store.load(session))).toEqual({ code: 'unsafe-file', field: 'file' });
      expect(await refusal(store.append(session, 1, [note(2)]))).toEqual({
        code: 'unsafe-file',
        field: 'file',
      });
    },
  );

  it('another user’s file is refused (reached through the uid the host passes)', async () => {
    const { dir, key, session } = await withSession();
    chmodSync(dir, 0o700);
    const other = fileLedgerStore({ dir, key, uid: UID + 1 });
    expect(((await refusal(other.load(session))) as { code: string }).code).toBe('unsafe-file');
  });

  it('a directory or a FIFO at the session path is refused, never blocked on', async () => {
    const { dir, store } = await withSession();
    const asDir = mintSessionId();
    mkdirSync(join(dir, `${asDir}.jsonl`));
    expect(await refusal(store.load(asDir))).toEqual({ code: 'unsafe-file', field: 'file' });
    expect(await refusal(store.append(asDir, 0, [OPENED]))).toEqual({
      code: 'unsafe-file',
      field: 'file',
    });
    const asFifo = mintSessionId();
    const made = spawnSync('mkfifo', ['-m', '600', join(dir, `${asFifo}.jsonl`)]);
    expect(made.status).toBe(0);
    expect(await refusal(store.load(asFifo))).toEqual({ code: 'unsafe-file', field: 'file' });
  });

  it('a file the store creates is 0600 (under the process umask; a worker cannot change it)', async () => {
    const { file } = await withSession();
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('the lock', () => {
  it('a held lock: append waits about 2 s, then locked-timeout, and writes nothing', async () => {
    const { store, session, file, lock } = await withSession();
    writeFileSync(lock, '', { mode: 0o600 });
    const before = readFileSync(file);
    const start = performance.now();
    expect(await refusal(store.append(session, 1, [note(2)]))).toEqual({ code: 'locked-timeout' });
    const waited = performance.now() - start;
    expect(waited).toBeGreaterThanOrEqual(1_900);
    expect(waited).toBeLessThan(6_000);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(existsSync(lock)).toBe(true); // not ours: never removed
  }, 15_000);

  it('a lock younger than 30 s is respected; one older than 30 s is taken over and removed', async () => {
    const { store, session, lock } = await withSession();
    writeFileSync(lock, '', { mode: 0o600 });
    const now = Date.now() / 1000;
    utimesSync(lock, now - 25, now - 25);
    expect(await refusal(store.append(session, 1, [note(2)]))).toEqual({ code: 'locked-timeout' });
    utimesSync(lock, now - 31, now - 31);
    expect(await store.append(session, 1, [note(2)])).toBe(2);
    expect(existsSync(lock)).toBe(false);
  }, 15_000);

  it('a lock released while waiting is taken at once', async () => {
    const { store, session, lock } = await withSession();
    writeFileSync(lock, '', { mode: 0o600 });
    setTimeout(() => rmSync(lock), 150);
    const start = performance.now();
    expect(await store.append(session, 1, [note(2)])).toBe(2);
    expect(performance.now() - start).toBeLessThan(1_500);
  });

  it('a lock that is a link, or open to others, is refused', async () => {
    const { dir, store, session, lock } = await withSession();
    symlinkSync(join(dir, 'nowhere'), lock);
    expect(await refusal(store.append(session, 1, [note(2)]))).toEqual({
      code: 'unsafe-file',
      field: 'lock',
    });
    rmSync(lock);
    writeFileSync(lock, '', { mode: 0o600 });
    chmodSync(lock, 0o644);
    expect(await refusal(store.append(session, 1, [note(2)]))).toEqual({
      code: 'unsafe-file',
      field: 'lock',
    });
  });

  it('no lock is left behind: after an append, a conflict or a refusal', async () => {
    const { store, session, file, lock } = await withSession();
    expect(await store.append(session, 1, [note(2)])).toBe(2);
    expect(existsSync(lock)).toBe(false);
    expect(await store.append(session, 1, [note(2)])).toBe('conflict');
    expect(existsSync(lock)).toBe(false);
    writeFileSync(file, readFileSync(file).subarray(0, -1));
    expect(await refusal(store.append(session, 2, [note(3)]))).toEqual({ code: 'torn-line' });
    expect(existsSync(lock)).toBe(false);
  });
});

describe('a load that meets a half-written append', () => {
  it('waits for the writer that holds the lock, then reads the whole log', async () => {
    const { store, session, file, lock, key, dir } = await withSession();
    const writer = fileLedgerStore({ dir, key, uid: UID });
    await writer.append(session, 1, [note(2)]);
    const whole = readFileSync(file);
    writeFileSync(file, whole.subarray(0, whole.length - 10)); // as a writer mid-write leaves it
    writeFileSync(lock, '', { mode: 0o600 });
    setTimeout(() => {
      writeFileSync(file, whole);
      rmSync(lock);
    }, 200);
    expect((await store.load(session)).seq).toBe(2);
  });

  it('with no writer, a torn tail is torn-line at once', async () => {
    const { store, session, file } = await withSession();
    writeFileSync(file, readFileSync(file).subarray(0, -1));
    const start = performance.now();
    expect(await refusal(store.load(session))).toEqual({ code: 'torn-line' });
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it('a lock that never goes: torn-line after the wait', async () => {
    const { store, session, file, lock } = await withSession();
    writeFileSync(file, readFileSync(file).subarray(0, -1));
    writeFileSync(lock, '', { mode: 0o600 });
    expect(await refusal(store.load(session))).toEqual({ code: 'torn-line' });
  }, 15_000);
});

describe('another user’s file or lock, seen file by file', () => {
  // A test cannot own a file as someone else, and a wrong `uid` is refused at the directory
  // first. So the operating system's answer is changed instead: the store's own `stat` of a
  // session file, and its `lstat` of a lock, report another owner while the directory stays ours.
  it('is refused for the session file on load and append, and for a held lock', async () => {
    const { dir, key, session, lock } = await withSession();
    vi.resetModules();
    vi.doMock('node:fs/promises', async (real) => {
      const fsp = await real<typeof import('node:fs/promises')>();
      const foreign = <S extends object>(stat: S): S =>
        Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: UID + 1 });
      return {
        ...fsp,
        open: async (...args: Parameters<typeof fsp.open>) => {
          const handle = await fsp.open(...args);
          if (String(args[0]).endsWith('.jsonl')) {
            const stat = handle.stat.bind(handle);
            Object.defineProperty(handle, 'stat', { value: async () => foreign(await stat()) });
          }
          return handle;
        },
        lstat: async (...args: Parameters<typeof fsp.lstat>) => {
          const stat = await fsp.lstat(...args);
          return String(args[0]).endsWith('.lock') ? foreign(stat) : stat;
        },
      };
    });
    try {
      const mocked = await import('./fileStore.js');
      const store = mocked.fileLedgerStore({ dir, key, uid: UID });
      const codeOf = async (work: Promise<unknown>) =>
        work.then(
          () => 'ok',
          (e: { name?: string; code?: string; field?: string }) => `${e.name}:${e.code}:${e.field}`,
        );
      expect(await codeOf(store.load(session))).toBe('LedgerStoreError:unsafe-file:file');
      expect(await codeOf(store.append(session, 1, [note(2)]))).toBe(
        'LedgerStoreError:unsafe-file:file',
      );
      writeFileSync(lock, '', { mode: 0o600 });
      expect(await codeOf(store.append(session, 1, [note(2)]))).toBe(
        'LedgerStoreError:unsafe-file:lock',
      );
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });
});

describe('POSIX only', () => {
  it('refuses at construction where paths are not POSIX, or O_NOFOLLOW is missing', async () => {
    vi.resetModules();
    vi.doMock('node:path', async (real) => ({
      ...(await real<typeof import('node:path')>()),
      sep: '\\',
    }));
    const windowsPaths = await import('./fileStore.js');
    expect(() => windowsPaths.fileLedgerStore({ dir: 'x', key: randomBytes(32), uid: 0 })).toThrow(
      /POSIX only/,
    );
    vi.doUnmock('node:path');
    vi.resetModules();
    vi.doMock('node:fs', async (real) => {
      const fs = await real<typeof import('node:fs')>();
      return { ...fs, constants: { ...fs.constants, O_NOFOLLOW: undefined } };
    });
    const noNofollow = await import('./fileStore.js');
    expect(() => noNofollow.fileLedgerStore({ dir: 'x', key: randomBytes(32), uid: 0 })).toThrow(
      /POSIX only/,
    );
    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});
