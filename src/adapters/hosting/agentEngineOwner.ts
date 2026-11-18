/**
 * agentEngineOwner — who signed an Agent Engine conversation, and which id a
 * listing may hand out for it.
 *
 * Two questions `agentEngineSessions` answers from what the service kept, put
 * in one small module because both are about reading an OLD row honestly.
 *
 * ── Who signed it: a write-once owner key ───────────────────────────────────
 * The service pins `Session.userId` at create and never moves it, so a
 * conversation whose first turn was anonymous sits under the anonymous
 * placeholder forever. Its owner used to be read out of the newest envelope
 * only — and one anonymous turn after alice signed replaced that envelope, so
 * the next signer was accepted as if nobody owned it (r3-56-adapters-hosting-2).
 *
 * So the owner is now kept in its own state key, {@link OWNER_KEY}:
 *
 *   | stored key   | meaning                                               |
 *   |--------------|-------------------------------------------------------|
 *   | `''`         | began with no owner; nobody has signed yet            |
 *   | `'alice'`    | alice signed first, and owns it                       |
 *   | absent       | written before the key existed — see below            |
 *
 * A signed turn writes it in the same appended delta as its envelope; an
 * anonymous turn never writes it, and a state delta merges by top-level key,
 * so nothing an anonymous turn stores can erase it. A reader that predates the
 * key reads only the envelope and the id keys, so it ignores this one.
 *
 * A session without the key cannot always say whose it is. When its envelope
 * names somebody, that is the owner (the rule as it was). When it names
 * nobody, the record does not say whether somebody signed and was erased, so a
 * SIGNED turn is refused with the one not-found — read in the direction that
 * refuses. An anonymous turn on it is written exactly as before.
 *
 * Stated limit, unchanged: two signers writing to one unsigned conversation at
 * the same moment both read `''`, and the later write wins. No service-side
 * precondition is known that would close that window.
 *
 * ── Which id a listing hands out ────────────────────────────────────────────
 * A session written before the store carried the caller's own id
 * (`SESSION_ID_KEY`) has only its resource id, and the resource id is a fold:
 * for a rewritten id it no longer addresses the row (`safeResourceId` excludes
 * its own `id-` prefix from the pass-through). Listing it handed out an id that
 * opened nothing (r3-56-adapters-hosting-3). Now such a row is listed under an
 * id only when that id provably folds back onto the row; otherwise it is left
 * out, because a listing that names a conversation nobody can open is telling
 * the caller something false.
 */

import { envelopeConversationId, envelopeOwner } from '../../hosting/envelope.js';
import { SessionNotFoundError } from '../../hosting/errors.js';
import { safeResourceId, type VertexSession } from '../google/aiPlatform.js';

/** The `sessionState` key that keeps who signed the conversation first. */
export const OWNER_KEY = 'agentfootprint.owner';

/** Where in `sessionState` the two readers below look. */
export interface StateKeys {
  /** The envelope's key (`SESSION_STATE_KEY`). */
  readonly envelope: string;
  /** The caller's own session id's key (`SESSION_ID_KEY`). */
  readonly sessionId: string;
  /** The `userId` an anonymous conversation is created under. */
  readonly anonymous: string;
}

/**
 * Who already signed for an EXISTING session, or `undefined` when nobody has.
 *
 * @throws Error when the session exists but its `userId` cannot be read: the
 *   service requires one at create, so an absent `userId` means the row's
 *   fields are not readable yet (another writer's create still settling), not
 *   that nobody owns it — the port's `unreadable-is-not-absent` law, applied to
 *   ownership. Nothing is written; the turn may be retried.
 * @throws SessionNotFoundError when the session predates {@link OWNER_KEY},
 *   sits under the anonymous placeholder and its envelope names nobody — or
 *   when the key holds something that is not text. Either way the record
 *   cannot say whose it is.
 */
export function signerOf(
  session: VertexSession | undefined,
  sessionId: string,
  keys: StateKeys,
  adapter: string,
): string | undefined {
  const userId = session?.userId;
  if (typeof userId !== 'string' || userId === '') {
    throw new Error(
      `[hosting] ${adapter} could not determine who owns session "${sessionId}". The session ` +
        `exists but came back without a userId, so this store cannot tell an unowned ` +
        `conversation from somebody else's — and it refuses rather than appending your turn ` +
        `into a session that may not be yours. Nothing was written. This is transient ` +
        `(another writer's create is still settling): retry the turn.`,
    );
  }
  if (userId !== keys.anonymous) return userId;
  const state = session?.sessionState ?? {};
  const kept = state[OWNER_KEY];
  if (typeof kept === 'string') return kept === '' ? undefined : kept;
  if (kept !== undefined) throw new SessionNotFoundError(sessionId);
  const stored = state[keys.envelope];
  const named = stored !== null && typeof stored === 'object' ? envelopeOwner(stored) : undefined;
  if (named !== undefined) return named;
  throw new SessionNotFoundError(sessionId);
}

/**
 * The id a listing may hand out for `session` — one that opens it — or
 * `undefined` when no id this store can name would.
 *
 * In order: the caller's own id when the row carries it; the resource id when
 * it is still a fixed point of the fold (a pre-carry id the fold left alone);
 * the conversation's own `conversationId` when it folds back onto exactly this
 * resource (a standing agent names a signed conversation by its session id).
 */
export function listedSessionId(session: VertexSession, keys: StateKeys): string | undefined {
  const state = session.sessionState ?? {};
  const carried = state[keys.sessionId];
  if (typeof carried === 'string' && carried !== '') return carried;
  const resource = lastSegment(session.name);
  if (resource === '') return undefined;
  if (safeResourceId(resource) === resource) return resource;
  const named = envelopeConversationId(state[keys.envelope]);
  return named !== undefined && safeResourceId(named) === resource ? named : undefined;
}

/** The id out of a resource name, which is everything after the last `/`. */
function lastSegment(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  const at = name.lastIndexOf('/');
  return at === -1 ? name : name.slice(at + 1);
}
