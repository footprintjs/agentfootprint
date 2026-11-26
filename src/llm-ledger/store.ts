/**
 * llm-ledger/store — the store PORT, its one error, and the admission both adapters share.
 *
 * Pattern: port + adapters. `LedgerStore` is OUR shape: `load` gives the
 *          whole session, `append` is a compare-and-swap on its seq. Every
 *          adapter admits a batch through `admitBatch` and measures a line
 *          with `lineBytesOf`, so the two adapters cannot hold different laws.
 * Role:    the trusted side's log. The later stages read it through the port;
 *          the log is never seeded as chart state.
 * Emits:   N/A.
 *
 * ## The contract (one suite runs it on every adapter)
 *
 *   - `seq` is the number of entries. Every kind shares one sequence, 1…n.
 *     An unknown session loads as `{ seq: 0, entries: [] }`.
 *   - `append(session, expectedSeq, entries)` takes entries numbered
 *     `expectedSeq + 1 …`, the first entry of a session (seq 1) an `opened`
 *     and no other. It returns the new last seq, or `'conflict'` — writing
 *     nothing — when the stored seq is not `expectedSeq`.
 *   - Everything else is THROWN, never returned: a `LedgerStoreError` with one
 *     closed code. A store that cannot vouch for its bytes has no seq to give;
 *     it is refused, never repaired.
 *   - Order: a malformed batch is refused before the seq is compared; caps are
 *     checked after it (`too-large`).
 *
 * ## The high-water mark
 *
 * `withHighWater(store)` remembers, per session, the highest seq this instance
 * has seen, and refuses a load below it (`rolled-back`). It cannot see a saved
 * earlier copy restored between two processes: that needs a trusted counter,
 * which this release does not have. It remembers at most `maxHighWaterSessions`
 * sessions; past that the least recently used one is forgotten, and a rollback
 * of a forgotten session is no more visible to this instance than to a fresh one.
 */
import { canonicalizeJson, CanonicalJsonError } from 'foottrace/canonical-json';
import type { CanonicalJsonOptions } from 'foottrace/canonical-json';

import { deepFreeze, entryFault } from './entries.js';
import { LEDGER_LIMITS } from './limits.js';
import { isSessionId } from './session.js';
import { utf8Bytes } from './tokens.js';
import type { LedgerEntry } from './types.js';

/** One session's log as a store holds it. */
export interface LedgerLog {
  /** The number of entries: the last entry's seq. */
  readonly seq: number;
  readonly entries: readonly LedgerEntry[];
}

/** The store port. */
export interface LedgerStore {
  load(session: string): Promise<LedgerLog>;
  append(
    session: string,
    expectedSeq: number,
    entries: readonly LedgerEntry[],
  ): Promise<number | 'conflict'>;
}

/**
 * Why a store refused. `rolled-back` comes only from `withHighWater`; every
 * other code from an adapter. `lock-lost` is the one code that says nothing
 * about the log: the append wrote its batch, but another writer took the lock
 * before it finished, so the batch may or may not stand — the caller must
 * reload, never assume either.
 */
export type LedgerStoreCode =
  | 'mac-mismatch'
  | 'torn-line'
  | 'malformed'
  | 'unsafe-file'
  | 'too-large'
  | 'locked-timeout'
  | 'lock-lost'
  | 'rolled-back';

/** A store's refusal: a closed code, and for `malformed` the field — a fixed word, never a value. */
export class LedgerStoreError extends Error {
  readonly code: LedgerStoreCode;
  readonly field: string | undefined;
  constructor(code: LedgerStoreCode, field?: string) {
    super(
      field === undefined ? `llm-ledger store: ${code}` : `llm-ledger store: ${code} (${field})`,
    );
    this.name = 'LedgerStoreError';
    this.code = code;
    this.field = field;
  }
}

/**
 * Bytes a line adds around its entry's canonical JSON, for a batch ending at seq `end`:
 * `{"end":` (7) + the digits of `end` + `,"entry":` (9) + `,"mac":"` (8) + 64 hex + `"}` (2) +
 * the newline (1).
 */
export function lineOverheadBytes(end: number): number {
  return 91 + String(end).length;
}

/**
 * The canonical-JSON bounds of one stored LINE, `{ end, entry, mac }`. Every bound is stated, because
 * three canonicalisations nest and each must hold what the one inside it held:
 *
 *   ENTRY (admission, `entryCanonical`)  ⊂  LINE (this)  ⊂  MAC INPUT (`fileStore.ts`).
 *
 * An entry admitted at the edge of its bounds must still make a line that reads back, and a line
 * that reads back must still have a MAC input to compute — or a crafted entry at an edge would
 * turn a refusal into a raw error. Kept below foottrace's ceilings (100,000 nodes and fields) so
 * the MAC input, a little larger again, fits under them.
 */
export const LINE_CANONICAL = Object.freeze({
  maxBytes: LEDGER_LIMITS.maxLineBytes,
  maxNodes: 99_000,
  maxFields: 99_000,
  maxDepth: 64,
  maxSortWork: 200_000,
});

/**
 * An entry's own bounds, in a batch ending at `end`: each a little inside its line's (the line
 * adds one object, the batch's end and the MAC).
 */
export function entryCanonical(end: number): CanonicalJsonOptions {
  return {
    maxBytes: LINE_CANONICAL.maxBytes - lineOverheadBytes(end),
    maxNodes: LINE_CANONICAL.maxNodes - 10,
    maxFields: LINE_CANONICAL.maxFields - 10,
    maxDepth: LINE_CANONICAL.maxDepth - 1,
    maxSortWork: LINE_CANONICAL.maxSortWork - 10_000,
  };
}

