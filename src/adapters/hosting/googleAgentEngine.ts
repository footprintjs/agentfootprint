/**
 * agentEngineSessions — conversations in Vertex AI's own session service, so a
 * fleet shares them.
 *
 * `memorySessions()` loses everything on restart and says so. `sqliteSessions()`
 * survives a restart on ONE machine and says so. The row above both — *many
 * containers, one conversation* — is where a managed session service belongs,
 * and on this column that service is the `sessions` collection under a
 * reasoning engine.
 *
 * ── The name, said once ─────────────────────────────────────────────────────
 * The product was **Agent Engine**, is now **Agent Runtime**, and the API
 * resource is still spelled `reasoningEngines`. This factory keeps the name it
 * was designed under; where the product name and the API disagree, the API is
 * the one that has not moved.
 *
 * ── The fit, and it is a good one ───────────────────────────────────────────
 * `Session.sessionState` is an arbitrary JSON `Struct`. A `CheckpointEnvelope`
 * is arbitrary JSON. So the envelope goes in whole, under one key, and comes
 * back whole — no event log to fold, no blob encoding to get wrong, no
 * per-turn append. That is a materially better fit than the other column's
 * session store, which had to learn the hard way that an object handed to an
 * event blob comes back as somebody else's `toString()`.
 *
 * ── The four facts that shaped the code, all read off the installed SDK ─────
 *  1. **`sessions.create` takes a caller-supplied `sessionId`.** So our session
 *     id IS the resource id and `hydrate` is one `get` by name. No mapping
 *     table, no listing to find a conversation.
 *  2. **`create` and `delete` answer a long-running Operation; `get` and
 *     `patch` answer the Session.** Every write here therefore waits for the
 *     operation to report `done` before it returns — a `persist` that returned
 *     early would make the very next `hydrate` a race whose failure mode is
 *     "no conversation", which nobody can tell from a new user.
 *  3. **`Session.userId` is required and immutable.** Our port's
 *     `persist(sessionId, envelope)` carries no user, so one has to be
 *     resolved — see {@link AgentEngineSessionsOptions.userId}. Immutable
 *     means the first write decides forever, which is exactly the ownership
 *     rule this library already enforces in its own stores; here the service
 *     enforces it for us.
 *  4. **`ttl` is input-only with a 24-hour floor**, and `expireTime` always
 *     comes back. Sliding expiry is free; an hour-long TTL is not available at
 *     any price.
 *
 * ── The laws it inherits rather than re-implements ──────────────────────────
 * `checkEnvelope` runs on the way OUT and on the way IN, so an envelope whose
 * `format` this runtime does not know is refused by name, and a session that
 * is PRESENT but unreadable is refused by name too. Only a session that was
 * never written hydrates as `undefined`. A conversation that exists and cannot
 * be read must never be answered with a fresh start — that failure is
 * indistinguishable, from the outside, from a brand-new user.
 */

import { checkEnvelope, envelopeOwner, envelopeTranscript } from '../../hosting/envelope.js';
import { UnreadableEnvelopeError } from '../../hosting/errors.js';
import type {
  CheckpointEnvelope,
  SessionLifecycle,
  SessionListOptions,
  SessionListPage,
} from '../../hosting/types.js';
import {
  awaitOperation,
  buildAiPlatformClient,
  DEFAULT_OPERATION_TIMEOUT_MS,
  googleSdkFailure,
  isAlreadyExists,
  isNotFound,
  resolveEngine,
  safeResourceId,
  type AiPlatformClientLike,
  type AiPlatformConnection,
  type EngineScope,
  type SessionsApi,
  type VertexSession,
} from '../google/aiPlatform.js';

const ADAPTER = 'agentEngineSessions';

/**
 * The `sessionState` key the envelope lives under.
 *
 * One key, namespaced, rather than spreading the envelope's own fields across
 * `sessionState`: the struct belongs to whoever owns the reasoning engine, an
 * agent framework is a guest in it, and a guest that scatters `format` and
 * `data` at the top level collides with the next guest. Namespacing also makes
 * the console readable — one entry that says whose it is.
 */
export const SESSION_STATE_KEY = 'agentfootprint.envelope';

