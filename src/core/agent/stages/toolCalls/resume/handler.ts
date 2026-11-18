import { restoreServedParties } from '../../servedParties.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { PausableHandler, TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ConsentGateKind } from '../../../../pause.js';
import { noteDecisionTakenUp, recordedRequestId } from '../../../../consentRequest.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { findingsReferenceRefusal } from '../../../findings/admission.js';
import type { ToolCallOperations } from '../compose.js';

/** Existing native resume admission and four door-specific continuations. */
export function buildToolResume(
  deps: ToolCallsHandlerDeps,
  operations: ToolCallOperations,
): PausableHandler<TypedScope<AgentState>>['resume'] {
  const resume: PausableHandler<TypedScope<AgentState>>['resume'] = async (scope, input) => {
    deps.resources?.expectAnswer();
    restoreServedParties(scope, deps.servedTools);
    // A consent gate's answer is a DECISION for ONE request: held to the
    // request this run paused on and to the exact call it was bound to —
    // refused (thrown) before anything below writes or runs. The two
    // decision paths further down spend it as their first act, once.
    const consentGate: ConsentGateKind | undefined =
      scope.pausedAsk === true ? 'ask' : scope.pausedCheckIn === true ? 'checkIn' : undefined;
    // Taken up here, too: a composition resumes this chart without an
    // agent's own `resume()`, and a door watching the paused request must
    // still know that every use of its decision passes through the spend
    // below (`consentRequest.ts` · `watchDecisionUse`).
    if (consentGate !== undefined) {
      noteDecisionTakenUp(recordedRequestId(scope.$getValue('pausedRequest')));
    }
    // Checkpoint resource preflight may refuse without spending the decision.
    deps.resources?.restore(scope, operations.resourceFactsOf(scope));
    // The run's signal, read while the stage is live: the engine stops
    // waiting on this stage when the run is aborted, but the stage goes on,
    // and a decision must not be spent — nor its call run — by a resume
    // nobody is waiting for any more (`spendDecision`).
    const runSignal = scope.$getEnv().signal;
    // Same barrier as `execute`, for the same reason: an approved check-in
    // runs the REAL tool here, and that side effect must not go out ahead of
    // the state the last write is still carrying.
    const durable = deps.awaitDurable?.();
    if (durable) await durable;
    const consentDecision =
      consentGate === undefined ? undefined : operations.heldAnswer(scope, input, consentGate);
    // Fresh components discover tools; saved party and current rules still govern dispatch.
    const catalog = deps.prepareProviderTools?.(scope);
    if (catalog) await catalog;
    runSignal?.throwIfAborted();
    // A check-in's approval covers the view it was asked on (`access/heldView.ts`).
    if (consentGate === 'checkIn') operations.heldView(scope);
    // The time layer: the paused turn's clock is KEPT — its words were
    // resolved against it. A resume that passed a different `time` is
    // recorded here, first, and never applied (TQ21).
    if (deps.time !== undefined) {
      (await import('../../timeLayer.js')).recordClockOnResume(scope, deps.time);
    }

    // Consumer-supplied resume input becomes the paused tool's result.
    // The subflow's pre-pause scope is restored automatically by
    // footprintjs 4.17.0 via `checkpoint.subflowStates`, so
    // `scope.history` and `scope.pausedToolCallId` read back cleanly
    // across same-executor AND cross-executor resume.
    const toolCallId = scope.pausedToolCallId as string;
    const toolName = scope.pausedToolName as string;
    const startMs = scope.pausedToolStartMs as number;
    // A batch paused before anything stamped it — a checkpoint written by an
    // older build, or by an agent without the results layer — is stamped
    // here as it completes, so the loop head still judges it once (honesty
    // layer 3). A batch dispatched under the arm already carries its stamp.
    if (deps.resultsLayer === true && scope.toolResultsIteration === undefined) {
      scope.toolResultsIteration = scope.iteration as number;
    }

    if (deps.findings === true) {
      const proposed = [...(scope.history as readonly LLMMessage[])]
        .reverse()
        .find(
          (message) =>
            message.role === 'assistant' &&
            message.toolCalls?.some((call) => call.id === toolCallId),
        )
        ?.toolCalls?.filter((call) => call.id === toolCallId);
      const declaration = proposed?.length === 1 ? operations.peelCall(proposed[0]!) : undefined;
      const refusal =
        proposed?.length === 1
          ? findingsReferenceRefusal(
              declaration?.findings,
              scope.findingsRequest?.[0],
              scope.iteration,
              declaration?.malformed,
            )
          : JSON.stringify({
              refused: 'findings-reference',
              reason: 'The original paused proposal is unavailable or ambiguous.',
            });
      if (refusal !== undefined) {
        scope.messageDeniedReason = refusal;
        scope.messageDeniedPhase = 'output';
        scope.messageDeniedBy = 'findings-reference-admission';
        scope.$break('findings reference refused the resumed proposal');
        return;
      }
    }

    // ── Middleware-ask decision path ─────────────────────────────────
    // Discriminated by `scope.pausedAsk`, restored from the checkpoint.
    //
    // The answer is a DECISION, not a result. That is the whole reason the
    // outcome union has no `result` arm: a middleware asks a person whether
    // this call may proceed, and on approval the REAL tool runs — the person
    // never writes the tool's answer, and neither does the middleware.
    //
    // A malformed resume never reaches here: `heldAnswer` refused it at the
    // top (a governed call never executes, and nobody's decline is invented,
    // because a message was mis-shaped).
    if (consentGate === 'ask' && consentDecision !== undefined) {
      return operations.resumeAsk(scope, {
        consentDecision,
        runSignal,
        toolName,
        toolCallId,
        startMs,
      });
    }

    // ── Check-in decision path ───────────────────────────────────────
    // A check-in pause is discriminated by `scope.pausedCheckIn` (restored
    // from the checkpoint). The resume input is a `CheckInDecision`. On
    // APPROVE the tool executes NOW (it never ran at pause time — consent
    // comes BEFORE execute); on DECLINE a model-visible tool_result lands so
    // the agent adapts in-loop. The typed `checkin.decision` event fires
    // either way. Same iteration semantics as resume-after-askHuman.
    if (consentGate === 'checkIn' && consentDecision !== undefined) {
      return operations.resumeCheckIn(scope, {
        consentDecision,
        runSignal,
        toolName,
        toolCallId,
        startMs,
      });
    }

    // ── Credential-consent decision path (8.6.0) ─────────────────────
    // Discriminated by `scope.pausedCredential`, restored from the checkpoint.
    //
    // The resume input is IGNORED, and that is the design rather than an
    // omission. The person's answer here is "I authorized it", not a result:
    // they consented at the identity provider, out of band. So resume asks
    // the provider again and, if it now issues, runs the tool that was
    // waiting — the same reasoning that gave the middleware-ask outcome union
    // no `result` arm. A human never writes a tool's answer.
    //
    // Still not authorized? `resolveCredentialAndExecute` returns the
    // URL-free refusal with `error: true` and reports the outstanding
    // consent; the loop carries on and a further attempt can pause afresh.
    if (scope.pausedCredential === true) {
      return operations.resumeCredential(scope, { toolName, toolCallId, startMs });
    }
    return operations.resumePlain(scope, { input, toolName, toolCallId, startMs });
  };
  return async (scope, input) => {
    try {
      return await resume(scope, input);
    } finally {
      if (deps.servedTools !== undefined) {
        deps.servedTools.pinned = undefined;
        deps.servedTools.restored = undefined;
      }
    }
  };
}
