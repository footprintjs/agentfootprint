/**
 * llm-ledger/queue — one FIFO per session, in one process.
 *
 * Pattern: a promise chain per session key. A call waits for the calls of its session queued
 *          before it; calls of other sessions do not wait for it. Across processes the store's seq
 *          decides (`conflict`), not this queue.
 * Role:    why two calls of one ledger never race each other's appends: the second loads the log
 *          the first left.
 * Emits:   N/A.
 *
 * At most `maxQueued` calls of one session wait at once; one more is answered `busy` at once,
 * without running. A call that fails does not stop the queue.
 */
import { LEDGER_LIMITS as L } from './limits.js';

/** A per-session FIFO. */
export interface LedgerQueue {
  /** Runs `work` after every earlier call of `session`; `busy` when too many wait. */
  run<T>(session: string, work: () => Promise<T>, busy: () => T): Promise<T>;
}

/** A new, empty queue. */
export function sessionQueue(maxQueued: number = L.maxQueued): LedgerQueue {
  const tails = new Map<string, { tail: Promise<unknown>; waiting: number }>();
  return {
    run<T>(session: string, work: () => Promise<T>, busy: () => T): Promise<T> {
      const lane = tails.get(session) ?? { tail: Promise.resolve(), waiting: 0 };
      if (lane.waiting >= maxQueued) return Promise.resolve(busy());
      lane.waiting++;
      const result = lane.tail.then(work, work);
      lane.tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(session, lane);
      void lane.tail.then(() => {
        lane.waiting--;
        if (lane.waiting === 0 && tails.get(session) === lane) tails.delete(session);
      });
      return result;
    },
  };
}