/** Options for {@link agentEngineSessions}. */
export interface AgentEngineSessionsOptions extends AiPlatformConnection {
  /**
   * WHO a session belongs to — required by the service on create, and
   * **immutable** once written.
   *
   * The port hands `persist` a session id and an envelope, never a user, so
   * this is where the missing half comes from. Two spellings:
   *
   *  - a **function**, called with the session id and the envelope about to be
   *    stored. The recommended shape: return `envelopeOwner(envelope)` — the
   *    principal the conversation itself was signed with — so the service's
   *    idea of the owner and this library's own ownership index agree by
   *    construction rather than by coincidence. That is what the default does.
   *  - a **string**, when every conversation in this engine belongs to one
   *    service identity. Honest for a single-tenant deployment and wrong the
   *    moment it is not, which is why it is not the default.
   *
   * The default resolver reads the envelope's own principal and falls back to
   * {@link DEFAULT_USER_ID} for a conversation that ran anonymously. It never
   * invents a per-session user id: the service treats `userId` as the thing
   * you filter a listing by, and minting a unique one per session would make
   * every listing return exactly one row and look like it worked.
   */
  readonly userId?: string | ((sessionId: string, envelope: CheckpointEnvelope) => string);
  /**
   * How long a session lives after its last write, as a duration string the
   * API accepts (`'86400s'`). **The service's own floor is 24 hours** and it
   * rejects anything shorter, so this is a knob for keeping conversations
   * LONGER, never for expiring them sooner.
   *
   * Omit and no `ttl` is sent, which leaves the service's own default
   * expiry in charge.
   */
  readonly ttl?: string;
  /**
   * How long a write waits for its long-running operation before refusing.
   * Default {@link DEFAULT_OPERATION_TIMEOUT_MS} (30s).
   *
   * It refuses rather than returning: a `persist` that reported success on an
   * operation it never saw finish is a conversation that may or may not be
   * there next turn.
   */
  readonly operationTimeoutMs?: number;
}

/** What a conversation that named nobody is stored under. */
export const DEFAULT_USER_ID = 'agentfootprint-anonymous';

/**
 * A session store in Vertex AI's session service.
 *
 * It is a {@link SessionLifecycle} plus the two things a real store owns beyond
 * the port — forgetting, and closing — because the port deliberately asks for
 * two methods and leaves the rest to whoever implements it.
 */
export interface AgentEngineSessions extends SessionLifecycle {
  /** The resource these sessions live under. Useful in an incident. */
  readonly parent: string;
  /** Forget one session. A session that was never there is not an error. */
  forget(sessionId: string): Promise<void>;
  /**
   * Stop using this store. Idempotent, and **final** — reading or writing
   * afterwards refuses by name rather than quietly reconnecting, because a
   * store that reopened behind you would hide a shutdown-ordering bug instead
   * of surfacing it.
   *
   * Nothing is torn down on Google's side: the sessions outlive this process,
   * which is the entire reason to use a managed store.
   */
  close(): void;
}

/**
 * Conversations in Vertex AI's session service — the store that survives a
 * fleet, not just a restart.
 *
 * **Status: contract-shaped and tested; awaiting field use.** Every call is
 * exercised through an injected client and pinned against the really-installed
 * SDK. None of it has yet answered a request from Google in a real project.
 *
 * @example  A standing agent whose conversations are shared across instances
 *   import { standingAgent, nodeHost } from 'agentfootprint/hosting';
 *   import { agentEngineSessions } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agentFactory: () => buildAgent(),
 *     host: nodeHost({ port: 8080 }),
 *     sessions: agentEngineSessions({
 *       project: 'my-project',
 *       location: 'us-central1',
 *       reasoningEngine: '1234567890',
 *     }),
 *   });
 */
