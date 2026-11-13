import type { ToolResourcesOperations } from '../contracts/operations/resources.js';
import { type DecisionLedger, spendDecision } from '../../../../consentRequest.js';
import { buildToolResolver } from '../../toolResolver.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { boundArgsOf } from '../access/bindings.js';
import { type CheckInDecision, declinedResult } from '../../../../checkin.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ReadToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import type { ResumedCallFacts, TransitionBatchState } from '../contracts/callFacts.js';
import type { ToolParty } from '../../../../slots/buildToolsSlot.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { safeStringify } from '../../../validators.js';
import { serveNegativeHandle } from '../../../negativeClaims/capture.js';
import { appendBatchResult } from '../batch/settle.js';
import { judgeLanded } from '../evidence/judgeLanded.js';
import { type DispatchSettlement, outcomeField } from '../execution/callOutcome.js';
import type { ResumeConsentFrame } from '../contracts/resumeFrames.js';
import type { ResumedInvocation } from '../contracts/operations/resumedInvocation.js';
import type { ToolMiddlewareOperations } from '../contracts/operations/middleware.js';
import type { ToolArtifactsOperations } from '../contracts/operations/artifacts.js';
import type { ToolLimitsOperations } from '../contracts/operations/limits.js';
import type { ToolStepsOperations } from '../contracts/operations/steps.js';
import type { ToolEffectsOperations } from '../contracts/operations/effects.js';
import type { ToolSettlementOperations } from '../contracts/operations/settlement.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolObservationsOperations } from '../contracts/operations/observations.js';

interface ResumeCheckInLinks {
  readonly endCall: ToolResourcesOperations['endCall'];
  readonly decisionLedger: DecisionLedger;
  readonly resolveTool: ReturnType<typeof buildToolResolver>;
  readonly resolveCredentialAndExecute: ResumedInvocation['resolveCredentialAndExecute'];
  readonly afterMoment: ToolMiddlewareOperations['afterMoment'];
  readonly placeResults: ToolArtifactsOperations['placeResults'];
  readonly capResults: ToolLimitsOperations['capResults'];
  readonly applyStepReturn: ToolStepsOperations['applyStepReturn'];
  readonly applyToolEffects: ToolEffectsOperations['applyToolEffects'];
  readonly emitTransitionConflict: ToolEffectsOperations['emitTransitionConflict'];
  readonly settleBatch: ToolSettlementOperations['settleBatch'];
  readonly turnStampOf: ToolCatalogOperations['turnStampOf'];
  readonly fileResumedScript: ToolScriptsOperations['fileResumedScript'];
  readonly emitToolEnd: ToolObservationsOperations['emitToolEnd'];
  readonly bracketSettled: ToolSettlementOperations['bracketSettled'];
}