/** Bytes of the line an entry is stored as, given its canonical JSON and its batch's end. */
export function lineBytesOf(entryText: string, end: number): number {
  return utf8Bytes(entryText) + lineOverheadBytes(end);
}

/** An admitted entry: its frozen copy, its canonical JSON and its line's size. */
export interface LedgerAdmitted {
  readonly entry: LedgerEntry;
  readonly text: string;
  readonly lineBytes: number;
}

/**
 * Check a plain parsed entry for position `seq`: its shape, its number, and
 * that seq 1 — and only seq 1 — is the session's `opened`.
 */
export function checkEntryAt(entry: unknown, seq: number): LedgerEntry {
  const fault = entryFault(entry);
  if (fault !== undefined) throw new LedgerStoreError('malformed', fault);
  const e = entry as LedgerEntry;
  if (e.seq !== seq) throw new LedgerStoreError('malformed', 'seq');
  if ((seq === 1) !== (e.kind === 'opened')) throw new LedgerStoreError('malformed', 'kind');
  return e;
}

/**
 * Admit one entry for position `seq` of a batch ending at `end`: its canonical
 * JSON (own data only — a getter is never called), a fresh copy parsed from it,
 * its shape, its line's size.
 */
export function admitEntry(value: unknown, seq: number, end: number = seq): LedgerAdmitted {
  let text: string;
  try {
    text = canonicalizeJson(value, entryCanonical(end));
  } catch (error) {
    if (error instanceof CanonicalJsonError && error.code === 'output-bytes')
      throw new LedgerStoreError('too-large');
    throw new LedgerStoreError('malformed', 'entry');
  }
  const entry = checkEntryAt(JSON.parse(text), seq);
  return { entry: deepFreeze(entry), text, lineBytes: lineBytesOf(text, end) };
}

/** A batch ready to append: entries, their canonical JSON, the bytes its lines take, its last seq. */
export interface LedgerBatch {
  readonly entries: readonly LedgerEntry[];
  readonly texts: readonly string[];
  readonly bytes: number;
  /** The batch's last seq: every one of its lines carries it, so a reader knows the batch is whole. */
  readonly end: number;
}

/**
 * Admit an append's arguments: a session id (checked before any path is
 * formed), a whole `expectedSeq`, and one or more entries numbered from
 * `expectedSeq + 1`. Throws `malformed` or `too-large`; reads no store.
 */
export function admitBatch(session: unknown, expectedSeq: unknown, entries: unknown): LedgerBatch {
  if (!isSessionId(session)) throw new LedgerStoreError('malformed', 'session');
  if (!Number.isSafeInteger(expectedSeq) || (expectedSeq as number) < 0)
    throw new LedgerStoreError('malformed', 'expectedSeq');
  if (!Array.isArray(entries) || entries.length === 0)
    throw new LedgerStoreError('malformed', 'entries');
  if (entries.length > LEDGER_LIMITS.maxEntries) throw new LedgerStoreError('too-large');
  const count = entries.length; // read once: a growing array does not change the batch
  const end = (expectedSeq as number) + count;
  const admitted: LedgerAdmitted[] = [];
  for (let i = 0; i < count; i++) {
    const item = Object.getOwnPropertyDescriptor(entries, i);
    if (item === undefined || !('value' in item))
      throw new LedgerStoreError('malformed', 'entries');
    admitted.push(admitEntry(item.value, (expectedSeq as number) + i + 1, end));
  }
  return Object.freeze({
    entries: Object.freeze(admitted.map((a) => a.entry)),
    texts: Object.freeze(admitted.map((a) => a.text)),
    bytes: admitted.reduce((sum, a) => sum + a.lineBytes, 0),
    end,
  });
}

/** Refuse a batch that would take a session past a cap (`too-large`). */
export function checkRoom(storedSeq: number, storedBytes: number, batch: LedgerBatch): void {
  if (
    storedSeq + batch.entries.length > LEDGER_LIMITS.maxEntries ||
    storedBytes + batch.bytes > LEDGER_LIMITS.maxLogBytes
  )
    throw new LedgerStoreError('too-large');
}

/**
 * `store`, refusing a load below the highest seq this instance has seen for that session. An
 * append is admitted first (a malformed batch is `malformed` here as on the store itself), then
 * compared with the mark. At most `maxSessions` marks are kept, least recently used out.
 */
export function withHighWater(
  store: LedgerStore,
  maxSessions: number = LEDGER_LIMITS.maxHighWaterSessions,
): LedgerStore {
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1)
    throw new RangeError('withHighWater: maxSessions must be a whole number, at least 1');
  const seen = new Map<string, number>(); // insertion order = least recently used first
  const markOf = (session: string): number => {
    const mark = seen.get(session);
    if (mark !== undefined) {
      seen.delete(session); // touched: now the most recently used
      seen.set(session, mark);
    }
    return mark ?? 0;
  };
  const raise = (session: string, seq: number): void => {
    const prior = seen.get(session) ?? 0;
    seen.delete(session);
    seen.set(session, Math.max(seq, prior));
    if (seen.size > maxSessions) seen.delete(seen.keys().next().value as string);
  };
  return {
    async load(session) {
      const log = await store.load(session);
      if (log.seq < markOf(session)) throw new LedgerStoreError('rolled-back');
      raise(session, log.seq);
      return log;
    },
    async append(session, expectedSeq, entries) {
      admitBatch(session, expectedSeq, entries);
      // A caller behind what this instance has seen gets the answer an honest store gives —
      // without asking a store that may have been rolled back to exactly that seq.
      if (expectedSeq < markOf(session)) return 'conflict';
      const result = await store.append(session, expectedSeq, entries);
      if (result !== 'conflict') raise(session, result);
      return result;
    },
  };
}