export function agentEngineSessions(options: AgentEngineSessionsOptions): AgentEngineSessions {
  const scope: EngineScope = resolveEngine(ADAPTER, options);
  const client: AiPlatformClientLike = buildAiPlatformClient(ADAPTER, options, scope);
  const sessions: SessionsApi = client.projects.locations.reasoningEngines.sessions;
  const operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const resolveUserId = userIdResolver(options.userId);

  let closed = false;
  const open = (verb: string): void => {
    if (!closed) return;
    throw new Error(
      `[hosting] the ${ADAPTER} store for '${scope.parent}' is closed, so it cannot ${verb}. ` +
        `close() is final by design — reconnecting behind you would hide a shutdown-ordering ` +
        `bug rather than surface it. Build a new store if you need one after closing this.`,
    );
  };

  const nameOf = (sessionId: string): string =>
    `${scope.parent}/sessions/${safeResourceId(sessionId)}`;

  return {
    parent: scope.parent,

    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      open('hydrate a session');
      let session: VertexSession | undefined;
      try {
        session = (await sessions.get({ name: nameOf(sessionId) }))?.data;
      } catch (err) {
        // The ONE failure that means "no conversation". Everything else is a
        // failure to READ, which is a different fact and never answered with a
        // fresh start.
        if (isNotFound(err)) return undefined;
        throw googleSdkFailure(ADAPTER, 'sessions.get', err);
      }
      if (session === undefined) return undefined;

      const state = session.sessionState;
      // A session with no state at all was created by something that is not
      // this library — or by us, and never written to. Nothing here ever
      // claimed to be a conversation, so it is an absence.
      if (state === null || state === undefined) return undefined;
      const stored = state[SESSION_STATE_KEY];
      if (stored === undefined) return undefined;
      // Present and not an object: a conversation EXISTS here and this runtime
      // cannot read it. Refused by name, never as `undefined`.
      if (stored === null || typeof stored !== 'object') {
        throw new UnreadableEnvelopeError(stored, sessionId);
      }
      // Validated HERE as well as in the composer, so a refusal points at the
      // store that produced the bytes rather than at whoever read them next.
      return checkEnvelope(stored, sessionId);
    },

    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      open('persist a session');
      // Checked on the way IN as well as out: a session this store could not
      // read back is one it has no business writing.
      const checked = checkEnvelope(envelope, sessionId);
      const name = nameOf(sessionId);
      const body: VertexSession = {
        sessionState: { [SESSION_STATE_KEY]: checked as unknown as Record<string, unknown> },
        ...(options.ttl !== undefined && { ttl: options.ttl }),
      };

      // PATCH first, CREATE on 404 — rather than the other way round.
      //
      // The steady state of a conversation is "it already exists": a session
      // is created once and written on every turn after that. Trying create
      // first would mean one guaranteed-to-fail call per turn for the life of
      // every conversation, and would burn a long-running operation to learn
      // something a patch answers directly.
      try {
        await sessions.patch({
          name,
          // Only the fields we own. Without a mask a patch is a REPLACE, and a
          // replace would drop `userId` — which is immutable, so the service
          // would refuse the write and a conversation would stop persisting.
          updateMask: maskFor(body),
          requestBody: body,
        });
        return;
      } catch (err) {
        if (!isNotFound(err)) throw googleSdkFailure(ADAPTER, 'sessions.patch', err);
      }

      const userId = resolveUserId(sessionId, checked);
      let created;
      try {
        created = await sessions.create({
          parent: scope.parent,
          sessionId: safeResourceId(sessionId),
          requestBody: { ...body, userId },
        });
      } catch (err) {
        // Two writers opened the same conversation at once and the other one
        // won. That is not a failure: the session exists now, which is all
        // this call wanted, so the patch below writes our state onto it.
        if (!isAlreadyExists(err)) throw googleSdkFailure(ADAPTER, 'sessions.create', err);
        try {
          await sessions.patch({ name, updateMask: maskFor(body), requestBody: body });
        } catch (patchErr) {
          throw googleSdkFailure(ADAPTER, 'sessions.patch', patchErr);
        }
        return;
      }
      // OUTSIDE the try on purpose: this refusal is already sanitized and
      // already says what to do, and re-wrapping it would replace a precise
      // diagnosis with a generic one.
      await awaitOperation(
        ADAPTER,
        sessions.operations,
        created?.data,
        `creating session '${sessionId}'`,
        operationTimeoutMs,
      );
    },

    async listByUser(userId: string, listOptions?: SessionListOptions): Promise<SessionListPage> {
      open('list a user’s sessions');
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? DEFAULT_PAGE));
      let page;
      try {
        page = (
          await sessions.list({
            parent: scope.parent,
            // The service's own filter over its own immutable field, with the
            // caller's id as a quoted literal — see quoteFilterValue.
            filter: `user_id=${quoteFilterValue(userId)}`,
            orderBy: 'update_time desc',
            pageSize: limit,
            ...(listOptions?.cursor !== undefined && { pageToken: listOptions.cursor }),
          })
        )?.data;
      } catch (err) {
        throw googleSdkFailure(ADAPTER, 'sessions.list', err);
      }

      const summaries = (page?.sessions ?? []).map((session) => {
        const sessionId = lastSegment(session.name);
        const stored = session.sessionState?.[SESSION_STATE_KEY];
        // A listing must not fail because ONE row is unreadable — a sidebar
        // that 500s over a corrupt conversation is worse than one that shows
        // it with an honest zero. The transcript op reads the envelope itself
        // and refuses there, which is where a reader can act on it.
        const readable = stored !== null && typeof stored === 'object' ? stored : undefined;
        return {
          sessionId,
          savedAt: toMillis(session.updateTime ?? session.createTime),
          format: formatOf(readable),
          messageCount: readable === undefined ? 0 : envelopeTranscript(readable).length,
        };
      });

      const cursor = page?.nextPageToken;
      return {
        sessions: summaries,
        ...(typeof cursor === 'string' && cursor !== '' && { cursor }),
      };
    },

    async ownerOf(sessionId: string): Promise<string | undefined> {
      open('read a session’s owner');
      try {
        const session = (await sessions.get({ name: nameOf(sessionId) }))?.data;
        const userId = session?.userId;
        // `undefined` for "no such session" AND for a session stored under the
        // anonymous placeholder — the deliberate ambiguity the composer's one
        // not-found rests on. A store that answered those differently would
        // hand a caller an oracle for which session ids are real.
        return typeof userId === 'string' && userId !== '' && userId !== DEFAULT_USER_ID
          ? userId
          : undefined;
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw googleSdkFailure(ADAPTER, 'sessions.get', err);
      }
    },

    async forget(sessionId: string): Promise<void> {
      open('forget a session');
      let deleted;
      try {
        deleted = await sessions.delete({ name: nameOf(sessionId) });
      } catch (err) {
        // Already gone is the outcome this asked for.
        if (isNotFound(err)) return;
        throw googleSdkFailure(ADAPTER, 'sessions.delete', err);
      }
      await awaitOperation(
        ADAPTER,
        sessions.operations,
        deleted?.data,
        `deleting session '${sessionId}'`,
        operationTimeoutMs,
      );
    },

    close(): void {
      closed = true;
    },
  };
}

