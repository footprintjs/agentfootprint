/**
 * fileStore — two writers and one lock (case table 4.8; the second read's P1-1).
 *
 * Security: the stale rule reads the wall clock, so a lock can be taken over from a writer that is
 * still running, and two waiters on one dead lock can both take it. These are the reviewer's two
 * reproductions, with the interleaving forced by hooks on `node:fs/promises` (one hooked module
 * instance per writer): each ends with AT MOST ONE writer told its seq and a log that still
 * verifies. Also pinned: a writer never removes a lock that is no longer its own, and the stale
 * takeover re-checks the lock it is about to remove.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

type Op = 'lstat' | 'lstat:after' | 'unlink' | 'opened' | 'sync';
/** The test's hook: runs around each call a hooked store makes, by writer, operation and path. */
let hook: (writer: string, op: Op, path: string) => Promise<void> = async () => undefined;

/** A file store whose `node:fs/promises` calls pass through `hook`, labelled `writer`. */
async function hookedStore(
  writer: string,
  options: { dir: string; key: Uint8Array },
): Promise<LedgerStore> {
  vi.resetModules();
  vi.doMock('node:fs/promises', async (real) => {
    const fsp = await real<typeof import('node:fs/promises')>();
    return {
      ...fsp,
      lstat: async (...args: Parameters<typeof fsp.lstat>) => {
        await hook(writer, 'lstat', String(args[0]));
        const stat = await fsp.lstat(...args);
        await hook(writer, 'lstat:after', String(args[0]));
        return stat;
      },
      unlink: async (...args: Parameters<typeof fsp.unlink>) => {
        await hook(writer, 'unlink', String(args[0]));
        return fsp.unlink(...args);
      },
      open: async (...args: Parameters<typeof fsp.open>) => {
        const handle = await fsp.open(...args);
        const path = String(args[0]);
        await hook(writer, 'opened', path);
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
      if (op === 'opened') (writer === 'W1' ? w1Acquired : w2Acquired).resolve();
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
