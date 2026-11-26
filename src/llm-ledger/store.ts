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
 * which this release does not have. The map it keeps grows by one number per
 * session the instance touches.
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
 * other code from an adapter.
 */
export type LedgerStoreCode =
  | 'mac-mismatch'
  | 'torn-line'
  | 'malformed'
  | 'unsafe-file'
  | 'too-large'
  | 'locked-timeout'
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
 * Bytes a line adds around its entry's canonical JSON:
 * `{"entry":` (9) + `,"mac":"` (8) + 64 hex + `"}` (2) + the newline (1).
 */
export const LINE_OVERHEAD_BYTES = 84;

/**
 * The canonical-JSON bounds of one stored LINE, `{ entry, mac }`. Every bound is stated, because
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

/** An entry's own bounds: each a little inside its line's (the line adds one object and the MAC). */
export function entryCanonical(): CanonicalJsonOptions {
  return {
    maxBytes: LINE_CANONICAL.maxBytes - LINE_OVERHEAD_BYTES,
    maxNodes: LINE_CANONICAL.maxNodes - 10,
    maxFields: LINE_CANONICAL.maxFields - 10,
    maxDepth: LINE_CANONICAL.maxDepth - 1,
    maxSortWork: LINE_CANONICAL.maxSortWork - 10_000,
  };
}

/** Bytes of the line an entry is stored as, given its canonical JSON. */
export function lineBytesOf(entryText: string): number {
  return utf8Bytes(entryText) + LINE_OVERHEAD_BYTES;
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
 * Admit one entry for position `seq`: its canonical JSON (own data only — a
 * getter is never called), a fresh copy parsed from it, its shape, its size.
 */
export function admitEntry(value: unknown, seq: number): LedgerAdmitted {
  let text: string;
  try {
    text = canonicalizeJson(value, entryCanonical());
  } catch (error) {
    if (error instanceof CanonicalJsonError && error.code === 'output-bytes')
      throw new LedgerStoreError('too-large');
    throw new LedgerStoreError('malformed', 'entry');
  }
  const entry = checkEntryAt(JSON.parse(text), seq);
  return { entry: deepFreeze(entry), text, lineBytes: lineBytesOf(text) };
}

/** A batch ready to append: entries, their canonical JSON, and the bytes its lines take. */
export interface LedgerBatch {
  readonly entries: readonly LedgerEntry[];
  readonly texts: readonly string[];
  readonly bytes: number;
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
  const admitted: LedgerAdmitted[] = [];
  for (let i = 0; i < entries.length; i++) {
    const item = Object.getOwnPropertyDescriptor(entries, i);
    if (item === undefined || !('value' in item))
      throw new LedgerStoreError('malformed', 'entries');
    admitted.push(admitEntry(item.value, (expectedSeq as number) + i + 1));
  }
  return Object.freeze({
    entries: Object.freeze(admitted.map((a) => a.entry)),
    texts: Object.freeze(admitted.map((a) => a.text)),
    bytes: admitted.reduce((sum, a) => sum + a.lineBytes, 0),
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

/** `store`, refusing a load below the highest seq this instance has seen for that session. */
export function withHighWater(store: LedgerStore): LedgerStore {
  const seen = new Map<string, number>();
  const raise = (session: string, seq: number): void => {
    if (seq > (seen.get(session) ?? 0)) seen.set(session, seq);
  };
  return {
    async load(session) {
      const log = await store.load(session);
      if (log.seq < (seen.get(session) ?? 0)) throw new LedgerStoreError('rolled-back');
      raise(session, log.seq);
      return log;
    },
    async append(session, expectedSeq, entries) {
      // A caller behind what this instance has seen gets the answer an honest store gives —
      // without asking a store that may have been rolled back to exactly that seq.
      if (typeof expectedSeq === 'number' && expectedSeq < (seen.get(session) ?? 0))
        return 'conflict';
      const result = await store.append(session, expectedSeq, entries);
      if (result !== 'conflict') raise(session, result);
      return result;
    },
  };
}