// ─── Internals ───────────────────────────────────────────────────────

/** How many rows one `listByUser` page carries when the caller names no limit. */
const DEFAULT_PAGE = 50;

/**
 * A user id as an AIP-160 string literal — **backslash first, then the quote.**
 *
 * The order is the whole point. This grammar honours backslash escapes, so
 * escaping only the quote leaves the escape character itself free to escape our
 * escape: a user id of `\" OR user_id!=` renders as `user_id="\\" OR user_id!=""`,
 * where `\\` is a literal backslash, the quote after it CLOSES the literal, and
 * the rest of the id is filter syntax the service evaluates. The listing then
 * matches every session with a non-empty user id and hands back other people's
 * conversation ids, timestamps and message counts.
 *
 * The benign case matters too: any id merely ENDING in a backslash swallows the
 * closing quote and the call fails with a malformed-filter 400 whose text
 * {@link googleSdkFailure} withholds — a local error delivered as a censored
 * remote one. Escaping the backslash first fixes both.
 *
 * A user id is caller data on every column of this library. It is never
 * concatenated into a query language without passing through here.
 */
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Resolve the immutable `userId` a session is created under.
 *
 * See {@link AgentEngineSessionsOptions.userId} for why the default reads the
 * envelope rather than inventing anything.
 */
function userIdResolver(
  option: AgentEngineSessionsOptions['userId'],
): (sessionId: string, envelope: CheckpointEnvelope) => string {
  if (typeof option === 'function') {
    return (sessionId, envelope) => {
      const resolved = option(sessionId, envelope);
      if (typeof resolved !== 'string' || resolved.trim() === '') {
        throw new TypeError(
          `${ADAPTER}: the 'userId' resolver returned ${JSON.stringify(resolved)} for session ` +
            `'${sessionId}'. The service requires a non-empty user id on create and will not ` +
            `let it be changed afterwards, so this refuses rather than storing the ` +
            `conversation under a name nobody chose.\n` +
            `  Return '${DEFAULT_USER_ID}' explicitly if an anonymous conversation is what ` +
            `you mean.`,
        );
      }
      return resolved;
    };
  }
  if (typeof option === 'string') {
    if (option.trim() === '') {
      throw new TypeError(
        `${ADAPTER}: 'userId' was an empty string. The service requires one on create and ` +
          `treats it as immutable. Pass a real id, a resolver function, or leave it unset to ` +
          `derive the owner from the conversation itself.`,
      );
    }
    return () => option;
  }
  // The default: the principal the conversation was signed with, so the
  // service's owner and this library's own ownership index agree.
  return (_sessionId, envelope) => envelopeOwner(envelope) ?? DEFAULT_USER_ID;
}

/**
 * The update mask for a patch.
 *
 * A patch with no mask REPLACES the resource, which would clear `userId` — and
 * `userId` is immutable, so the service refuses the write and the conversation
 * silently stops persisting. Naming the fields we own is the whole fix.
 */
function maskFor(body: VertexSession): string {
  const fields = ['sessionState'];
  if (body.ttl !== undefined) fields.push('ttl');
  return fields.join(',');
}

/** The id out of a resource name, which is everything after the last `/`. */
function lastSegment(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  const at = name.lastIndexOf('/');
  return at === -1 ? name : name.slice(at + 1);
}

/** An RFC 3339 timestamp as unix milliseconds, or 0 when it is not one. */
function toMillis(value: string | null | undefined): number {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The stored envelope's `format`, without trusting it to be one of ours. */
function formatOf(stored: unknown): string {
  const format = (stored as { format?: unknown } | undefined)?.format;
  return typeof format === 'string' ? format : 'unknown';
}
