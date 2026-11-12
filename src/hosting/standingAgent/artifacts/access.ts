import { type Agent } from '../../../core/Agent.js';
import {
  ArtifactOpsBusyError,
  HostClosedError,
  IdentityNotVerifiedError,
  RequestArtifactsRevokedError,
  UnreadableEnvelopeError,
  VerifierUnavailableError,
} from '../../errors.js';
import {
  type ArtifactsForRequestInput,
  type ArtifactsForRequestResult,
  type CheckpointEnvelope,
} from '../../types.js';
import { type Configuration } from '../configuration/read.js';
import { type Lane } from '../lane.js';
import { type LanePool } from '../lanes/pool.js';
import { type MemoryIdentity } from '../../../memory/identity/types.js';
import { type SessionHistory } from '../sessions/history.js';
import { type ToolArtifacts, bindArtifacts } from '../../../artifacts/capability.js';
import { type VerifiedIdentity, verifyRequestIdentity } from '../../identityVerification.js';
import { checkSessionId } from '../../doorGuard.js';
import { emitArtifactFact } from './facts.js';
import { laneKeyOf } from '../lanes/keys.js';
import { readStoredSession } from '../../answeredPause.js';
import {
  repeatsAuthorization,
  sessionArtifactScope,
  singleValuedHeaders,
} from '../identity/request.js';

type AccessOptions = Pick<
  Configuration,
  'sessions' | 'identityOptions' | 'host' | 'artifactOpsPerSession' | 'artifactOpsInFlight'
> &
  Pick<LanePool, 'shared' | 'pool' | 'retired' | 'redeemerFor'> &
  Pick<SessionHistory, 'mayOpenSession'> & { readonly isClosing: () => boolean };

