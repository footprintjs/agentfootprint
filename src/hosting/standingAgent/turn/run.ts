import { type AgentRunCheckpoint } from '../../../core/runCheckpoint.js';
import { type AgentRunOptions } from '../../../core/Agent.js';
import {
  AwaitingDecisionError,
  NoPendingAskError,
  PauseNotCarriedError,
  SessionNotFoundError,
  UnreadableEnvelopeError,
} from '../../errors.js';
import { type Configuration } from '../configuration/read.js';
import {
  type HostReply,
  type HostRequest,
  type PausedRun,
  type SessionLifecycle,
} from '../../types.js';
import { type HostedInvocation, type HostedTurn, runnerLive } from '../../../core/runnerLive.js';
import { type IngressNote } from '../../ingressRecord.js';
import { type Lane } from '../lane.js';
import { type SessionHistory } from '../sessions/history.js';
import { type TurnOffer, offerTurnArtifacts } from '../artifacts/handOver.js';
import {
  UNANSWERABLE_QUESTION,
  afterFailedAnswer,
  answeredRefusal,
  closedConversation,
  openToolCalls,
  readStoredSession,
  unanswerablePause,
  watchAnswer,
} from '../../answeredPause.js';
import { type VerifiedIdentity } from '../../identityVerification.js';
import { applyInputResponse, readAwaitingInput } from '../../../tools/inputRequest.js';
import { describePause } from '../../pendingAsk.js';
import { hostedTurnOf } from './port.js';
import { identityForRequest, sessionArtifactScope } from '../identity/request.js';
import { isPaused, pauseDemandsDecision } from '../../../core/pause.js';
import { toEnvelope, toPausedEnvelope } from '../../envelope.js';
import { withHostedConversation } from '../../../core/agent/servingConversation.js';

type TurnOptions = Pick<Configuration, 'turnArtifactsTimeoutMs' | 'sealRequest'> &
  Pick<SessionHistory, 'mayOpenSession'>;

