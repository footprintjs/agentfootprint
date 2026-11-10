import { type Agent } from '../../../core/Agent.js';
import { type ArtifactHandOverFailedPayload } from '../../../events/payloads.js';
import { type ArtifactScope } from '../../../artifacts/types.js';
import { type Attribution, emitArtifactFact, errorClassOf, turnArtifactsFailed } from './facts.js';
import { type HostReply } from '../../types.js';
import { type IngressNote } from '../../ingressRecord.js';
import { openTurnArtifacts } from '../../turnArtifacts.js';

/**
 * What one turn offers a host that files its own artifacts
 * (`reply.turnArtifacts`): the session it served with the scope that
 * session's tickets are redeemed under — absent when the request named no
 * session — the bound on the hand-over, and where a failure is recorded.
 *
 * `scope` is a thunk so nothing is composed for a host that never asked.
 */
export interface TurnOffer {
  readonly session?: { readonly id: string; readonly scope: () => ArtifactScope };
  /** The ceiling on the hook plus the operations it started. */
  readonly timeoutMs: number;
  /** The request's own cancellation — a caller who hung up. */
  readonly signal?: AbortSignal;
  /** The per-request census, when one is kept. */
  readonly note?: IngressNote;
}

/**
 * Hand this turn's binding to a host that asked for it — AWAITED while the
 * session's lane is still held, BOUNDED, immediately before the turn's
 * terminal.
 *
 * Four guarantees, each one a finding an earlier cut of this seam failed:
 *
 *  - **Inside the turn.** The composer awaits the hook here, so a host files
 *    while no other run can be in flight on this instance.
 *  - **Bounded.** The hook and every operation it started race ONE deadline
 *    (`turnArtifactsTimeoutMs`) and the request's signal. Whichever ends the
 *    wait, the binding is revoked, nothing in flight is cancelled (it may
 *    still land — its facts name their own session and run, so they cannot
 *    enter anyone else's record), the cause is reported and the terminal is
 *    delivered — so one host's hung store or hook can hold neither every other
 *    session (the shared shape), nor a pooled lane, nor `close()`.
 *  - **Never the terminal's decision, never silent.** A hook that throws, an
 *    operation that fails, the bound, the abort and a call after the turn are
 *    reported (`turnArtifactsFailed`) and the terminal is delivered anyway.
 *  - **Revoked when the turn ends.** A verb called later is refused by name
 *    (`TurnArtifactsExpiredError`), already handled, and reported.
 *
 * A host without the hook gets nothing built: no binding, no scope, no store
 * lookup, no run-id read, no timer.
 */
export async function offerTurnArtifacts(
  agent: Agent,
  reply: HostReply,
  offer: TurnOffer,
  runIdOf: () => string | undefined,
): Promise<void> {
  if (reply.turnArtifacts === undefined) return;
  const session = offer.session;
  // WHOSE facts these are, captured NOW — the binding owns "whose run", never
  // the agent's mutable current-run state when a late fact lands.
  const runId = session !== undefined ? runIdOf() : undefined;
  const attribution: Attribution | undefined =
    session === undefined
      ? undefined
      : { sessionId: session.id, ...(runId !== undefined && { runId }) };
  const failed = (failure: ArtifactHandOverFailedPayload): void =>
    turnArtifactsFailed(agent, attribution, offer.note, failure);
  const opened = openTurnArtifacts({
    store: agent.getArtifactStore(),
    scope: session?.scope(),
    runId,
    onEvent: (fact) => {
      // Only a bound hand-over reports facts, and only a session binds.
      if (attribution !== undefined) emitArtifactFact(agent, fact, attribution);
    },
    onFailure: (failure) =>
      failed({
        cause: failure.cause,
        op: failure.op,
        ...(failure.cause === 'operation' && errorClassOf(failure.error)),
      }),
  });
  const handOver = (async (): Promise<void> => {
    try {
      await reply.turnArtifacts?.(opened.turn);
    } catch (err) {
      // A hook that merely re-threw an operation's failure was already counted.
      if (!opened.reported(err)) failed({ cause: 'hook', ...errorClassOf(err) });
    }
    await opened.drain();
  })();
  try {
    const ended = await withinBound(handOver, offer.timeoutMs, offer.signal);
    if (ended !== 'settled') failed({ cause: ended });
  } finally {
    opened.revoke();
  }
}

/**
 * Wait for `work`, but no longer than `timeoutMs` and no longer than `signal`
 * allows. `work` is NOT cancelled when the wait ends — there is nothing to
 * cancel a store's in-flight write with, and pretending otherwise would be
 * worse than saying we stopped waiting (the `toolSessions.ts · withTimeout`
 * law). The timer is unref'd, so a pending hand-over can never be the reason a
 * process stays up.
 */
export async function withinBound(
  work: Promise<void>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<'settled' | 'timeout' | 'abort'> {
  if (signal?.aborted === true) return 'abort';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      work.then(() => 'settled' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
        (timer as { unref?: () => void }).unref?.();
      }),
      new Promise<'abort'>((resolve) => {
        if (signal === undefined) return;
        onAbort = () => resolve('abort');
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  }
}
