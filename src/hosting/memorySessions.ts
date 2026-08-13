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
 */

import { envelopeOwner } from './envelope.js';
import type {
  CheckpointEnvelope,
  SessionLifecycle,
  SessionListOptions,
  SessionListPage,
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
    persist: (sessionId, envelope) => {
      stored.set(sessionId, envelope);
      const owner = envelopeOwner(envelope);
      // WRITE ONCE. An owner is a fact about the conversation, established by
      // the first turn that signed for it, and no later write moves it:
      //
      //  - a turn that names no owner does not ERASE one, or a single leaner
      //    identity would silently drop the session out of its owner's list;
      //  - a turn that names a DIFFERENT one does not TAKE it, or ownership
      //    transfers by writing — which is the whole point of an index nobody
      //    can declare into. A store that let the last writer win would undo
      //    every ownership check made against it, one turn later.
      //
      // The composer refuses a foreign turn long before this line is reached;
      // this is the store keeping its own promise, for every caller that holds
      // it directly.
      if (owner !== undefined && !owners.has(sessionId)) owners.set(sessionId, owner);
      return Promise.resolve();
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
  };
}