/** Compose only the existing checkIn resume door and its original landing order. */
export function buildResumeCheckIn(
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'inputsLayer'
    | 'resources'
    | 'negativeClaimsArmed'
    | 'stepPlanFor'
    | 'findings'
    | 'findingsJudge'
  >,
  links: ResumeCheckInLinks,
) {
  const resumeCheckIn = async (
    scope: TypedScope<AgentState>,
    frame: ResumeConsentFrame,
  ): Promise<void> => {
    const { consentDecision, runSignal, toolName, toolCallId, startMs } = frame;

    const iteration = scope.iteration as number;
    // The copy the person approved, detached (`boundArgsOf`).
    const args = boundArgsOf(scope, 'pausedCheckInArgs');
    // A check-in pause is resumed with a CheckInDecision for THIS request
    // and this exact call, or not at all: `heldAnswer` refused anything else
    // at the top — a bare string, a decision for another request, a replay.
    // A consequential tool never EXECUTES from a malformed resume, and a
    // decline is never invented for one.
    const decision: CheckInDecision = consentDecision;
    // Used from here — so spent here, before the record or the tool: a
    // second resume presenting it is refused ('already-answered').
    await spendDecision(
      links.decisionLedger,
      decision,
      'checkIn',
      runSignal,
      deps.resources?.answer,
    );

    // The registered component that COLLECTED this decision (9.24.0),
    // written at pause time only when the ask carried one. The decision
    // stays exactly what it was — a structured `CheckInDecision`, never
    // parsed from prose — and the record now says which surface asked.
    const answeredVia = scope.pausedComponentId as string | undefined;
    typedEmit(scope, 'agentfootprint.checkin.decision', {
      toolName,
      toolCallId,
      iteration,
      requestId: decision.requestId,
      approved: decision.approved,
      by: decision.by,
      ...(decision.note !== undefined && { note: decision.note }),
      ...(answeredVia !== undefined && { componentId: answeredVia }),
    });

    let result: unknown;
    /** What the model reads — see the ask path above. */
    let modelResult: unknown;
    let error: boolean | undefined;
    /** Step-advance eligibility, judged by this path (a decline ran nothing). */
    let stepToolRan = false;
    /** The effects envelope the approved call returned (9.19.0). */
    let resumeEnvelope: ReadToolResultEnvelope | undefined;
    /** The unknown status word of a result that is an envelope but for it. */
    let resumeUnknownStatus: string | undefined;
    /** The tool ran (any outcome) — the judge's gate (9.104.0). */
    let toolRan = false;
    let negativeResultId: string | undefined;
    /** What the approved call's `execute` saw — its script row reads it. */
    const scriptSeen: ResumedCallFacts = {};
    if (decision.approved) {
      const env = scope.$getEnv();
      // Resolved against the party the checkpoint carries (9.92.0).
      const resolved = links.resolveTool(toolName, scope.pausedToolParty as ToolParty | undefined);
      const tool = resolved.tool;
      const dispatched = await links.resolveCredentialAndExecute(
        scope,
        resolved,
        toolName,
        args,
        toolCallId,
        iteration,
        env,
        'checkIn',
        scriptSeen,
      );
      negativeResultId = dispatched.negativeResultId;
      result = dispatched.result;
      error = dispatched.error;
      toolRan = dispatched.executed === true;
      // Same ceiling law as the ask path: ran ≠ completed a step (9.20.0).
      stepToolRan =
        dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true;
      if (dispatched.executed === true && error !== true) {
        resumeEnvelope = dispatched.envelope;
        resumeUnknownStatus = dispatched.unknownStatus;
      }
      // Consent moved the execution to this side of the pause; the rules
      // about results move with it.
      if (dispatched.executed === true) {
        modelResult = await links.afterMoment(scope, {
          ...(tool && { tool }),
          toolName,
          toolCallId,
          iteration,
          args,
          result,
          negativeResultId,
          ...(error === true && { error: true }),
          history: [...(scope.history as readonly LLMMessage[])],
          ...(scope.runIdentity && { identity: scope.runIdentity }),
          ...(env.signal && { signal: env.signal }),
        });
      }
    } else {
      result = declinedResult(decision.note);
    }

    if (modelResult === undefined) modelResult = result;
    // Placement then the truncation net — the batch loop's precedence.
    const decisionPlaced = await links.placeResults(
      scope,
      { toolName, toolCallId, iteration },
      { result, modelResult },
      stepToolRan,
    );
    const decisionCapped = links.capResults(toolName, decisionPlaced);
    modelResult = decisionCapped.modelResult;
    let decisionResultStr =
      typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
    const decisionToolChars = decisionResultStr.length;
    if (deps.negativeClaimsArmed === true)
      decisionResultStr = serveNegativeHandle(scope, negativeResultId, decisionResultStr);
    // How the call settled — read by the step and by the message's `outcome`.
    const decisionSettled: DispatchSettlement = {
      ran: toolRan,
      clean: stepToolRan,
      ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
      ...(resumeUnknownStatus !== undefined && { unknownStatus: resumeUnknownStatus }),
    };
    // Step boundary (9.18.0) — a checkIn tool CAN be a step's tool: an
    // approved call advances or holds its step here by the same rule as the
    // batch loop (`stepOutcomeOf`); a decline ran nothing and holds silently.
    if (deps.stepPlanFor) {
      decisionResultStr += links.applyStepReturn(scope, {
        toolName,
        toolCallId,
        iteration,
        settled: decisionSettled,
      });
    }
    // Typed tool effects (9.19.0) — an approved consequential call may
    // carry them too; judged exactly as inline.
    if (resumeEnvelope !== undefined) {
      const decisionTransition: TransitionBatchState = { losers: [] };
      decisionResultStr += links.applyToolEffects(
        scope,
        { toolName, toolCallId, iteration },
        resumeEnvelope,
        decisionTransition,
      );
      links.emitTransitionConflict(scope, iteration, decisionTransition);
    }
    // The batch settlement (9.113.0) — the ask path's twin.
    const decisionSettlement = links.settleBatch(
      [
        ...(scope.history as readonly LLMMessage[]),
        {
          role: 'tool',
          content: decisionResultStr,
          ...(deps.negativeClaimsArmed === true && { toolChars: decisionToolChars }),
          toolCallId,
          toolName,
          ...(deps.findings === true && !toolRan && { toolResultOrigin: 'not-entered' as const }),
          // A decline ran nothing → 'refused'; read by the check-in trail.
          ...outcomeField(decisionSettled),
        },
      ],
      { toolName, toolCallId },
    );
    const decisionHistory = decisionSettlement.history;
    scope.history = decisionHistory;
    // Drives `on-tool-return` triggers, same as the execute path.
    scope.lastToolResult = {
      toolName,
      result: decisionResultStr,
      ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
    };
    appendBatchResult(scope, {
      toolName,
      result: decisionResultStr,
      toolCallId,
      ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
    });
    await judgeLanded(
      scope,
      deps.findingsJudge,
      toolRan,
      { toolName, result: decisionResultStr, toolCallId },
      iteration,
      links.turnStampOf(scope),
    );
    links.fileResumedScript(scope, {
      toolName,
      toolCallId,
      iteration,
      carried: args,
      entered: toolRan,
      seen: scriptSeen,
    });
    links.emitToolEnd(
      scope,
      toolName,
      {
        toolCallId,
        result: decisionCapped.result,
        durationMs: Date.now() - startMs,
        ...(error === true && { error: true }),
        ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        ...(decisionCapped.modelResult !== decisionCapped.result && {
          modelResult: decisionCapped.modelResult,
        }),
      },
      toolRan,
      undefined,
      negativeResultId,
      args,
    );
    links.bracketSettled(scope, decisionSettlement);
    typedEmit(scope, 'agentfootprint.agent.iteration_end', {
      turnIndex: 0,
      iterIndex: iteration,
      // The brackets this leg closed — see the ask path's twin.
      toolCallCount: 1 + decisionSettlement.settled.length,
      history: decisionHistory,
    });
    if (deps.inputsLayer === true) scope.argumentAsk = undefined;
    scope.iteration = iteration + 1;
    // Clear ALL pause checkpoint fields (shared + check-in).
    await links.endCall(scope);
    scope.pausedToolCallId = '';
    scope.pausedToolName = '';
    scope.pausedToolStartMs = 0;
    scope.pausedCheckIn = false;
    scope.pausedCheckInArgs = undefined;
    // The request was answered — and spent — by this resume.
    scope.pausedRequest = undefined;
    // Cleared ONLY when it was set — see the ask path's twin note.
    if (answeredVia !== undefined) scope.pausedComponentId = undefined;
    // The served party the checkpoint carried is consumed with it (9.92.0);
    // written back only when it was there, so an older checkpoint's resume
    // commits exactly what it always did.
    if (scope.pausedToolParty !== undefined) scope.pausedToolParty = undefined;
    return;
  };
  return { resumeCheckIn };
}
