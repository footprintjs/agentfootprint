import {
  ANSWER_ACCOUNT_OP,
  type ArtifactWireRequest,
  NOT_A_REF,
  artifactOpWireName,
} from '../../artifactWire.js';
import { type AnswerAccounts } from '../../answerAccounts.js';
import { type ArtifactAccess } from './access.js';
import {
  ArtifactNotFoundError,
  ArtifactOpsBusyError,
  ArtifactSessionRequiredError,
  HostClosedError,
  InvalidWireOpError,
  NoArtifactStoreError,
  RecordingTooLargeForAccountError,
} from '../../errors.js';
import { type ArtifactScope, type ArtifactStore } from '../../../artifacts/types.js';
import { type Configuration } from '../configuration/read.js';
import { type HostReply, type HostRequest } from '../../types.js';
import { type LanePool } from '../lanes/pool.js';
import { RECORDING_ARTIFACT_KIND } from '../../../artifacts/recordingArtifact.js';
import { type VerifiedIdentity } from '../../identityVerification.js';
import { bindArtifacts } from '../../../artifacts/capability.js';
import { deliverArtifact, emitArtifactFact, holds } from './facts.js';
import { isArtifactRef } from '../../../artifacts/naming.js';
import { refuseUnknownWireOp } from '../../wireOps.js';
import { sessionArtifactScope } from '../identity/request.js';

type WireOptions = Pick<
  Configuration,
  'identityOptions' | 'host' | 'accounts' | 'artifactOpsPerSession' | 'artifactOpsInFlight'
> &
  Pick<LanePool, 'redeemerFor'> &
  Pick<ArtifactAccess, 'storedFor' | 'storedIdentityOf' | 'mayRedeemFrom'> & {
    readonly isClosing: () => boolean;
  };