export function createTurnRunner({
  turnArtifactsTimeoutMs,
  sealRequest,
  mayOpenSession,
}: TurnOptions) {
  async function answerOne(
    lane: Lane,
    store: SessionLifecycle,
    request: HostRequest,
    reply: HostReply,
    sessionId: string | undefined,
    verified: VerifiedIdentity | undefined,
    spendKey: string | undefined,
    note: IngressNote | undefined,
  ): Promise<void> {
    const runner = lane.agent;
    // The writer only ever writes for the run it is inside; an anonymous
    // request has nowhere to write to and gets nothing.
    lane.activeSessionId = sessionId;
    lane.activeOwner = verified?.userId;
    const bind = (invocation: HostedInvocation) => {
      lane.turn = { invocation, reply, ...(spendKey !== undefined && { spendKey }) };
      return lane.writer?.capture({
        sessionId,
        runId: invocation.runId,
        identity: invocation.identity,
        state: () => invocation.view.liveState(),
      });
    };
    try {
      let prior: AgentRunCheckpoint | undefined;
      let paused: PausedRun | undefined;
      // A pause whose decision a resume already used (`answeredPause.ts`): no
      // decision answers it again, and the next message continues the
      // conversation that resume left.
      let answered: PausedRun | undefined;
      if (sessionId !== undefined) {
        // A request carrying a decision is waking this session to CONTINUE a
        // run, which is a different thing to ask a store to be ready for.
        await store.onWake?.(sessionId, request.decision !== undefined ? 'resume' : 'invoke');
        try {
          const stored = await store.hydrate(sessionId);
          if (stored !== undefined) {
            // WHOSE conversation this is, before a single line of it is read
            // into this run. A turn is the door that hydrates history into a
            // model's context AND the door that re-persists who owns it, so it
            // is the door where getting this wrong costs the most: see
            // `mayOpenSession` for the rule and its one honest leak.
            //
            // Placed before the readers on purpose — an unreadable envelope
            // belonging to somebody else must answer "not yours", not describe
            // the state of a stranger's storage.
            if (!mayOpenSession(stored, verified)) {
              reply.fail(new SessionNotFoundError(sessionId));
              return;
            }
            // Both readers throw by name on a format this runtime cannot read —
            // better a loud refusal than an agent answering from half a session.
            // The one reading every door uses: an answered pause is never
            // offered for an answer (`answeredPause.ts`).
            const held = readStoredSession(stored);
            paused = held.waiting;
            prior = held.prior;
            answered = held.answered;
          }
        } catch (err) {
          // A stored conversation this runtime cannot read fails THIS REQUEST,
          // naming the session. It must never fall through to the fresh-start
          // path below: the conversation exists, and answering it as if the
          // caller were new is the one failure nobody can see from the outside.
          // A store that knows the session already named it; one that does not
          // gets the name added here, so the guarantee does not depend on which
          // store you chose.
          throw err instanceof UnreadableEnvelopeError ? err.withSession(sessionId) : err;
        }
      }

      // The signal reaches tools, tool discovery and skill-entry scoring, NOT the
      // LLM call: a caller who hangs up mid-generation stops the tools, not the tokens.
      //
      // `sessionId` (9.4.0) rides the same bag onto every event this run
      // emits, so a shipped telemetry stream can be asked "what happened in
      // this conversation?" and not only "what happened in this run?". Since
      // 9.10.0 it also decides the memory namespace when the caller named no
      // identity — a session IS a conversation, so a served session recalls its
      // own earlier turns with no configuration. This is the only place that
      // knows the answer — the agent is handed a message, not a session. An
      // ANONYMOUS request has no session and gets no key: `sessionKey` above is
      // a concurrency latch this host invented, and stamping it on telemetry
      // would be publishing a fact nobody can join to.
      //
      // `identity` (9.12.0) is the WHO beside that WHICH-conversation: a named end
      // user gets a principal on the run — in `EventMeta.principal`, `ctx.identity`
      // and the identity a credential provider scopes its token vault on. See
      // `identityForRequest`. A transport that named nobody produces `undefined`.
      const identity = identityForRequest(
        request.userId,
        sessionId,
        prior?.identity ?? paused?.conversation.identity,
      );
      // What this turn offers a host that files its own artifacts
      // (`reply.turnArtifacts`): WHERE its claim tickets are redeemed — the one
      // composition the artifact door re-composes for the same caller, built
      // only if a host asks — and where a hook failure is recorded. No session,
      // no scope: nothing a later request presents could ever redeem an
      // anonymous run's artifacts, so there is nothing to bind.
      const stored = prior?.identity ?? paused?.conversation.identity;
      const offer: TurnOffer = {
        ...(sessionId !== undefined && {
          session: {
            id: sessionId,
            scope: () => sessionArtifactScope(request.userId, sessionId, stored),
          },
        }),
        timeoutMs: turnArtifactsTimeoutMs,
        ...(request.signal !== undefined && { signal: request.signal }),
        note,
      };
      const optionsForRun: AgentRunOptions | undefined =
        request.signal !== undefined || sessionId !== undefined || identity !== undefined
          ? {
              ...(request.signal !== undefined && { env: { signal: request.signal } }),
              ...(sessionId !== undefined && { sessionId }),
              ...(identity !== undefined && { identity }),
            }
          : undefined;
      // A request with no session is its OWN conversation for self-explain
      // (B1, recheck RB1): keyed by a random UUID minted for this request, in
      // the `hosted:` key space no session id can enter — so no other caller,
      // signed in or not, can name it. It is not a session: memory, telemetry
      // and teardown are untouched (`core/agent/servingConversation.ts`).
      const runOptions: AgentRunOptions | undefined =
        sessionId === undefined
          ? withHostedConversation(optionsForRun, globalThis.crypto.randomUUID())
          : optionsForRun;
      /**
       * The options THIS run is handed, with the credential the request
       * carries sealed by the app (`sealRequest`) — asked only on the two
       * paths that run, after every refusal, so a refused request seals
       * nothing. The handle rides the run's options alone: never the reply,
       * the stored session or the checkpoint.
       */
      const withSealedRequest = async (): Promise<AgentRunOptions | undefined> => {
        const sealed = await sealRequest?.({ headers: request.headers ?? {} });
        return sealed === undefined ? runOptions : { ...runOptions, request: sealed };
      };

      // ── The one discriminant ─────────────────────────────────────────
      // A request carrying `decision` answers a pending question; a request
      // without one is a new message. Never inferred from the text: reading
      // approval out of prose is a guess, and a consent gate may not be built
      // on a guess.
      if (request.decision !== undefined) {
        if (answered !== undefined) {
          // One decision runs one call, and this request's decision was used.
          reply.fail(answeredRefusal(answered));
          return;
        }
        if (!paused) {
          reply.fail(new NoPendingAskError(sessionId ?? '(anonymous)'));
          return;
        }
        if (unanswerablePause(paused, runner) === 'carrier-unreadable') {
          await lane.writer?.settle();
          if (sessionId !== undefined)
            await store.persist(
              sessionId,
              toEnvelope(await closedConversation(paused, { runner, store })),
            );
          reply.complete(UNANSWERABLE_QUESTION);
          return;
        }
        const inputRequest =
          pauseDemandsDecision(paused.checkpoint.pauseData) === undefined
            ? readAwaitingInput(paused.checkpoint.pauseData)
            : undefined;
        if (inputRequest !== undefined) {
          const response = applyInputResponse(inputRequest, request.decision);
          if ('cancel' in response) {
            // Data collection, never permission: settle unanswered calls
            // without executing their handlers or consulting the model.
            const history = [...paused.conversation.history];
            for (const call of openToolCalls(paused.conversation.history))
              history.push({
                role: 'tool',
                toolName: call.name,
                toolCallId: call.id,
                ...(paused.checkpoint.sharedState.findingsServe !== undefined && {
                  toolResultOrigin: 'input-cancelled' as const,
                }),
                content: JSON.stringify({
                  status: 'input_cancelled',
                  requestId: response.requestId,
                }),
              });
            const output = 'Input request cancelled.';
            history.push({ role: 'assistant', content: output });
            const { skillCursor: _cursor, ...conversation } = paused.conversation;
            void _cursor;
            const control = runnerLive(runner)?.pause;
            if (control === undefined) throw new TypeError('Agent pause ownership is unavailable');
            await control.abandon(paused.checkpoint);
            await lane.writer?.settle();
            if (sessionId !== undefined)
              await store.persist(
                sessionId,
                toEnvelope({ ...conversation, history, checkpointedAt: Date.now() }),
              );
            // A turn that ends, so the host is offered its binding like any
            // other — but no run happened, so there is no run id to stamp.
            await offerTurnArtifacts(runner, reply, offer, () => undefined);
            reply.complete(output);
            return;
          }
        }
        const resumeOptions = await withSealedRequest();
        // Opened before the answer is handed over: what it sees says whether a
        // failure below may have used the decision (`answeredPause.ts`).
        const watch = watchAnswer(paused);
        try {
          const turn = hostedTurnOf(runner);
          await deliver(
            lane,
            await turn.resume(paused.checkpoint, request.decision, resumeOptions, bind),
            store,
            reply,
            sessionId,
            offer,
            paused,
          );
        } catch (err) {
          // Settle the stored question before reporting a resume or write failure.
          // Ledger observations follow the request signal (`answeredPause.ts`).
          if (sessionId !== undefined) {
            await afterFailedAnswer({
              store,
              sessionId,
              paused,
              watch,
              answer: request.decision,
              error: err,
              signal: request.signal,
              settle: () => lane.writer?.settle(),
              runner,
            });
          }
          throw err;
        } finally {
          watch?.release();
        }
        return;
      }
      if (paused && sessionId !== undefined) {
        if (unanswerablePause(paused, runner) === undefined) {
          // The message is not run and the pause is not discarded. Both of the
          // other options lose something a person cared about.
          reply.fail(new AwaitingDecisionError(sessionId, paused.pending));
          return;
        }
        // …unless no answer can ever reach it: paused before requests were
        // named, its call changed after the ask, or an ask made under rules
        // this agent no longer runs. Held, it would hold the session for
        // good — so it is closed, the message continues the conversation, and
        // the calls it left open are recorded as not run only when the ledger
        // the request was minted under proves it, else as possibly run
        // (`answeredPause.ts`).
        prior = await closedConversation(paused, { runner, store });
        paused = undefined;
      }

      const turnOptions = await withSealedRequest();
      const turn = hostedTurnOf(runner);
      const completed = await turn.run(
        { message: request.input, ...(prior !== undefined && { continueFrom: prior }) },
        turnOptions,
        bind,
      );
      await deliver(lane, completed, store, reply, sessionId, offer);
    } catch (err) {
      // A run that threw still has to drain. A write left in flight would race
      // the NEXT turn's terminal write and could land after it. The drain's own
      // failure is swallowed here and only here: the caller is already being
      // told about the run's error, and replacing it with a storage error would
      // hide the thing that actually went wrong.
      await lane.writer?.settle().catch(() => undefined);
      throw err;
    } finally {
      lane.turn = undefined;
      lane.activeSessionId = undefined;
      lane.activeOwner = undefined;
    }
  }

  /** Store what the run left behind, then end the reply with the right terminal. */
  async function deliver(
    lane: Lane,
    completed: HostedTurn,
    store: SessionLifecycle,
    reply: HostReply,
    sessionId: string | undefined,
    offer: TurnOffer,
    priorPause?: PausedRun,
  ): Promise<void> {
    const runner = lane.agent;
    const { output, ownership } = completed;
    if (isPaused(output)) {
      let stored = false;
      try {
        // Progress must settle before the terminal envelope. A failed writer,
        // failed persistence or unsupported reply still disposes only this
        // captured occurrence when ownership did not reach the store.
        await lane.writer?.settle();
        const pending = describePause(output, sessionId);
        const conversation =
          sessionId === undefined
            ? undefined
            : output.awaitingInput !== undefined &&
              output.awaitingInput.requestId === priorPause?.pending.awaitingInput?.requestId
            ? priorPause.conversation
            : completed.conversation;
        if (sessionId !== undefined && conversation) {
          await store.persist(
            sessionId,
            toPausedEnvelope({ checkpoint: output.checkpoint, conversation, pending }),
          );
          stored = true;
          if (reply.awaiting) {
            // The run id for `origin` comes from the conversation just
            // snapshotted. When that is the PRIOR pause's — re-used because
            // the same question is still open, which is what a partial answer
            // does WITHOUT running anything — no origin is stamped: this
            // request ran nothing, and the instance's last run may be another
            // session's. Absent is never wrong; a borrowed run id would be.
            await offerTurnArtifacts(runner, reply, offer, () =>
              conversation === priorPause?.conversation ? undefined : conversation?.runId,
            );
            reply.awaiting(pending);
            return;
          }
        }
        // Either there was nowhere to store it, or the host cannot describe a
        // question. Both are refusals about THIS reply, not about the run.
        reply.fail(new PauseNotCarriedError(pending.tool, sessionId, conversation !== undefined));
        return;
      } finally {
        // Successful persistence transfers the captured question guard only.
        // Without a store, dispose that actual occurrence's resources. Neither
        // operation follows the shared instance's later selected run.
        if (stored) ownership?.release();
        else await ownership?.abandon();
      }
    }

    // A progress write may not overtake the final completed conversation.
    await lane.writer?.settle();
    let conversation: AgentRunCheckpoint | undefined;
    if (sessionId !== undefined) {
      conversation = completed.conversation;
      // Persist BEFORE answering: the caller learns the answer only once the
      // conversation that produced it is durable, so a queued next turn can
      // never read state older than the answer already given.
      if (conversation) await store.persist(sessionId, toEnvelope(conversation));
    }
    // The snapshot just persisted names the run that answered — the same id
    // the run's own recording carries on its `origin` — so stamping a host's
    // filing costs no second snapshot.
    await offerTurnArtifacts(runner, reply, offer, () => conversation?.runId);
    reply.complete(typeof output === 'string' ? output : String(output));
  }
  return answerOne;
}

export type TurnRunner = ReturnType<typeof createTurnRunner>;
