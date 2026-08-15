/**
 * hosting/memorySessions — conversations in a Map.
 *
 * The smallest thing that satisfies `SessionLifecycle`, for tests and for local
 * development where a Redis is ceremony you have not earned yet. It is exactly
 * as durable as the process: restart and every conversation is gone.
 *
 * That is not a shortcoming to apologise for, it is the point of the port. Swap
 * this for a store that survives a restart and the standing agent is unchanged
 * — which is also how the "a crashed process resumes the conversation" test is
 * written: keep the store, throw away everything else, and watch the
 * conversation come back through the envelope alone.
 *
 * The next step up ships beside this one: `sqliteSessions({ file })` is the same
 * port in a file, with nothing to install.
 *
 * ── The owner index (9.26.0) ────────────────────────────────────────────────
 * It also implements the two OPTIONAL members `listByUser` / `ownerOf`, which
 * is what lets a host answer `{ op: 'session-list' }` for a verified caller.
 * The owner is DERIVED at persist time from the stored conversation's own
 * `identity.principal` (`envelopeOwner`) — never declared by a caller, because
 * a store that let you state an owner is a store where owning somebody's
 * session is a matter of asking. A conversation that ran anonymously has no
 * owner and appears in nobody's list.
 *
 * Since 9.36.1 the owner rule is not written out here at all: it is
 * `resolveSessionOwner`, shared with every other store, because four stores
 * each spelling the same rule in their own dialect is how all four came to be
 * missing the same half of it.
 */

import { envelopeOwner } from './envelope.js';
import { resolveSessionOwner } from './sessionOwnership.js';
import { DEFAULT_SWEEP_LIMIT } from './types.js';
import type {
  CheckpointEnvelope,
  SessionLifecycle,
  SessionListOptions,
  SessionListPage,
  SessionRetention,
  SessionSweepOptions,
  SessionSweepResult,
} from './types.js';

/** How many rows one `listByUser` page carries when the caller names no limit. */
const DEFAULT_PAGE = 50;

/**
 * An in-process session store.
 *
 * @example
 *   const sessions = memorySessions();
 *   await standingAgent({ agent, sessions, host: nodeHost({ port: 8080 }) });
 */
export function memorySessions(): SessionLifecycle {
  const stored = new Map<string, CheckpointEnvelope>();
  /** session id → derived owner. Kept beside the envelopes rather than
   *  recomputed per listing: a listing walks every session this process holds,
   *  and re-deriving on each one would make a sidebar O(all conversations)
   *  worth of JSON reads. */
  const owners = new Map<string, string>();

  /** How many messages a transcript of this envelope would carry — the count a
   *  listing row states. Derived from the same stored shape the transcript
   *  reads, so the number and the page can never disagree. */
  const countOf = (envelope: CheckpointEnvelope): number => {
    const data = envelope.data as { history?: unknown; conversation?: { history?: unknown } };
    const history = envelope.format === 'flowchart-v1' ? data.conversation?.history : data.history;
    if (!Array.isArray(history)) return 0;
    let count = 0;
    for (const message of history) {
      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;
      if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content) {
        count += 1;
      }
    }
    return count;
  };

  return {
    hydrate: (sessionId) => Promise.resolve(stored.get(sessionId)),
    // `async` so the ownership refusal below arrives as a REJECTION. This
    // method returns a promise on the happy path, and one that threw
    // synchronously on the sad one would need two error handlers from every
    // caller — and the one they forget is the one that fires at 3am. The
    // sibling file store states the same rule over its three methods.
    // eslint-disable-next-line @typescript-eslint/require-await
    persist: async (sessionId, envelope) => {
      // DECIDE BEFORE WRITING. The order is the whole fix (9.36.1): this used
      // to store the envelope first and then guard only the index, so a turn
      // signed by somebody else kept the first writer's `owner` and stored the
      // second writer's entire conversation — index and payload naming
      // different people, and the one the index named reading the other's
      // conversation. `resolveSessionOwner` is the one rule; see its table.
      //
      // A conflict throws out of here having touched nothing. Single-threaded
      // is all the atomicity a `Map` needs: no `await` sits between the read
      // and the writes below, so nothing can interleave into them.
      const owner = resolveSessionOwner(sessionId, owners.get(sessionId), envelopeOwner(envelope));
      stored.set(sessionId, envelope);
      if (owner !== undefined) owners.set(sessionId, owner);
    },
    listByUser: (userId: string, options?: SessionListOptions): Promise<SessionListPage> => {
      const rows = [];
      for (const [sessionId, owner] of owners) {
        if (owner !== userId) continue;
        const envelope = stored.get(sessionId);
        if (envelope === undefined) continue;
        rows.push({
          sessionId,
          savedAt: envelope.savedAt,
          format: envelope.format,
          messageCount: countOf(envelope),
        });
      }
      // Newest first — the order a sidebar draws in, and the one every listing
      // in this package promises.
      rows.sort((a, b) => b.savedAt - a.savedAt);
      const limit = Math.max(1, Math.floor(options?.limit ?? DEFAULT_PAGE));
      // The cursor is the OFFSET, as a string. Honest for a Map that is only
      // ever read whole: there is nothing cheaper to seek by, and a cursor
      // that pretended to be a key would skip rows when one is evicted.
      const from = Number.parseInt(options?.cursor ?? '0', 10);
      const start = Number.isFinite(from) && from > 0 ? from : 0;
      const page = rows.slice(start, start + limit);
      const next = start + page.length;
      return Promise.resolve({
        sessions: page,
        ...(next < rows.length && { cursor: String(next) }),
      });
    },
    ownerOf: (sessionId: string): Promise<string | undefined> =>
      // `undefined` for "no such session" AND for "a session nobody signed
      // for" — the deliberate ambiguity the composer's one not-found rests on.
      Promise.resolve(stored.has(sessionId) ? owners.get(sessionId) : undefined),

    // ── Retention (9.42.0) ──────────────────────────────────────────────
    //
    // `'this-store'`, obviously: the conversations are two Maps in this
    // process, and nothing else is going to delete from them. Worth
    // implementing rather than leaving absent even though a restart forgets
    // everything anyway — this store is what a test and a local run use, so it
    // is where a retention job gets WRITTEN, and a job that cannot be
    // exercised until it reaches production is a job that is first exercised
    // in production.
    retention: (): SessionRetention => ({
      deletedBy: 'this-store',
      // eslint-disable-next-line @typescript-eslint/require-await
      forgetOlderThan: async (
        before: number,
        sweepOptions?: SessionSweepOptions,
      ): Promise<SessionSweepResult> => {
        const limit = Math.max(1, Math.floor(sweepOptions?.limit ?? DEFAULT_SWEEP_LIMIT));
        let forgotten = 0;
        let more = false;
        for (const [sessionId, envelope] of stored) {
          if (envelope.savedAt >= before) continue;
          if (forgotten >= limit) {
            // One older session was found past the limit, which is all `more`
            // claims. Stopping here rather than counting the rest keeps a
            // sweep O(sessions) instead of making it walk the whole map twice
            // to produce a number nobody reads.
            more = true;
            break;
          }
          // Both maps, together. `forget`-shaped deletion that left the owner
          // index behind would leave a listing pointing at conversations
          // nobody can open — the same law the conformance battery holds
          // `forget` to.
          stored.delete(sessionId);
          owners.delete(sessionId);
          forgotten += 1;
        }
        return { forgotten, more };
      },
    }),
  };
}
