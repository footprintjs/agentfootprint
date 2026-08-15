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
 * ── The fit, and the one thing it cost ──────────────────────────────────────
 * `Session.sessionState` is an arbitrary JSON `Struct`. A `CheckpointEnvelope`
 * is arbitrary JSON. So the envelope goes in whole, under one key, and comes
 * back whole — no event log to fold, no blob encoding to get wrong. What it
 * cost is the WRITE VERB, and that took a field trial to learn: state goes in
 * through an appended EVENT, never through a patch. See fact 2b below.
 *
 * ── The five facts that shaped the code ─────────────────────────────────────
 *  1. **`sessions.create` takes a caller-supplied `sessionId`.** So our session
 *     id IS the resource id and `hydrate` is one `get` by name. No mapping
 *     table, no listing to find a conversation.
 *  2. **`create` and `delete` answer a long-running Operation; `get` and
 *     `appendEvent` answer directly.** Every operation-shaped write here waits
 *     for `done` before it returns — a `persist` that returned early would make
 *     the very next `hydrate` a race whose failure mode is "no conversation",
 *     which nobody can tell from a new user.
 *
 *  2b. **`sessionState` CANNOT be patched. This one is field truth, and it cost
 *     a release.** 9.29.0 wrote the steady state as
 *     `sessions.patch({ updateMask: 'sessionState,ttl' })`, which every
 *     injected-client test accepted because a double will patch anything. An
 *     independent field trial ran it against the live service (2026-08-14) and
 *     found that turn one stored and **every later turn failed**:
 *
 *       HTTP 400 — "Can't update the session state for session …, you can only
 *                   update it by appending an event."
 *
 *     A store that keeps the first turn of a conversation and refuses the
 *     second is not a session store, so the verb changed rather than the
 *     documentation: `persist` now appends a `SessionEvent` whose
 *     `actions.stateDelta` carries the envelope, which the same trial verified
 *     end to end (append accepted, `GET` returned the new state).
 *
 *     Two consequences worth saying out loud, because they are the difference
 *     between this fix and a plausible-looking one:
 *
 *       • **A state delta MERGES by top-level key.** This store writes exactly
 *         two, both namespaced to this library — {@link SESSION_STATE_KEY} and
 *         {@link SESSION_ID_KEY} — so "merge the delta" and "replace our keys"
 *         are the same outcome for us, and another guest's keys under the same
 *         session are left alone either way. The second arrived in 9.45.0: the
 *         resource id is a lossy fold, so the listing has to carry the id its
 *         CALLER would recognise rather than the composed one. Answering with
 *         the composed id, and making the fold idempotent so that answer could
 *         be fed back, is what made two session ids address one conversation.
 *       • **A conversation now has an event log behind it**, one event per
 *         persisted turn, because that is the only writing surface the service
 *         offers. Nothing here READS that log — `hydrate` still reads the one
 *         envelope out of `sessionState` — so the log is the service's audit
 *         trail of our writes and never a second copy of the truth. Sessions
 *         are per-conversation and events are small; if that growth matters to
 *         you, `forget()` deletes the session and its events together.
 *  3. **`Session.userId` is required and immutable.** Our port's
 *     `persist(sessionId, envelope)` carries no user, so one has to be
 *     resolved — see {@link AgentEngineSessionsOptions.userId}. Immutable
 *     means the first write decides forever, which is the same ownership rule
 *     this library enforces in its own stores.
 *
 *     **It is metadata, not authorization, and a field trial proved it.** Two
 *     sessions were created under `alice` and `bob`; the project's ordinary ADC
 *     principal then read BOTH by name, presenting neither end-user identity
 *     (FINDINGS "Native Agent Runtime Sessions"). `userId` is what a listing
 *     filters on and what a first write pins — it is not a check the service
 *     performs on a read. So the sentence "here the service enforces it for us"
 *     would be false: anyone who can call the API with your project's
 *     credentials and can guess a session id can read that conversation.
 *
 *     Where the check belongs is above this port, and this library already has
 *     it: `envelopeOwner` records who a conversation belongs to, and the
 *     host/gateway is what must compare that to the authenticated caller
 *     before handing a session id down here. This adapter is a STORE. Nothing
 *     that only stores can tell an impostor from an owner.
 *  4. **`ttl` is input-only with a 24-hour floor**, and `expireTime` always
 *     comes back. An hour-long TTL is not available at any price.
 *
 *     **Sliding expiry is NOT claimed here, and cannot be.** A `ttl` is sent on
 *     `create`, where the service takes it; later turns append an event, and
 *     appending one was MEASURED against the real service — by a field trial,
 *     reported in issue #2 — to leave `expireTime` exactly where it was. So a
 *     conversation expires on the clock its FIRST turn started, however active
 *     it has been since, and the adapter sends the ttl once and says so because
 *     there is no second call that would refresh it.
 *     See {@link AgentEngineSessionsOptions.ttl}.
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
import { resolveSessionOwner } from '../../hosting/sessionOwnership.js';
import type {
  CheckpointEnvelope,
  SessionExpiryPolicy,
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

/**
 * The caller's OWN session id, stored beside the envelope.
 *
 * The resource id is a fold — lower-cased, punctuation replaced, long ids
 * fingerprinted — so it cannot be turned back into what the caller passed.
 * `listByUser` used to answer with the resource id and rely on
 * `safeResourceId` being idempotent, and that idempotence was a collision: it
 * made the fold's output a legal input addressing the same conversation. So the
 * raw id travels with the conversation instead, and the listing answers with
 * the id its caller would recognise.
 *
 * Sessions written before 9.45.0 do not carry it; `listByUser` falls back to
 * the resource id for those, which is what it always returned.
 */
export const SESSION_ID_KEY = 'agentfootprint.sessionId';

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
   *
   * **Sent on CREATE only, and the clock does NOT restart.** Later turns append
   * an event (see the module header, fact 2b), and appending one was measured
   * against the real service — by a field trial, reported in issue #2 — to
   * leave `expireTime` where it was. So a conversation expires on the clock its
   * FIRST turn started, however active it has been since.
   *
   * That is a real operational edge: a busy conversation can disappear
   * mid-use, and nothing in this adapter can extend it, because the service
   * treats `ttl` as input-only at create. If you need a conversation to outlive
   * that window, the only lever is a `ttl` long enough at creation.
   *
   * Recorded here rather than in a changelog because it is the kind of fact
   * somebody needs at the moment they are choosing this value, and measured
   * rather than assumed — the previous version of this comment said the
   * question had not been measured, which was true until it was.
   */
  readonly ttl?: string;
  /**
   * The `author` recorded on every event this store appends. Default
   * {@link SESSION_EVENT_AUTHOR}.
   *
   * The service requires one and treats it as free text; it is who the console
   * shows as having written the turn. This is not the conversation's owner —
   * that is `userId`, which is pinned at create and immutable.
   */
  readonly eventAuthor?: string;
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
 * The `author` on every event this store appends, unless
 * {@link AgentEngineSessionsOptions.eventAuthor} names another.
 *
 * The service requires the field and treats it as free text. This name says
 * which library wrote the turn, which is the useful thing to see in the console
 * beside somebody else's agent writing to the same engine.
 */
export const SESSION_EVENT_AUTHOR = 'agentfootprint';

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
   * How conversations here stop existing: **the service does it**, on the
   * `ttl` this store was built with (9.42.0).
   *
   * Narrowed from the port's optional member to a required one, and to the one
   * arm this store can be — a caller holding an `AgentEngineSessions` needs no
   * feature check, and reaching for a sweep that does not exist here is a
   * compile error rather than a surprise at 3am.
   *
   * There is nothing to call and nothing for a cron job to do. `active` says
   * whether a `ttl` was given at all; `enableWith` says what to pass and
   * repeats the two facts a caller has to plan around — the service's 24-hour
   * floor, and that the value is sent on CREATE only.
   */
  retention(): SessionExpiryPolicy;
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
 * **Status: field-validated except the write verb, which is field-CORRECTED.**
 * An independent trial ran this adapter against a live Agent Runtime engine
 * (2026-08-14) and everything below answered a real request from Google:
 * creating first-turn sessions from real envelopes, hydrating them through a
 * fresh instance, owners preserved, paged `listByUser` filtering, `ownerOf`,
 * an unknown envelope format refused before storage, and idempotent `forget`.
 *
 * The one thing that FAILED was the second write to an existing session — the
 * core job — because 9.29.0 patched `sessionState` and the service refuses
 * that. The trial recovered the service's own words and verified the repair
 * path (`appendEvent` with `actions.stateDelta`, then a `GET` showing the new
 * state) with a raw diagnostic. This adapter now uses that verb; the repair is
 * built on measured service behaviour and tested here, but the corrected write
 * has not itself been re-run through this adapter in a live project.
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

  /**
   * Does a session by this name exist? Asked ONLY to tell "there is nothing to
   * append to" apart from "the append itself was refused".
   *
   * The live trial proved the two ends of the write path — `create` stores a
   * new conversation, `appendEvent` updates an existing one — and left the
   * middle unmeasured: what the service answers when you append to a session
   * that is not there. Branching on an assumed 404 would put the FIRST turn of
   * every conversation on a guess. So a failed append asks the resource itself,
   * which is a fact rather than a convention, and costs one call on the one
   * turn where the append was never going to work anyway.
   */
  const missing = async (name: string): Promise<boolean> => {
    try {
      await sessions.get({ name });
      return false;
    } catch (err) {
      // Anything that is not a clean "no such session" leaves the append's own
      // failure standing — it is the one that says what went wrong.
      return isNotFound(err);
    }
  };

  /**
   * Write the envelope onto an EXISTING session, as one appended event.
   *
   * Answers `false` — rather than raising — for the one case the caller has a
   * repair for: there is no session here yet, so it has to be created.
   */
  /**
   * Who already signed for this conversation, as far as this service can say —
   * or `undefined` for a session that is new, or that nobody has signed for.
   *
   * TWO places have to be consulted, and only this adapter has that problem.
   * `userId` is the index `ownerOf` answers from, and the service pins it at
   * CREATE and will not let it change; so a conversation that ran anonymously
   * on turn one and gained an identity on turn two is stored under the
   * anonymous placeholder forever, with its real owner recorded only inside
   * the envelope. Reading `userId` alone would therefore see "nobody owns
   * this" on a conversation somebody plainly signed for, and let the next
   * signer overwrite it.
   */
  const signedBy = async (name: string, sessionId: string): Promise<string | undefined> => {
    let session: VertexSession | undefined;
    try {
      session = (await sessions.get({ name }))?.data;
    } catch (err) {
      // No session is not an owner — it is the first turn, and there is
      // nothing to contradict. Anything else is a failure to READ, and a write
      // that proceeded on an unread ownership check would be the defect this
      // whole read exists to close.
      if (isNotFound(err)) return undefined;
      throw googleSdkFailure(ADAPTER, 'sessions.get', err);
    }
    // A session that EXISTS but whose owner cannot be read is not an unowned
    // session, and answering `undefined` for both is what let a foreign turn
    // land. The service REQUIRES userId at create, so a materialised session
    // always has one and an anonymous conversation carries the explicit
    // DEFAULT_USER_ID placeholder — an absent userId therefore means the row's
    // fields have not become readable yet, not that nobody owns it.
    //
    // This is the `unreadable-is-not-absent` law of the port, applied to
    // OWNERSHIP rather than to the conversation: the two answers must stay
    // different, because only one of them is safe to write on.
    const userId = session?.userId;
    if (typeof userId !== 'string' || userId === '') {
      throw new Error(
        `[hosting] ${ADAPTER} could not determine who owns session "${sessionId}". The session ` +
          `exists but came back without a userId, so this store cannot tell an unowned ` +
          `conversation from somebody else's — and it refuses rather than appending your turn ` +
          `into a session that may not be yours. Nothing was written. This is transient ` +
          `(another writer's create is still settling): retry the turn.`,
      );
    }
    if (userId !== DEFAULT_USER_ID) return userId;
    const stored = session?.sessionState?.[SESSION_STATE_KEY];
    return stored !== null && typeof stored === 'object' ? envelopeOwner(stored) : undefined;
  };

  const append = async (name: string, stateDelta: Record<string, unknown>): Promise<boolean> => {
    try {
      await sessions.appendEvent({
        name,
        requestBody: {
          author: options.eventAuthor ?? SESSION_EVENT_AUTHOR,
          // Required, and one per persisted turn. It groups the events of one
          // invocation on the service's side; this store writes exactly one
          // event per turn, so a fresh id per call is the honest grouping.
          invocationId: newInvocationId(),
          timestamp: new Date().toISOString(),
          // ONE top-level key — see the module header. A state delta merges by
          // top-level key, so this replaces our envelope and touches nothing
          // else in the struct.
          actions: { stateDelta },
        },
      });
      return true;
    } catch (err) {
      if (isNotFound(err) || (await missing(name))) return false;
      throw googleSdkFailure(ADAPTER, 'sessions.appendEvent', err);
    }
  };

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
      const state = {
        [SESSION_STATE_KEY]: checked as unknown as Record<string, unknown>,
        [SESSION_ID_KEY]: sessionId as unknown as Record<string, unknown>,
      };

      // ── Whose conversation is this, before a byte of it is written ────
      //
      // The 9.36.1 correction, and this adapter had the defect in its own
      // dialect: `userId` is immutable at the service, `hydrate` answers from
      // `sessionState`, and nothing compared them — so appending an envelope
      // signed by somebody else left `ownerOf` naming the person who created
      // the session and the stored conversation belonging to the person who
      // wrote last. The one the index named would open it and read the other's
      // conversation.
      //
      // ONE read, and only when this turn actually names somebody. An
      // anonymous envelope claims nobody, so it can contradict nobody, and it
      // is written on exactly the call path it always was — which is also why
      // the steady state of an anonymous conversation still costs one call.
      const incoming = envelopeOwner(checked);
      if (incoming !== undefined) {
        // Throws SessionOwnershipConflictError on a different signer, before
        // either the append or the create below.
        resolveSessionOwner(sessionId, await signedBy(name, sessionId), incoming);
      }

      // APPEND first, CREATE when there is no session to append to.
      //
      // The steady state of a conversation is "it already exists": created
      // once, written on every turn after that. So the ordinary turn costs one
      // call, and the extra call is paid on turn one only.
      //
      // Appending — not patching. `sessions.patch` with a `sessionState` mask is
      // refused by the live service (module header, fact 2b); it is the verb
      // 9.29.0 used and the reason a second turn could not be stored.
      if (await append(name, state)) return;

      const userId = resolveUserId(sessionId, checked);
      let created;
      try {
        created = await sessions.create({
          parent: scope.parent,
          sessionId: safeResourceId(sessionId),
          requestBody: {
            sessionState: state,
            ...(options.ttl !== undefined && { ttl: options.ttl }),
            userId,
          },
        });
      } catch (err) {
        // Two writers opened the same conversation at once and the other one
        // won. That is not a failure: the session exists now, which is all
        // this call wanted, so our state goes on with the same appended event.
        if (!isAlreadyExists(err)) throw googleSdkFailure(ADAPTER, 'sessions.create', err);
        // ASK AGAIN before appending into it. The ownership check above ran
        // when there was no session to own; an ALREADY_EXISTS is proof that
        // somebody created one in between, and they may have signed it. This
        // is the exact interleaving the field trial hit — two writers, one
        // fresh session, both calls fulfilling — and re-reading here is what
        // closes it: the 409 itself guarantees the other writer's create has
        // already landed, so this read cannot miss it.
        if (incoming !== undefined) {
          resolveSessionOwner(sessionId, await signedBy(name, sessionId), incoming);
        }
        if (await append(name, state)) return;
        // Created by somebody and gone again before we could write to it.
        // Nothing here can say this turn landed, so it does not say it.
        throw googleSdkFailure(ADAPTER, 'sessions.create', err);
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
        // The caller's own id when the conversation carries it, the resource id
        // when it predates that — never the composed id for a session that knows
        // its real one, because a caller cannot feed the composed one back.
        const carried = session.sessionState?.[SESSION_ID_KEY];
        const sessionId =
          typeof carried === 'string' && carried !== '' ? carried : lastSegment(session.name);
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

    // ── Retention (9.42.0) ──────────────────────────────────────────────
    //
    // `'the-backend'` is the only honest answer, and here it is not even a
    // choice: the service OWNS expiry. `ttl` is input-only with a 24-hour
    // floor, `expireTime` comes back and cannot be set, and there is no
    // service-side call that means "delete everything older than X". This
    // store could have swept — list, then delete one long-running operation at
    // a time — and it would have been a second, slower, billed
    // reimplementation of a policy the caller already handed the service at
    // create.
    //
    // Answers on a CLOSED store on purpose: it reads nothing and calls
    // nothing, and an operator asking "what expires these?" during a shutdown
    // should get the answer rather than the refusal that guards the data
    // plane.
    retention: () => ({
      deletedBy: 'the-backend' as const,
      active: options.ttl !== undefined,
      // The service's own field, not one this adapter writes — which is why
      // the name is `expireTime` and not something of ours. It is returned on
      // every session and is read-only; `ttl` is what SETS it.
      expiresOn: 'expireTime',
      enableWith:
        `pass ttl: '<seconds>s' to agentEngineSessions() — e.g. ttl: '604800s' for a week. ` +
        `The service's floor is 24 HOURS and it refuses anything shorter, so this can only ` +
        `keep conversations longer, never expire them sooner. It is sent on CREATE only, ` +
        `and the clock does NOT restart: appending a later turn was measured against the ` +
        `real service to leave expireTime where it was, so a conversation expires on the ` +
        `clock its FIRST turn started however active it has been since. Set it long enough ` +
        `at creation — a conversation cannot push its own deadline out.`,
    }),

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
 * A fresh `invocationId` for one appended event.
 *
 * The field is required and groups the events of one invocation on the
 * service's side. This store writes exactly one event per persisted turn, so a
 * new id per call is what that grouping honestly is — reusing one across turns
 * would tell the console that a whole conversation was a single invocation.
 *
 * `randomUUID` where the runtime has it, and a time-plus-random id where it
 * does not: this is a correlation label, not a security value, and an adapter
 * that threw on an old runtime because a label could not be minted would be
 * failing a conversation over nothing.
 */
function newInvocationId(): string {
  const uuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID;
  if (typeof uuid === 'function') return `af-${uuid.call(globalThis.crypto)}`;
  return `af-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
