/**
 * fileStore — two writers and one lock (case table 4.8; the second read's P1-1).
 *
 * Security: the stale rule reads the wall clock, so a lock can be taken over from a writer that is
 * still running, and two waiters on one dead lock can both take it. These are the reviewer's two
 * reproductions, with the interleaving forced by hooks on `node:fs/promises` (one hooked module
 * instance per writer): each ends with AT MOST ONE writer told its seq and a log that still
 * verifies. Also pinned: a writer never removes a lock that is no longer its own, the stale
 * takeover re-checks the lock it is about to remove, and a lock whose token could not be written
 * is removed at once.
 */
import { randomBytes } from 'node:crypto';
import { constants, existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { noteEntry, openedEntry } from './build.js';
import { fileLedgerStore } from './fileStore.js';
import type { LedgerStore } from './store.js';
import { mintSessionId } from './session.js';
import type { LedgerEntry } from './types.js';

const AT = '2026-11-25T10:00:00Z';
const UID = process.getuid!();
const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
afterEach(() => {
  hook = async () => undefined;
});

function unwrap<E extends LedgerEntry>(built: { ok: boolean; entry?: E }): E {
  if (!built.ok) throw new Error('fixture refused');
  return built.entry as E;
}
const note = (text: string) =>
  unwrap(noteEntry({ seq: 2, at: AT }, { kind: 'claim', text, cites: [] }));

type Op = 'lstat' | 'lstat:after' | 'unlink' | 'opened' | 'created' | 'write' | 'sync';
/** The test's hook: runs around each call a hooked store makes, by writer, operation and path. */
let hook: (writer: string, op: Op, path: string) => Promise<void> = async () => undefined;

/**
 * A file store whose `node:fs/promises` calls pass through `hook`, labelled `writer`. With
 * `reuseInodes`, every stat of a lock reports ONE inode number — a file system that hands a freed
 * number straight to the next file (ext4 and XFS can).
 */
async function hookedStore(
  writer: string,
  options: { dir: string; key: Uint8Array },
  reuseInodes = false,
): Promise<LedgerStore> {
  vi.resetModules();
  vi.doMock('node:fs/promises', async (real) => {
    const fsp = await real<typeof import('node:fs/promises')>();
    const reused = <S extends object>(path: string, stat: S): S =>
      reuseInodes && path.endsWith('.lock')
        ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino: 4242 })
        : stat;
    return {
      ...fsp,
      lstat: async (...args: Parameters<typeof fsp.lstat>) => {
        await hook(writer, 'lstat', String(args[0]));
        const stat = await fsp.lstat(...args);
        await hook(writer, 'lstat:after', String(args[0]));
        return reused(String(args[0]), stat);
      },
      unlink: async (...args: Parameters<typeof fsp.unlink>) => {
        await hook(writer, 'unlink', String(args[0]));
        return fsp.unlink(...args);
      },
      open: async (...args: Parameters<typeof fsp.open>) => {
        const handle = await fsp.open(...args);
        const path = String(args[0]);
        const creating = typeof args[1] === 'number' && (args[1] & constants.O_EXCL) !== 0;
        await hook(writer, creating ? 'created' : 'opened', path);
        const stat = handle.stat.bind(handle);
        Object.defineProperty(handle, 'stat', { value: async () => reused(path, await stat()) });
        const write = (handle.write as (...a: unknown[]) => Promise<unknown>).bind(handle);
        Object.defineProperty(handle, 'write', {
          value: async (...a: unknown[]) => {
            await hook(writer, 'write', path);
            return write(...a);
          },
        });
        const sync = handle.sync.bind(handle);
        Object.defineProperty(handle, 'sync', {
          value: async () => {
            await hook(writer, 'sync', path);
            return sync();
          },
        });
        return handle;
      },
    };
  });
  try {
    const { fileLedgerStore: make } = await import('./fileStore.js');
    return make({ ...options, uid: UID });
  } finally {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  }
}

async function session() {
  const root = mkdtempSync(join(tmpdir(), 'af-llm-ledger-lock-'));
  made.push(root);
  const dir = join(root, 'store');
  const key = randomBytes(32);
  const plain = fileLedgerStore({ dir, key, uid: UID });
  const s = mintSessionId();
  await plain.append(s, 0, [unwrap(openedEntry({ seq: 1, at: AT }, {}))]);
  return { dir, key, plain, s, lock: join(dir, `${s}.lock`) };
}

/** What an append answered: its seq, `conflict`, or the code it was refused with. */
const answer = (work: Promise<unknown>): Promise<string> =>
  work.then(
    (v) => String(v),
    (e: { name?: string; code?: string }) => {
      if (e.name !== 'LedgerStoreError') throw e;
      return String(e.code);
    },
  );

