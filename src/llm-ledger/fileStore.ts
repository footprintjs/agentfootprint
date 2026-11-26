/**
 * llm-ledger/fileStore — one file per session, one MAC-chained JSON line per entry. POSIX only.
 *
 * Pattern: the port's file adapter; the one file of this folder (with the
 *          command line's, later) that imports Node. Every line is
 *          `{"entry":…,"mac":"<64 hex>"}` in canonical JSON, where the MAC is
 *          HMAC-SHA-256 under the host's key over
 *          `canonicalizeJson({ session, seq, prev, entry })` and `prev` is the
 *          previous line's MAC (`''` for seq 1).
 * Role:    the crash-safe, tamper-evident log on a host. `session` in the MAC
 *          refuses a line or a whole file copied from another session; `prev`
 *          refuses a removed or reordered line; `seq` refuses a renumbering.
 * Emits:   N/A.
 *
 * ## What is refused, and how (thrown `LedgerStoreError` codes)
 *
 *   - `mac-mismatch` — any line that does not carry its MAC: an edited byte,
 *     a swapped, removed or foreign line, a file renamed to another session, a
 *     line that is not canonical, or one that is not JSON before the last.
 *     ONE bad line refuses the whole session; nothing is loaded in part.
 *   - `torn-line` — the file does not end with a newline, its last line is not
 *     JSON, or it is empty. It is never truncated and there is no repair: the
 *     host inspects the file and opens a new session.
 *   - `malformed` — a line whose MAC verifies but whose entry is not one of
 *     the shapes (`entries.ts`), or an append the shapes refuse.
 *   - `unsafe-file` — the directory is a symbolic link, another user's, or
 *     writable by group or others; a session file or a lock is a symbolic
 *     link (`O_NOFOLLOW`), not a regular file, has another hard link, another
 *     owner, or any group or other permission bit. The directory is created
 *     0700 and files 0600 — the rule `footprintjs/sinks` follows for its file.
 *   - `too-large` — past a cap of `limits.ts`; a file larger than the log cap
 *     is refused before it is read.
 *   - `locked-timeout` — another writer held the lock for the whole wait.
 *
 * Any other operating-system error (a full disk, an I/O error) propagates as
 * it is: it is not a statement about the log's integrity.
 *
 * ## Across processes
 *
 * `append` takes `<session>.lock` with `wx` (`O_EXCL`), reads the last line,
 * compares seqs, writes the whole batch with one append and `fsync`s it, then
 * removes the lock. It waits at most `lockWaitMs`, then fails with
 * `locked-timeout`; a lock older than `lockStaleMs` was left by a writer that
 * died and is removed and taken again through the same `wx`. `append` reads
 * the TAIL only — the whole chain is verified by `load`, which every attempt
 * makes first.
 *
 * `load` takes no lock, so it can meet another process's append half-written:
 * a tail without its newline (or a file just created and still empty). Only
 * then does it look at the lock: it waits while a writer holds it (at most
 * `lockWaitMs`) and reads once more. A tail still torn after that is
 * `torn-line`. A load never takes part of a line for a whole one.
 *
 * ## The key, and what the MAC does not do
 *
 * The key is a `Uint8Array` of at least 32 bytes that the host hands in; it is
 * copied once and never written, logged or returned. The MAC protects
 * INTEGRITY, not secrecy: the log is kept on the host unencrypted. A saved
 * earlier copy of the file, restored, verifies (see `store.ts` ·
 * `withHighWater`). The owner check compares with `uid`, which the host
 * passes (this folder never reads `process`); a wrong `uid` can only refuse.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { canonicalizeJson } from 'foottrace/canonical-json';

import { LEDGER_LIMITS as L } from './limits.js';
import { isSessionId } from './session.js';
import { LINE_CANONICAL, LedgerStoreError, admitBatch, checkEntryAt, checkRoom } from './store.js';
import type { LedgerBatch, LedgerLog, LedgerStore } from './store.js';
import type { LedgerEntry } from './types.js';
import { deepFreeze } from './entries.js';

/** What a file store needs: where, the host's key, and the host's own user id. */
export interface FileLedgerStoreOptions {
  /** The directory holding `<session>.jsonl`; created 0700 when missing. */
  readonly dir: string;
  /** At least 32 bytes. Copied once; never written anywhere. */
  readonly key: Uint8Array;
  /** The user every file must belong to: the host's own (`process.getuid()`). */
  readonly uid: number;
}

