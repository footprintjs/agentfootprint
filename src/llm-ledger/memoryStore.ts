/**
 * llm-ledger/memoryStore — the in-process adapter: for tests and a host that keeps the log in memory.
 *
 * Pattern: the port's second adapter, under the file store's caps and the
 *          same admission (`store.ts` · `admitBatch`), so one contract suite
 *          runs on both and gives the same answers.
 * Role:    each session is an array of entries in a `Map`. An entry is kept as
 *          the copy admission parsed from its canonical JSON (a clone that
 *          also refuses what JSON cannot hold), deep-frozen; a load hands out
 *          a frozen array of those entries.
 * Emits:   N/A.
 *
 * Nothing survives the process, and there is no MAC: a memory store is as
 * trustworthy as the process that holds it. One `append` runs to completion
 * before the next starts (it awaits nothing between its compare and its
 * write), which is the compare-and-swap within one process.
 */
import { LedgerStoreError, admitBatch, checkRoom } from './store.js';
import type { LedgerLog, LedgerStore } from './store.js';
import { isSessionId } from './session.js';
import type { LedgerEntry } from './types.js';

/** A new, empty in-memory store. */
export function memoryLedgerStore(): LedgerStore {
  const sessions = new Map<string, { entries: LedgerEntry[]; bytes: number }>();
  return {
    async load(session: string): Promise<LedgerLog> {
      if (!isSessionId(session)) throw new LedgerStoreError('malformed', 'session');
      const held = sessions.get(session);
      const entries = held === undefined ? [] : [...held.entries];
      return Object.freeze({ seq: entries.length, entries: Object.freeze(entries) });
    },
    async append(session, expectedSeq, entries) {
      const batch = admitBatch(session, expectedSeq, entries);
      const held = sessions.get(session) ?? { entries: [], bytes: 0 };
      if (held.entries.length !== expectedSeq) return 'conflict';
      checkRoom(held.entries.length, held.bytes, batch);
      held.entries.push(...batch.entries);
      held.bytes += batch.bytes;
      sessions.set(session, held);
      return held.entries.length;
    },
  };
}