export function createArtifactAccess({
  sessions,
  identityOptions,
  host,
  artifactOpsPerSession,
  artifactOpsInFlight,
  shared,
  pool,
  retired,
  redeemerFor,
  mayOpenSession,
  isClosing,
}: AccessOptions) {
  /** The stored conversation for a redemption — woken and hydrated the way a
   *  turn does it, the unreadable-envelope law included. */
  async function storedFor(sessionId: string): Promise<CheckpointEnvelope | undefined> {
    await sessions.onWake?.(sessionId, 'artifact');
    try {
      return await sessions.hydrate(sessionId);
    } catch (err) {
      throw err instanceof UnreadableEnvelopeError ? err.withSession(sessionId) : err;
    }
  }

  /**
   * The identity a stored conversation carries — the `stored` input of
   * `sessionArtifactScope`. The same law as a turn: an unreadable stored
   * conversation is a different fact from an absent one, and only one of them
   * is safe to compose a scope from, so it throws by name.
   */
  function storedIdentityOf(
    envelope: CheckpointEnvelope | undefined,
    sessionId: string,
  ): MemoryIdentity | undefined {
    if (envelope === undefined) return undefined;
    try {
      const held = readStoredSession(envelope);
      return (held.waiting?.conversation ?? held.prior)?.identity;
    } catch (err) {
      throw err instanceof UnreadableEnvelopeError ? err.withSession(sessionId) : err;
    }
  }

  /**
   * `handle.artifactsForRequest` — the redemption door's composition, handed
   * to the host for a path that is not a turn (see
   * {@link StandingAgentHandle.artifactsForRequest}).
   *
   * Every step is the one `answerArtifact` takes, in the same order and with
   * the same instances — the badge (`verifyRequestIdentity`), the stored
   * conversation (`storedFor`), ownership (`mayRedeemFrom`), the serving
   * agent's store, the ONE composer (`sessionArtifactScope`) and the fact sink
   * stamped with the session — so the scope it binds is the scope a wire
   * redemption by the same caller reads. What differs is only what is handed
   * back: the bound verbs instead of one resolved ref. Refusals are VALUES,
   * because the host decides its own status codes; nothing is emitted before
   * ownership is settled, and a refused caller builds no lane.
   */
  async function artifactsForRequest(
    request: ArtifactsForRequestInput,
  ): Promise<ArtifactsForRequestResult> {
    if (isClosing()) throw new HostClosedError(host.name);
    // Two credentials are ambiguous: refused by name, never read as none.
    if (identityOptions !== undefined && repeatsAuthorization(request.headers)) {
      return {
        bound: false,
        reason: 'unverified',
        error: new IdentityNotVerifiedError('unverifiable', false),
      };
    }
    let verified: VerifiedIdentity | undefined;
    try {
      // The turn door's four arguments — the sign-in key included, so a
      // person signed in by the cookie is who they are here too.
      verified = await verifyRequestIdentity(
        identityOptions,
        singleValuedHeaders(request.headers),
        request.userId,
        request.signInKey,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // An identity-provider outage judged nobody's credential: its own
      // reason (a 503), never 'unverified' (a 401 that sends every client to
      // re-authenticate against a provider that is down).
      return {
        bound: false,
        reason: err instanceof VerifierUnavailableError ? 'unavailable' : 'unverified',
        error,
      };
    }
    // The same answer after an await as before one: a composer that closed
    // while this call waited is closed (the wire's HostClosedError, too).
    if (isClosing()) throw new HostClosedError(host.name);
    const userId = verified?.userId ?? request.userId;
    const sessionId = request.sessionId;
    if (sessionId === undefined) return { bound: false, reason: 'no-session' };
    // The wire refuses these ids at the adapter (`doorGuard.ts`); the seam
    // has no adapter in front of it, so it asks the same check itself.
    const invalid = checkSessionId(sessionId, host.name);
    if (invalid !== undefined) return { bound: false, reason: 'invalid-session', error: invalid };
    const needsStored = identityOptions !== undefined || userId !== undefined;
    const envelope = needsStored ? await storedFor(sessionId) : undefined;
    if (identityOptions !== undefined && !mayRedeemFrom(sessionId, envelope, verified)) {
      return { bound: false, reason: 'not-found' };
    }
    // Every await above could have outlived the composer (RS5): a call that
    // lost the race to `close()` binds nothing, builds nothing, and says so the
    // way a call made after close does.
    if (isClosing()) throw new HostClosedError(host.name);
    const stored = userId !== undefined ? storedIdentityOf(envelope, sessionId) : undefined;
    // Never a new lane, never an eviction — the redemption door's own rule. A
    // session with no live lane binds through the reader: what its scope holds
    // is the store's answer, and a session nobody has chatted in yet is where
    // an app-owned route files a guide before the first turn.
    const redeemer = redeemerFor(sessionId);
    if (redeemer === undefined) return { bound: false, reason: 'not-found' };
    const agent = redeemer.agent;
    const store = agent.getArtifactStore();
    if (store === undefined) return { bound: false, reason: 'no-store' };
    const bound = bindArtifacts(store, sessionArtifactScope(userId, sessionId, stored), {
      onEvent: (fact) => emitArtifactFact(agent, fact, { sessionId }),
    });
    return { bound: true, artifacts: heldBinding(bound, sessionId, agent, redeemer.lane) };
  }

  /**
   * A seam binding's verbs, held to the same terms as the wire's redemptions
   * and a turn's hand-over (S5):
   *
   *  - **Revoked** when the instance it is bound to is retired from the pool or
   *    the host closes — a write after that would land on a stopped agent and
   *    its fact on a record nobody holds. `RequestArtifactsRevokedError`,
   *    created already handled. Checked per call against `retired`, so a
   *    binding that is never used again costs nothing to keep.
   *  - **Bounded** by `artifactOpsPerSession`, counted with the wire's
   *    redemptions of the same session (`ArtifactOpsBusyError`).
   *  - **Admitted** to its lane for the duration of each call, so the pool
   *    cannot retire the instance under an operation in flight.
   */
  function heldBinding(
    bound: ToolArtifacts,
    sessionId: string,
    agent: Agent,
    lane: Lane | undefined,
  ): ToolArtifacts {
    type Verb = 'put' | 'head' | 'get' | 'delete' | 'list';
    const refused = <T>(error: Error): Promise<T> => {
      const refusal = Promise.reject(error);
      refusal.then(undefined, () => undefined);
      return refusal as Promise<T>;
    };
    function held<T>(verb: Verb, start: () => Promise<T>): Promise<T> {
      if (isClosing() || retired.has(agent)) {
        return refused(new RequestArtifactsRevokedError(verb));
      }
      const busy = artifactOpsInFlight.get(sessionId) ?? 0;
      if (busy >= artifactOpsPerSession) {
        return refused(new ArtifactOpsBusyError(verb, artifactOpsPerSession));
      }
      artifactOpsInFlight.set(sessionId, busy + 1);
      if (lane !== undefined) lane.admitted += 1;
      let running: Promise<T>;
      try {
        running = start();
      } catch (err) {
        running = Promise.reject(err);
      }
      return running.finally(() => {
        if (lane !== undefined) {
          lane.admitted -= 1;
          lane.lastUsedMs = Date.now();
        }
        const left = (artifactOpsInFlight.get(sessionId) ?? 1) - 1;
        if (left <= 0) artifactOpsInFlight.delete(sessionId);
        else artifactOpsInFlight.set(sessionId, left);
      });
    }
    return Object.freeze({
      put: (input) => held('put', () => bound.put(input)),
      head: (ref) => held('head', () => bound.head(ref)),
      get: (ref) => held('get', () => bound.get(ref)),
      delete: (ref) => held('delete', () => bound.delete(ref)),
      list: (options) => held('list', () => bound.list(options)),
    } satisfies ToolArtifacts);
  }

  /**
   * May this caller redeem under `sessionId` at a VERIFYING door?
   *
   * A stored conversation answers with the turn door's own rule
   * (`mayOpenSession`) — asked leniently, before any strict reader, for the
   * same reason the turn door asks it first. With nothing stored yet the only
   * conversation that can hold artifacts is one whose FIRST turn is in flight
   * right now (a chart presented mid-turn), and then only the caller that turn
   * is serving may redeem. Read from the lane WITHOUT building one: a refused
   * caller never makes the pool grow or evict.
   */
  function mayRedeemFrom(
    sessionId: string,
    envelope: CheckpointEnvelope | undefined,
    verified: VerifiedIdentity | undefined,
  ): boolean {
    if (envelope !== undefined) return mayOpenSession(envelope, verified);
    const serving = shared ?? pool.get(laneKeyOf(sessionId));
    return serving?.activeSessionId === sessionId && serving.activeOwner === verified?.userId;
  }
  return { storedFor, storedIdentityOf, mayRedeemFrom, artifactsForRequest };
}

export type ArtifactAccess = ReturnType<typeof createArtifactAccess>;