const MAC = /^[0-9a-f]{64}$/;
/** How often a waiting append looks at the lock again. */
const LOOK_MS = 10;

const codeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

/** The timer decides when to LOOK; the clock (`lockWaitMs` from the first try) decides whether the wait is over. */
const nextLook = (ms: number): Promise<'look'> =>
  new Promise((resolveLook) => setTimeout(() => resolveLook('look'), ms));

/** A refusal for a path the store must not open: a link, a directory, a device. */
function unsafeOpen(error: unknown): never {
  const code = codeOf(error);
  if (code === 'ELOOP' || code === 'EMLINK' || code === 'EISDIR' || code === 'ENXIO')
    throw new LedgerStoreError('unsafe-file', 'file');
  throw error;
}

/** Lines of a log's bytes, without their newlines; the bytes end with one. */
function linesOf(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  for (let start = 0; start < bytes.length; ) {
    const end = bytes.indexOf(0x0a, start);
    lines.push(bytes.subarray(start, end));
    start = end + 1;
  }
  return lines;
}

const STRICT_UTF8 = (): TextDecoder => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * One line's wrapper: `'not-json'` when it is not JSON at all, `'not-ours'`
 * when it is JSON but not exactly a canonical `{ entry, mac }`.
 */
function parseLine(bytes: Uint8Array): { entry: unknown; mac: string } | 'not-json' | 'not-ours' {
  let text: string;
  let value: unknown;
  try {
    text = STRICT_UTF8().decode(bytes);
    value = JSON.parse(text);
  } catch {
    return 'not-json';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not-ours';
  const wrapper = value as Record<string, unknown>;
  const keys = Object.keys(wrapper);
  if (keys.length !== 2 || !Object.hasOwn(wrapper, 'entry') || typeof wrapper.mac !== 'string')
    return 'not-ours';
  if (!MAC.test(wrapper.mac)) return 'not-ours';
  try {
    if (canonicalizeJson(wrapper, LINE_CANONICAL) !== text) return 'not-ours';
  } catch {
    return 'not-ours';
  }
  return { entry: wrapper.entry, mac: wrapper.mac };
}

/** 32 bytes of a MAC's hex. */
function macBytes(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** A file store over `dir`. Refuses at construction off POSIX, and a key or uid it cannot use. */
export function fileLedgerStore(options: FileLedgerStoreOptions): LedgerStore {
  if (typeof constants.O_NOFOLLOW !== 'number' || sep !== '/')
    throw new TypeError('fileLedgerStore: runs on POSIX only (O_NOFOLLOW and file modes)');
  if (typeof options !== 'object' || options === null)
    throw new TypeError('fileLedgerStore: options must be { dir, key, uid }');
  const { dir: dirOption, key: keyOption, uid } = options;
  if (typeof dirOption !== 'string' || dirOption === '' || dirOption.includes('\0'))
    throw new TypeError('fileLedgerStore: dir must be a non-empty path');
  if (!(keyOption instanceof Uint8Array) || keyOption.byteLength < L.minKeyBytes)
    throw new RangeError(
      `fileLedgerStore: key must be a Uint8Array of at least ${L.minKeyBytes} bytes`,
    );
  if (!Number.isSafeInteger(uid) || uid < 0)
    throw new TypeError('fileLedgerStore: uid must be the host user id, a whole number');
  const dir = resolve(dirOption);
  const key = new Uint8Array(keyOption); // a copy: the caller's array may change or be wiped
  const NOFOLLOW = constants.O_NOFOLLOW;
  const NONBLOCK = constants.O_NONBLOCK ?? 0;

  const fileOf = (session: string): string => join(dir, `${session}.jsonl`);
  const lockOf = (session: string): string => join(dir, `${session}.lock`);

  // The MAC input is the entry plus its session, seq and `prev`: each bound a little OUTSIDE the
  // line's (`store.ts` · `LINE_CANONICAL`), so every line that reads back has a MAC to compute.
  const macInputBounds = {
    maxBytes: LINE_CANONICAL.maxBytes + 1_024,
    maxNodes: LINE_CANONICAL.maxNodes + 16,
    maxFields: LINE_CANONICAL.maxFields + 16,
    maxDepth: LINE_CANONICAL.maxDepth + 1,
    maxSortWork: LINE_CANONICAL.maxSortWork + 10_000,
  };
  const macOf = (session: string, seq: number, prev: string, entry: unknown): string =>
    createHmac('sha256', key)
      .update(canonicalizeJson({ session, seq, prev, entry }, macInputBounds), 'utf8')
      .digest('hex');

  const macMatches = (session: string, seq: number, prev: string, entry: unknown, mac: string) =>
    timingSafeEqual(macBytes(macOf(session, seq, prev, entry)), macBytes(mac));

  /** A file the store reads or writes: a regular file, one link, ours, no group or other bit. */
  const refuseUnsafe = (stat: Stats, what: string): void => {
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o077) !== 0)
      throw new LedgerStoreError('unsafe-file', what);
  };

  /** The directory: created 0700 when missing; never a link, always ours, never group/other writable. */
  const checkDir = async (): Promise<void> => {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      if (codeOf(error) === 'EEXIST' || codeOf(error) === 'ENOTDIR')
        throw new LedgerStoreError('unsafe-file', 'dir');
      throw error;
    }
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o022) !== 0)
      throw new LedgerStoreError('unsafe-file', 'dir');
  };

  /** Open a session file (never through a link), or `undefined` when there is none. A new file is 0600. */
  const openFile = async (path: string, flags: number): Promise<FileHandle | undefined> => {
    try {
      return await open(path, flags | NOFOLLOW | NONBLOCK, 0o600);
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return undefined;
      return unsafeOpen(error);
    }
  };

  const readAt = async (
    handle: FileHandle,
    position: number,
    length: number,
  ): Promise<Uint8Array> => {
    const out = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(out, read, length - read, position + read);
      if (bytesRead === 0) break; // the file shrank: what is there is what is read
      read += bytesRead;
    }
    return out.subarray(0, read);
  };

  /** Verify a whole log: every line's MAC in order, then its entry's shape. */
  const verify = (session: string, bytes: Uint8Array): LedgerLog => {
    if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a)
      throw new LedgerStoreError('torn-line');
    const lines = linesOf(bytes);
    if (lines.length > L.maxEntries) throw new LedgerStoreError('too-large');
    const entries: LedgerEntry[] = [];
    let prev = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as Uint8Array;
      if (line.length + 1 > L.maxLineBytes) throw new LedgerStoreError('too-large');
      const parsed = parseLine(line);
      if (parsed === 'not-json' && i === lines.length - 1) throw new LedgerStoreError('torn-line');
      if (typeof parsed === 'string' || !macMatches(session, i + 1, prev, parsed.entry, parsed.mac))
        throw new LedgerStoreError('mac-mismatch');
      entries.push(deepFreeze(checkEntryAt(parsed.entry, i + 1)));
      prev = parsed.mac;
    }
    return Object.freeze({ seq: entries.length, entries: Object.freeze(entries) });
  };

  /**
   * What an append needs from the file it extends: the last line, verified
   * against the MAC field of the line before it (that line itself is
   * verified by `load`).
   */
  const readTail = async (
    handle: FileHandle,
    size: number,
    session: string,
  ): Promise<{ seq: number; prev: string }> => {
    const span = Math.min(size, 2 * L.maxLineBytes + 2);
    const tail = await readAt(handle, size - span, span);
    if (tail.length === 0 || tail[tail.length - 1] !== 0x0a)
      throw new LedgerStoreError('torn-line');
    const body = tail.subarray(0, tail.length - 1);
    const lastBreak = body.lastIndexOf(0x0a);
    const whole = size === span; // the tail holds the file from its first byte
    if (lastBreak === -1 && !whole) throw new LedgerStoreError('too-large');
    const last = body.subarray(lastBreak + 1);
    if (last.length + 1 > L.maxLineBytes) throw new LedgerStoreError('too-large');
    const parsed = parseLine(last);
    if (parsed === 'not-json') throw new LedgerStoreError('torn-line');
    if (parsed === 'not-ours') throw new LedgerStoreError('mac-mismatch');
    const claimed = (parsed.entry as { seq?: unknown } | null)?.seq;
    if (!Number.isSafeInteger(claimed) || (claimed as number) < 1)
      throw new LedgerStoreError('mac-mismatch');
    const seq = claimed as number;
    let prev = '';
    if (lastBreak !== -1) {
      const before = lastBreak === 0 ? -1 : body.lastIndexOf(0x0a, lastBreak - 1);
      if (before === -1 && !whole) throw new LedgerStoreError('too-large');
      const previous = parseLine(body.subarray(before + 1, lastBreak));
      if (typeof previous === 'string') throw new LedgerStoreError('mac-mismatch');
      prev = previous.mac;
    }
    // seq 1 has no line before it, and every later line has one.
    if (
      (seq === 1) !== (lastBreak === -1) ||
      !macMatches(session, seq, prev, parsed.entry, parsed.mac)
    )
      throw new LedgerStoreError('mac-mismatch');
    checkEntryAt(parsed.entry, seq);
    return { seq, prev: parsed.mac };
  };

  /** Take the session's lock with `wx`, waiting at most `lockWaitMs`; a stale one is taken over. */
  const takeLock = async (path: string): Promise<{ dev: number; ino: number }> => {
    const deadline = performance.now() + L.lockWaitMs;
    for (;;) {
      try {
        const handle = await open(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | NONBLOCK,
          0o600,
        );
        try {
          const stat = await handle.stat();
          return { dev: stat.dev, ino: stat.ino };
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (codeOf(error) !== 'EEXIST') throw error;
      }
      const held = await lstat(path).catch((error: unknown) => {
        if (codeOf(error) === 'ENOENT') return undefined; // released between the two calls
        throw error;
      });
      if (held !== undefined) {
        refuseUnsafe(held, 'lock');
        if (Date.now() - held.mtimeMs > L.lockStaleMs) {
          // Left by a writer that died: remove it — only if it is still the same lock — and try again.
          const again = await lstat(path).catch(() => undefined);
          if (again !== undefined && again.ino === held.ino && again.mtimeMs === held.mtimeMs)
            await unlink(path).catch((error: unknown) => {
              if (codeOf(error) !== 'ENOENT') throw error;
            });
          if (performance.now() < deadline) continue;
        }
      }
      const left = deadline - performance.now();
      if (left <= 0) throw new LedgerStoreError('locked-timeout');
      await nextLook(Math.min(LOOK_MS, left));
    }
  };

  /** Remove the lock — only if it is still ours (a writer that outlived the stale rule lost it). */
  const releaseLock = async (path: string, ours: { dev: number; ino: number }): Promise<void> => {
    const stat = await lstat(path).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return undefined;
      throw error;
    });
    if (stat !== undefined && stat.dev === ours.dev && stat.ino === ours.ino) await unlink(path);
  };

  /** fsync the directory, so a file just created survives a power loss. */
  const syncDir = async (): Promise<void> => {
    const handle = await open(dir, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  /** Under the lock: compare, then write the batch as one append and fsync it. */
  const appendLocked = async (
    session: string,
    expectedSeq: number,
    batch: LedgerBatch,
  ): Promise<number | 'conflict'> => {
    const path = fileOf(session);
    let handle = await openFile(path, constants.O_RDWR | constants.O_APPEND);
    let stored = { seq: 0, prev: '', size: 0 };
    if (handle !== undefined) {
      try {
        const stat = await handle.stat();
        refuseUnsafe(stat, 'file');
        if (stat.size > L.maxLogBytes) throw new LedgerStoreError('too-large');
        stored = { ...(await readTail(handle, stat.size, session)), size: stat.size };
        if (stored.seq === expectedSeq) checkRoom(stored.seq, stored.size, batch);
      } catch (error) {
        await handle.close();
        throw error;
      }
      if (stored.seq !== expectedSeq) {
        await handle.close();
        return 'conflict';
      }
    } else {
      if (expectedSeq !== 0) return 'conflict';
      checkRoom(0, 0, batch);
    }
    let lines = '';
    let prev = stored.prev;
    for (let i = 0; i < batch.entries.length; i++) {
      const mac = macOf(session, expectedSeq + i + 1, prev, batch.entries[i]);
      lines += `${canonicalizeJson({ entry: batch.entries[i], mac }, LINE_CANONICAL)}\n`;
      prev = mac;
    }
    const created = handle === undefined;
    if (handle === undefined) {
      try {
        handle = await openFile(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_APPEND,
        );
      } catch (error) {
        // Another writer made the file without the lock: the stored seq is no longer 0.
        if (codeOf(error) === 'EEXIST') return 'conflict';
        throw error;
      }
      if (handle === undefined) throw new LedgerStoreError('unsafe-file', 'dir');
      try {
        refuseUnsafe(await handle.stat(), 'file');
      } catch (error) {
        await handle.close();
        await unlink(path); // ours: made with O_EXCL a moment ago, under the lock, and still empty
        throw error;
      }
    }
    try {
      const data = new TextEncoder().encode(lines);
      for (let written = 0; written < data.length; ) {
        const { bytesWritten } = await handle.write(data, written, data.length - written);
        if (bytesWritten === 0) throw new Error('fileLedgerStore: the disk took no bytes');
        written += bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (created) await syncDir();
    return expectedSeq + batch.entries.length;
  };

  /** The session file's bytes as they are now, or `undefined` when there is no file. */
  const snapshot = async (session: string): Promise<Uint8Array | undefined> => {
    const handle = await openFile(fileOf(session), constants.O_RDONLY);
    if (handle === undefined) return undefined;
    try {
      const stat = await handle.stat();
      refuseUnsafe(stat, 'file');
      if (stat.size > L.maxLogBytes) throw new LedgerStoreError('too-large');
      return await readAt(handle, 0, stat.size);
    } finally {
      await handle.close();
    }
  };

  /** Wait while a lock is on the session, at most `lockWaitMs`. */
  const waitForWriter = async (session: string): Promise<void> => {
    const deadline = performance.now() + L.lockWaitMs;
    for (;;) {
      const lock = await lstat(lockOf(session)).catch((error: unknown) => {
        if (codeOf(error) === 'ENOENT') return undefined;
        throw error;
      });
      const left = deadline - performance.now();
      if (lock === undefined || left <= 0) return;
      await nextLook(Math.min(LOOK_MS, left));
    }
  };

  return {
    async load(session: string): Promise<LedgerLog> {
      if (!isSessionId(session)) throw new LedgerStoreError('malformed', 'session');
      await checkDir();
      let bytes = await snapshot(session);
      // Loads take no lock, so a tail without its newline may be an append still being written by
      // another process. Wait while a writer holds the lock, then read once more — always, since
      // the writer may have finished between the two reads; a tail still torn is refused.
      if (bytes !== undefined && (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a)) {
        await waitForWriter(session);
        bytes = await snapshot(session);
      }
      if (bytes === undefined) return Object.freeze({ seq: 0, entries: Object.freeze([]) });
      return verify(session, bytes);
    },
    async append(session, expectedSeq, entries) {
      const batch = admitBatch(session, expectedSeq, entries);
      await checkDir();
      const lockPath = lockOf(session);
      const lock = await takeLock(lockPath);
      let outcome: { ok: true; value: number | 'conflict' } | { ok: false; error: unknown };
      try {
        outcome = { ok: true, value: await appendLocked(session, expectedSeq, batch) };
      } catch (error) {
        outcome = { ok: false, error };
      }
      try {
        await releaseLock(lockPath, lock);
      } catch (error) {
        // A lock that cannot be removed goes stale and is taken over; say it only when nothing worse was said.
        if (outcome.ok) throw error;
      }
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    },
  };
}