const lookStale = (path: string): void => {
  const then = Date.now() / 1000 - 31;
  utimesSync(path, then, then);
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('a live writer whose lock looks stale', () => {
  it('taken over before its write: it writes nothing (locked-timeout), the other appends, the log verifies', async () => {
    const { dir, key, plain, s, lock } = await session();
    const a = await hookedStore('A', { dir, key });
    let b: string | undefined;
    hook = async (writer, op, path) => {
      // A holds its lock and stops (a sleep, a SIGSTOP) just before it writes; B comes.
      if (writer === 'A' && op === 'lstat' && path === lock && b === undefined) {
        lookStale(lock);
        b = await answer(plain.append(s, 1, [note('written by B 2222')]));
      }
    };
    expect(await answer(a.append(s, 1, [note('written by A 1111')]))).toBe('locked-timeout');
    expect(b).toBe('2');
    const log = await plain.load(s);
    expect(log.seq).toBe(2);
    expect((log.entries[1] as { text: string }).text).toBe('written by B 2222');
  });

  it('taken over after its write: it answers lock-lost, never a seq; the batch stands here, and the log verifies', async () => {
    const { dir, key, plain, s, lock } = await session();
    const a = await hookedStore('A', { dir, key });
    let b: string | undefined;
    hook = async (writer, op, path) => {
      if (writer === 'A' && op === 'sync' && path.endsWith('.jsonl') && b === undefined) {
        lookStale(lock);
        b = await answer(plain.append(s, 1, [note('written by B 2222')]));
      }
    };
    expect(await answer(a.append(s, 1, [note('written by A 1111')]))).toBe('lock-lost');
    expect(b).toBe('conflict'); // A's line was already there: B was behind
    const log = await plain.load(s);
    expect(log.seq).toBe(2);
    expect((log.entries[1] as { text: string }).text).toBe('written by A 1111');
  });

  it('a writer that lost its lock never removes the lock that replaced it (r2)', async () => {
    const { dir, key, plain, s, lock } = await session();
    const a = await hookedStore('A', { dir, key });
    hook = async (writer, op, path) => {
      if (
        writer === 'A' &&
        op === 'sync' &&
        path.endsWith('.jsonl') &&
        !existsSync(`${lock}.mark`)
      ) {
        writeFileSync(`${lock}.mark`, '');
        rmSync(lock); // another writer took it over...
        writeFileSync(lock, '', { mode: 0o600 }); // ...and holds it now
      }
    };
    expect(await answer(a.append(s, 1, [note('written by A 1111')]))).toBe('lock-lost');
    expect(existsSync(lock)).toBe(true);
    rmSync(lock);
    expect((await plain.load(s)).seq).toBe(2);
  });
});

describe('the stale takeover', () => {
  it('re-checks the lock it is about to remove: a fresh lock that replaced the stale one stays (r3)', async () => {
    const { dir, key, s, lock } = await session();
    writeFileSync(lock, '', { mode: 0o600 });
    lookStale(lock); // a dead writer's lock
    const w = await hookedStore('W', { dir, key });
    let looks = 0;
    hook = async (writer, op, path) => {
      if (writer !== 'W' || op !== 'lstat' || path !== lock) return;
      looks++;
      if (looks === 2) {
        // Between W's two looks, a live writer replaced the dead lock with its own.
        rmSync(lock);
        writeFileSync(lock, '', { mode: 0o600 });
      }
    };
    expect(await answer(w.append(s, 1, [note('written by W 3333')]))).toBe('locked-timeout');
    expect(existsSync(lock)).toBe(true);
  }, 15_000);

  it('two waiters on one dead lock: at most one is told its seq, and the log verifies', async () => {
    const { dir, key, plain, s, lock } = await session();
    writeFileSync(lock, '', { mode: 0o600 });
    lookStale(lock); // a dead writer's lock
    const w1 = await hookedStore('W1', { dir, key });
    const w2 = await hookedStore('W2', { dir, key });
    const w2Rechecked = deferred();
    const w1Acquired = deferred();
    const w2Acquired = deferred();
    const looks: Record<string, number> = { W1: 0, W2: 0 };
    hook = async (writer, op, path) => {
      if (path !== lock) return;
      if (op === 'lstat') looks[writer] = (looks[writer] ?? 0) + 1;
      // W2 makes both its looks at the dead lock before W1 removes it...
      if (writer === 'W2' && op === 'lstat:after' && looks.W2 === 2) w2Rechecked.resolve();
      if (writer === 'W1' && op === 'unlink') await w2Rechecked.promise;
      // ...and removes it only after W1 has taken a fresh one: W2 removes W1's lock.
      if (writer === 'W2' && op === 'unlink') await w1Acquired.promise;
      if (op === 'created') (writer === 'W1' ? w1Acquired : w2Acquired).resolve();
      // W1's check before its write comes after W2 holds the lock it took from W1.
      if (writer === 'W1' && op === 'lstat' && looks.W1 === 3) await w2Acquired.promise;
    };
    const [r1, r2] = await Promise.all([
      answer(w1.append(s, 1, [note('written by W1 1111')])),
      answer(w2.append(s, 1, [note('written by W2 2222')])),
    ]);
    expect([r1, r2].filter((r) => r === '2')).toHaveLength(1);
    expect(r1).toBe('locked-timeout');
    expect(r2).toBe('2');
    const log = await plain.load(s);
    expect(log.seq).toBe(2);
    expect((log.entries[1] as { text: string }).text).toBe('written by W2 2222');
  }, 15_000);
});

describe('a file system that reuses inode numbers', () => {
  it('a lock that replaced ours under the same inode is still not ours: its token differs', async () => {
    const { dir, key, plain, s, lock } = await session();
    const a = await hookedStore('A', { dir, key }, true);
    const b = await hookedStore('B', { dir, key }, true);
    const bCreated = deferred();
    const aDone = deferred();
    let looksB = 0;
    let bAnswer: Promise<string> | undefined;
    hook = async (writer, op, path) => {
      if (path !== lock) return;
      if (writer === 'B' && op === 'created') bCreated.resolve();
      // B, holding the lock it took, waits to write until A has made its check.
      if (writer === 'B' && op === 'lstat' && ++looksB === 3) await aDone.promise;
      // A stalls just before its check; meanwhile its lock looks stale and B takes it.
      if (writer === 'A' && op === 'lstat' && bAnswer === undefined) {
        lookStale(lock);
        bAnswer = answer(b.append(s, 1, [note('written by B 2222')]));
        await bCreated.promise;
      }
    };
    const a1 = await answer(a.append(s, 1, [note('written by A 1111')]));
    aDone.resolve();
    expect(a1).toBe('locked-timeout');
    expect(await bAnswer).toBe('2');
    expect(existsSync(lock)).toBe(false); // A's release never removed B's lock; B removed its own
    const log = await plain.load(s);
    expect(log.seq).toBe(2);
    expect((log.entries[1] as { text: string }).text).toBe('written by B 2222');
  }, 15_000);

  it('after its write, a writer whose lock was replaced under the same inode answers lock-lost and leaves the new lock', async () => {
    const { dir, key, plain, s, lock } = await session();
    const a = await hookedStore('A', { dir, key }, true);
    let replaced = false;
    hook = async (writer, op, path) => {
      if (writer === 'A' && op === 'sync' && path.endsWith('.jsonl') && !replaced) {
        replaced = true;
        rmSync(lock);
        writeFileSync(lock, 'another-writers-token', { mode: 0o600 });
      }
    };
    expect(await answer(a.append(s, 1, [note('written by A 1111')]))).toBe('lock-lost');
    expect(existsSync(lock)).toBe(true);
    rmSync(lock);
    expect((await plain.load(s)).seq).toBe(2);
  });

  it('the stale takeover leaves a lock that replaced the stale one, though device, inode and age match', async () => {
    const { dir, key, s, lock } = await session();
    writeFileSync(lock, 'a-dead-writers-token', { mode: 0o600 });
    lookStale(lock);
    const staleAt = Date.now() / 1000 - 31;
    utimesSync(lock, staleAt, staleAt);
    const w = await hookedStore('W', { dir, key }, true);
    let looks = 0;
    hook = async (writer, op, path) => {
      if (writer !== 'W' || op !== 'lstat' || path !== lock) return;
      looks++;
      if (looks === 2) {
        // Between W's two looks, a live writer replaced the dead lock — same (reused) inode, the
        // same age to the millisecond — and only its token tells them apart.
        rmSync(lock);
        writeFileSync(lock, 'a-live-writers-token', { mode: 0o600 });
        utimesSync(lock, staleAt, staleAt);
      }
      if (looks === 3) utimesSync(lock, Date.now() / 1000, Date.now() / 1000); // it is live
    };
    expect(await answer(w.append(s, 1, [note('written by W 3333')]))).toBe('locked-timeout');
    expect(existsSync(lock)).toBe(true);
  }, 15_000);
});

describe('a lock whose token cannot be written', () => {
  it('is removed at once, so the next append does not wait for it to look stale', async () => {
    const { dir, key, plain, s, lock } = await session();
    const a = await hookedStore('A', { dir, key });
    hook = async (writer, op, path) => {
      if (writer === 'A' && op === 'write' && path === lock)
        throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    };
    await expect(a.append(s, 1, [note('written by A 1111')])).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(existsSync(lock)).toBe(false);
    const started = performance.now();
    expect(await answer(plain.append(s, 1, [note('written by B 2222')]))).toBe('2');
    expect(performance.now() - started).toBeLessThan(1_000); // not the 2 s wait, nor 30 s stale
  });
});