export function createArtifactWire({
  identityOptions,
  host,
  accounts,
  artifactOpsPerSession,
  artifactOpsInFlight,
  redeemerFor,
  storedFor,
  storedIdentityOf,
  mayRedeemFrom,
  isClosing,
}: WireOptions) {
  /**
   * Redeem one claim ticket for the screen: `artifact-head` (metadata — the
   * render-by-ref decision) or `artifact-get` (metadata + payload), against
   * the store of the agent that serves this session.
   *
   * ── The scope is the run's own, re-composed — one isolation rule ────────
   * A ref is redeemed under EXACTLY the scope the run's tools minted it in:
   * `sessionArtifactScope(userId, sessionId, storedIdentity)` — the same
   * function a turn's hand-over (`reply.turnArtifacts`) is bound with, so a
   * host's filing and this redemption compose one tuple from the same inputs
   * for the same caller. It is `identityForRequest` when the request names a
   * user — the same call, on the same inputs, that composed the run's
   * identity — else the session rung
   * `{ conversationId: sessionId }` (what seed derives for an identity-less
   * served run). No new spelling exists to drift. The stored identity is read
   * only when a `userId` arrived (it is the only rung that needs the stored
   * tenant/conversation tuple), through the same wake → hydrate →
   * refuse-unreadable steps a turn takes.
   *
   * A ref from another session — or a right session presented with the wrong
   * identity — composes a different tuple, and the store answers a wrong
   * tuple with "no data", never with a distinguishable error. So the wire's
   * not-found is ONE shape for missing, expired and foreign alike:
   * {@link ArtifactNotFoundError}, byte-identical but for the ref itself.
   *
   * ── On the record, once ─────────────────────────────────────────────────
   * Resolution rides the existing `artifacts.resolved` / `artifacts.refused`
   * events through the capability's own fact sink (the raw store emits
   * nothing, so binding is the ONE emitter — no double-emit), delivered on
   * the serving agent's dispatcher with no `tool` field: the redeemer was the
   * hosting door, and a phantom tool name would be an actor that does not
   * exist.
   *
   * ── Nothing a stranger chose reaches the record ──────────────────────────
   * Every fact this door emits is stamped with the session the request NAMED
   * (`emitArtifactFact`), and that stamp decides which run's recording keeps
   * it (`eventBelongsToRun`). So the door checks, before it emits anything or
   * builds a lane:
   *
   *  1. **The ref's shape** (`isArtifactRef`) — free text posing as a ref would
   *     be text written into a live recording (the wire readers refuse it too;
   *     this covers a host that builds `HostRequest.artifact` itself).
   *  2. **At a verifying door, ownership** — the turn door's own rule
   *     (`mayOpenSession`) for a stored conversation; for one whose FIRST turn
   *     is still in flight (nothing stored yet), only the caller that turn is
   *     serving. Anyone else gets the ONE not-found, and nothing is emitted —
   *     a stranger can neither write into another person's recording nor flood
   *     it until its own events are evicted.
   *  3. **With no live lane** (the reader answers — `redeemerFor`), whether the
   *     store HOLDS the ref under the session's scope, asked silently
   *     (`holds`; `account` asks it in `explainAnswer`). A made-up session id
   *     is the one not-found with nothing emitted; a real one is redeemed,
   *     whether or not its conversation was ever stored.
   *
   * At a door with no verifier the session id IS the key, by law: whoever
   * presents it may redeem under it, and its facts are that session's.
   *
   * Zero-cost when unused: an agent without a store answers with the teaching
   * refusal naming the attach, and nothing else in the composer changes.
   */
  async function answerArtifact(
    op: ArtifactWireRequest,
    request: HostRequest,
    verified: VerifiedIdentity | undefined,
    reply: HostReply,
  ): Promise<void> {
    // The account op is spoken only by a host that opted in — and refused
    // before anything is read, so a host that never asked for it pays nothing
    // and reveals nothing.
    if (op.op === 'account' && accounts === undefined) refuseUnknownWireOp(ANSWER_ACCOUNT_OP);
    const sessionId = request.sessionId;
    if (sessionId === undefined) {
      // An anonymous run scopes its artifacts to its own runId — a name no
      // later request can present — so there is genuinely nothing a
      // session-less redemption could ever resolve. Taught, not 404'd: this
      // is a caller gap, not a missing ref.
      reply.fail(new ArtifactSessionRequiredError(op.op));
      return;
    }
    if (!isArtifactRef(op.ref)) {
      reply.fail(new InvalidWireOpError(`'${artifactOpWireName(op.op)}' ${NOT_A_REF}`));
      return;
    }
    // Read the stored conversation once, and only when it decides something:
    // its OWNER (a verifying door) and its identity tuple (any request naming
    // a user). Whether a ticket EXISTS is never its question — that is the
    // artifact store's, asked under the composed scope below.
    const needsStored = identityOptions !== undefined || request.userId !== undefined;
    const envelope = needsStored ? await storedFor(sessionId) : undefined;
    if (identityOptions !== undefined && !mayRedeemFrom(sessionId, envelope, verified)) {
      reply.fail(new ArtifactNotFoundError(op.ref));
      return;
    }
    // Outlived the composer across an await: answer like the door after close.
    if (isClosing()) {
      reply.fail(new HostClosedError(host.name));
      return;
    }
    // The per-session bound (after ownership, so a stranger can never spend
    // someone else's slots): artifact ops are lane-free and turn admission
    // does not see them, so without it one session could keep the event loop
    // every session shares busy with payload reads and parses. Refused by
    // name, never queued — a screen retries; a queue would only move the wait.
    const busy = artifactOpsInFlight.get(sessionId) ?? 0;
    if (busy >= artifactOpsPerSession) {
      reply.fail(new ArtifactOpsBusyError(op.op, artifactOpsPerSession));
      return;
    }
    // NEVER a new lane, never an eviction (R2-12): the session's live
    // instance, else the reader — see `redeemerFor`.
    const redeemer = redeemerFor(sessionId);
    if (redeemer === undefined) {
      reply.fail(new ArtifactNotFoundError(op.ref));
      return;
    }
    const lane = redeemer.lane;
    // Admitted for the duration: a lane with work is never evicted, and a
    // resolution mid-flight is work — retiring the instance under it would
    // tear down the very store being read.
    if (lane !== undefined) lane.admitted += 1;
    // Counted with no await since the check above, so a burst cannot all pass it.
    artifactOpsInFlight.set(sessionId, busy + 1);
    try {
      const store = redeemer.agent.getArtifactStore();
      if (store === undefined) {
        // The fail-closed law at the wire: the refusal lands on the record
        // (`no-store`, the same reason `ctx.artifacts` teaches with) and the
        // reply names the attach.
        // (An account would have been READ with `get`, so that is the verb its
        // refusal names — no new `ArtifactOp` member.)
        // On a live lane only: a lane-less session has proved nothing exists
        // under its name, so the reader emits nothing for it (R2-12).
        if (lane !== undefined) {
          emitArtifactFact(
            redeemer.agent,
            {
              type: 'refused',
              op: op.op === 'account' ? 'get' : op.op,
              reason: 'no-store',
              ref: op.ref,
            },
            { sessionId },
          );
        }
        reply.fail(new NoArtifactStoreError(op.op));
        return;
      }
      const stored =
        request.userId !== undefined ? storedIdentityOf(envelope, sessionId) : undefined;
      const scope = sessionArtifactScope(request.userId, sessionId, stored);
      // A lane-less session (the reader answers) emits only for a ref its scope
      // HOLDS: asked silently first — the `explainAnswer` precedent, which
      // already covers `account` — so a made-up session id is the one
      // not-found with nothing emitted (R2-12), and a real one is redeemed.
      if (lane === undefined && op.op !== 'account' && !(await holds(store, scope, op.ref))) {
        reply.fail(new ArtifactNotFoundError(op.ref));
        return;
      }
      const bound = bindArtifacts(store, scope, {
        onEvent: (fact) => emitArtifactFact(redeemer.agent, fact, { sessionId }),
      });
      if (op.op === 'account') {
        // `accounts` is defined: the first line of this function refused otherwise.
        await explainAnswer(accounts as AnswerAccounts, store, scope, op.ref, bound, reply);
      } else if (op.op === 'head') {
        const meta = await bound.head(op.ref);
        if (meta === null) {
          reply.fail(new ArtifactNotFoundError(op.ref));
          return;
        }
        deliverArtifact(reply, { op: 'head', ref: op.ref, meta });
      } else {
        // A digest mismatch throws here (ArtifactIntegrityError) rather than
        // returning corrupt bytes as whole — it propagates to the handler's
        // catch as this request's failure, already on the record via the sink.
        const record = await bound.get(op.ref);
        if (record === null) {
          reply.fail(new ArtifactNotFoundError(op.ref));
          return;
        }
        deliverArtifact(reply, { op: 'get', ref: op.ref, meta: record.meta, data: record.data });
      }
    } finally {
      if (lane !== undefined) {
        lane.admitted -= 1;
        lane.lastUsedMs = Date.now();
      }
      const left = (artifactOpsInFlight.get(sessionId) ?? 1) - 1;
      if (left <= 0) artifactOpsInFlight.delete(sessionId);
      else artifactOpsInFlight.set(sessionId, left);
    }
  }

  /**
   * The `answer-account` branch, after ownership (explain-answer af-3).
   *
   * Everything before this line is `artifact-get`'s own path — the same
   * ownership check, the same lane admission (never the run queue), the same
   * composed scope. What the branch adds, in order:
   *
   *  1. **A SILENT head** — `bindArtifacts(store, scope)` with no sink, so it
   *     emits nothing. It runs BEFORE the cache (review R3-S1): whether the
   *     record still exists is the store's answer, so a swept or expired
   *     recording is "not available" even while its account is cached, and a
   *     kind change cannot be masked.
   *  2. **Kind, then size** — not a `recording/run` → the ONE not-found (and
   *     nothing was emitted); over the ceiling → the named 413, before a byte
   *     of the payload is read (and again, by the service, on the payload's
   *     REAL size before any parse — a store may under-report `bytes`). Both before the cache: neither can ever have
   *     an entry there (failures are never cached; the ceiling is per host).
   *  3. **The cache, then single-flight** — a hit reads nothing more and emits
   *     nothing; a miss starts or joins the ONE computation for its key.
   *  4. **The one door fact** — the leader's `get` goes through the sinked
   *     binding, which emits the single `artifacts.resolved` (`via: 'get'`),
   *     stamped with this session: the fact truthfully says the record was
   *     read, and no new `ArtifactOp` exists to say it differently.
   *  5. **Parse + fold + show-me** — `explainRecording`. Anything that cannot
   *     be explained (the record vanished between head and get, it does not
   *     parse, it is not a recording) is the one not-found, and is not cached.
   */
  async function explainAnswer(
    service: AnswerAccounts,
    store: ArtifactStore,
    scope: ArtifactScope,
    ref: string,
    bound: ReturnType<typeof bindArtifacts>,
    reply: HostReply,
  ): Promise<void> {
    const meta = await bindArtifacts(store, scope).head(ref);
    if (meta === null || meta.kind !== RECORDING_ARTIFACT_KIND) {
      reply.fail(new ArtifactNotFoundError(ref));
      return;
    }
    if (meta.bytes > service.maxRecordingBytes) {
      reply.fail(new RecordingTooLargeForAccountError(service.maxRecordingBytes));
      return;
    }
    const key = service.keyFor(scope, ref);
    const answer =
      service.cached(key) ??
      (await service.compute(key, async () => {
        const record = await bound.get(ref);
        if (record === null || record.meta.kind !== RECORDING_ARTIFACT_KIND) return null;
        // The payload's REAL size is checked by the service before any parse.
        const runId = record.meta.origin?.runId;
        return { data: record.data, ...(runId !== undefined && { runId }) };
      }));
    if (answer === null) {
      reply.fail(new ArtifactNotFoundError(ref));
      return;
    }
    deliverArtifact(reply, { op: 'account', ref, meta, answer });
  }
  return answerArtifact;
}

export type ArtifactWireHandler = ReturnType<typeof createArtifactWire>;
