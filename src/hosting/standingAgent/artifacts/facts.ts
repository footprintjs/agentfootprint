import { type Agent } from '../../../core/Agent.js';
import { type ArtifactEventFact, bindArtifacts } from '../../../artifacts/capability.js';
import { type ArtifactHandOverFailedPayload } from '../../../events/payloads.js';
import { ArtifactNotCarriedError, SessionsNotCarriedError } from '../../errors.js';
import { type ArtifactScope, type ArtifactStore } from '../../../artifacts/types.js';
import { type ArtifactWireResult } from '../../artifactWire.js';
import { type HostReply } from '../../types.js';
import { type IngressNote } from '../../ingressRecord.js';
import { type SessionWireResult } from '../../sessionWire.js';
import { isDevMode } from 'footprintjs';

/** Who a hand-over's facts are FOR — captured when its binding is built. */
export interface Attribution {
  readonly sessionId: string;
  readonly runId?: string;
}

/** The routable half of a failure — class and code, never the message. */
export function errorClassOf(err: unknown): { errorClass?: string; errorCode?: string } {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return {
    ...(err instanceof Error && { errorClass: err.constructor?.name ?? err.name }),
    ...(typeof code === 'string' && { errorCode: code }),
  };
}

/**
 * Record one failure of a turn's artifact hand-over — on the serving agent's
 * stream as `agentfootprint.artifacts.hand_over_failed`, stamped with the
 * session and run it was FOR; the first one on the ingress record's census
 * (`IngressRecord.turnArtifactsFailure`); and on the console in dev mode. The
 * swallow is the library's decision, so the visibility is its duty: the
 * default deployment keeps no ingress sink, and a missing story must not be
 * silent there (the `toolSessions.ts` law 5, "never throws into the run — but
 * never silent either"). It never reaches the reply.
 */
export function turnArtifactsFailed(
  agent: Agent,
  attribution: Attribution | undefined,
  note: IngressNote | undefined,
  failure: ArtifactHandOverFailedPayload,
): void {
  const payload: ArtifactHandOverFailedPayload = {
    cause: failure.cause,
    ...(failure.op !== undefined && { op: failure.op }),
    ...(failure.errorClass !== undefined && { errorClass: failure.errorClass }),
    ...(failure.errorCode !== undefined && { errorCode: failure.errorCode }),
  };
  note?.turnArtifactsFailed(payload);
  if (attribution !== undefined) {
    agent.emitAttributed('agentfootprint.artifacts.hand_over_failed', { ...payload }, attribution);
  }
  if (isDevMode()) {
    // eslint-disable-next-line no-console
    console.error(
      '[hosting] reply.turnArtifacts hand-over failed; the reply was delivered anyway:',
      payload,
    );
  }
}

/**
 * End the reply with a resolved artifact — through the terminal built for it
 * when the host has one, and through the named refusal when it does not.
 *
 * The `awaiting` fallback law, applied to the other optional terminal: a host
 * that cannot describe the result must say so by name rather than deliver an
 * improvised shape or nothing. The resolution itself already happened and is
 * already on the record either way.
 */
export function deliverArtifact(reply: HostReply, result: ArtifactWireResult): void {
  if (reply.artifact) {
    reply.artifact(result);
    return;
  }
  reply.fail(new ArtifactNotCarriedError(result.ref));
}

/**
 * End the reply with resolved session history — through the terminal built for
 * it when the host has one, and through the named refusal when it does not.
 *
 * The {@link deliverArtifact} law, applied to the third optional terminal: a
 * host that cannot describe the result says so by name rather than delivering
 * an improvised shape or nothing.
 */
export function deliverSessions(reply: HostReply, op: string, result: SessionWireResult): void {
  if (reply.sessions) {
    reply.sessions(result);
    return;
  }
  reply.fail(new SessionsNotCarriedError(op));
}

/**
 * Does `scope` hold `ref`? Asked through a binding with NO fact sink, so the
 * question itself puts nothing on any record — what lets the redemption door
 * answer a lane-less session (one the reader serves) without emitting a fact
 * under a session id nobody has proved exists (R2-12).
 */
export async function holds(
  store: ArtifactStore,
  scope: ArtifactScope,
  ref: string,
): Promise<boolean> {
  return (await bindArtifacts(store, scope).head(ref)) !== null;
}

/**
 * Put one capability fact on the serving agent's typed record — the hosting
 * door's adapter onto the SAME `artifacts.*` events every tool's use of
 * `ctx.artifacts` rides, minus the `tool` field (the actor was the hosting
 * door or the host's own code, and payloads never carry an actor that does not
 * exist).
 *
 * Two bindings feed it. The wire's redemption (`artifact-head` /
 * `artifact-get`) is read-only and only ever produces `resolved` / `refused`
 * — the wire deliberately has no put. The turn's hand-over
 * (`reply.turnArtifacts`) is the host's own code filing for its turn, so its
 * `put` produces `minted` and, when retention made room, `expired` —
 * tool-less, like the run's own recording mint, and carrying every meta field
 * a tool's mint carries.
 *
 * Every fact is stamped with the SESSION it was produced for
 * (`RunnerBase.emitAttributed`). The door answers outside any run and — for a
 * redemption — outside the lane, so on an instance shared by several sessions
 * a fact can be delivered while ANOTHER session's run is in flight; the stamp
 * is what keeps it out of that run's recording and self-explain evidence
 * (`bridge/eventMeta.ts · eventBelongsToRun`). Delivery to listeners is
 * unchanged. Dropped when nobody listens (the dispatcher's own fast path), so
 * an unobserved agent pays one listener check per fact and nothing more.
 */
export function emitArtifactFact(
  agent: Agent,
  fact: ArtifactEventFact,
  attribution: Attribution,
): void {
  switch (fact.type) {
    case 'minted': {
      const meta = fact.meta;
      agent.emitAttributed(
        'agentfootprint.artifacts.minted',
        {
          ref: meta.ref,
          kind: meta.kind,
          mediaType: meta.mediaType,
          bytes: meta.bytes,
          ...(meta.label !== undefined && { label: meta.label }),
          ...(meta.digest !== undefined && { digest: meta.digest }),
          ...(meta.expiresAt !== undefined && { expiresAt: meta.expiresAt }),
          ...(meta.origin !== undefined && { origin: meta.origin }),
          ...(meta.parentRefs !== undefined && { parentRefs: meta.parentRefs }),
          ...(meta.timeAxis !== undefined && { timeAxis: meta.timeAxis }),
        },
        attribution,
      );
      return;
    }
    case 'expired':
      agent.emitAttributed(
        'agentfootprint.artifacts.expired',
        {
          ref: fact.swept.ref,
          reason: fact.swept.reason,
          kind: fact.swept.kind,
          bytes: fact.swept.bytes,
        },
        attribution,
      );
      return;
    case 'resolved':
      agent.emitAttributed(
        'agentfootprint.artifacts.resolved',
        {
          ref: fact.ref,
          via: fact.via,
          kind: fact.kind,
          bytes: fact.bytes,
        },
        attribution,
      );
      return;
    case 'refused':
      agent.emitAttributed(
        'agentfootprint.artifacts.refused',
        {
          op: fact.op,
          reason: fact.reason,
          ...(fact.ref !== undefined && { ref: fact.ref }),
          ...(fact.detail !== undefined && { detail: fact.detail }),
        },
        attribution,
      );
      return;
    default:
      return;
  }
}
