import { finalizeResumedResult } from '../../../resultRowsets/resumed.js';
import type { ToolResourcesOperations } from '../contracts/operations/resources.js';
import { type DecisionLedger, spendDecision } from '../../../../consentRequest.js';
import { buildToolResolver } from '../../toolResolver.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { boundArgsOf } from '../access/bindings.js';
import { type CheckInDecision, declinedResult } from '../../../../checkin.js';
import type { ReadToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import type { ResumedCallFacts, TransitionBatchState } from '../contracts/callFacts.js';
import { recordDecisions } from '../../../middleware/ledger.js';
import type { ToolParty } from '../../../../slots/buildToolsSlot.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { PRESENT_TOOL_NAME } from '../../../../../artifacts/present.js';
import { safeStringify } from '../../../validators.js';
import { serveNegativeHandle } from '../../../negativeClaims/capture.js';
import { appendBatchResult } from '../batch/settle.js';
import { judgeLanded } from '../evidence/judgeLanded.js';
import type { DispatchSettlement } from '../../../../../semantics/toolOutcome.js';
import { outcomeField, reportedStatusField } from '../execution/outcomeField.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ResumeConsentFrame } from '../contracts/resumeFrames.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolSettlementOperations } from '../contracts/operations/settlement.js';
import type {
  ResumedInvocation,
  ResumedPolicyHalt,
} from '../contracts/operations/resumedInvocation.js';
import type { ToolStepsOperations } from '../contracts/operations/steps.js';
import type { ToolArtifactsOperations } from '../contracts/operations/artifacts.js';
import type { ToolMiddlewareOperations } from '../contracts/operations/middleware.js';
import type { ToolLimitsOperations } from '../contracts/operations/limits.js';
import type { ToolEffectsOperations } from '../contracts/operations/effects.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolObservationsOperations } from '../contracts/operations/observations.js';
import { sourceEvidenceHaltOf } from '../../../sourceEvidence/permissions.js';
import { innerCallsFieldOf } from '../../../innerToolCalls.js';
import { haltResumedCall } from '../routing/policyHalt.js';

interface ResumeAskLinks {
  readonly endCall: ToolResourcesOperations['endCall'];
  readonly decisionLedger: DecisionLedger;
  readonly resolveTool: ReturnType<typeof buildToolResolver>;
  readonly resolveCredentialAndExecute: ResumedInvocation['resolveCredentialAndExecute'];
  readonly frameworkSkipStepAnswered: ToolCatalogOperations['frameworkSkipStepAnswered'];
  readonly applySkipStep: ToolStepsOperations['applySkipStep'];
  readonly applyPresent: ToolArtifactsOperations['applyPresent'];
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

/** Compose only the existing ask resume door and its original landing order. */
export function buildResumeAsk(
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'resources'
    | 'inputsLayer'
    | 'artifactStore'
    | 'negativeClaimsArmed'
    | 'stepPlanFor'
    | 'findings'
    | 'findingsJudge'
  >,
  links: ResumeAskLinks,
) {
  const resumeAsk = async (
    scope: TypedScope<AgentState>,
    frame: ResumeConsentFrame,
  ): Promise<void> => {
    const { consentDecision, runSignal, toolName, toolCallId, startMs } = frame;

    const iteration = scope.iteration as number;
    // What the rest of the chain is handed: a detached copy of the
    // approved arguments (`boundArgsOf`). The arguments that come back are
    // held to the REQUEST, never to this copy — a link that edits it in
    // place edits the copy — and the tool runs on another fresh copy.
    const args = boundArgsOf(scope, 'pausedAskArgs');
    const askedBy = (scope.pausedAskMiddleware ?? 'middleware') as string;
    // The registered component that COLLECTED this decision (9.24.0),
    // written at pause time only when the ask carried one — the ledger
    // rows below then say which surface the person answered through.
    const answeredVia = scope.pausedComponentId as string | undefined;
    const decision: CheckInDecision = consentDecision;
    // Used from here — so spent here, before any row or the tool: a second
    // resume presenting it is refused ('already-answered').
    await spendDecision(links.decisionLedger, decision, 'ask', runSignal, deps.resources?.answer);

    let result: unknown;
    /** What the model reads. Differs from `result` only when a rule at the
     *  after-tool moment transformed or withheld it. */
    let modelResult: unknown;
    let error: boolean | undefined;
    /** The call REALLY ran, clean — the step-advance eligibility this
     *  path knows about itself (a decline or a chain-deny never ran). */
    let stepToolRan = false;
    /** The effects envelope the resumed call returned (9.19.0). */
    let resumeEnvelope: ReadToolResultEnvelope | undefined;
    let resumeUnknownStatus: string | undefined;
    /** The tool ran (any outcome) — the judge's gate (9.104.0). */
    let toolRan = false;
    let negativeResultId: string | undefined;
    let resumedHalt: ResumedPolicyHalt | undefined;
    /** What the approved call's `execute` saw — its script row reads it. */
    const scriptSeen: ResumedCallFacts = {};
    try {
      if (!decision.approved) {
        result = declinedResult(decision.note);
        recordDecisions(scope, [
          {
            middleware: askedBy,
            moment: 'before-tool',
            at: 'tool',
            toolName,
            toolCallId,
            iteration,
            outcome: 'deny',
            personApproved: false,
            changed: false,
            why: `declined by ${decision.by}${decision.note ? `: ${decision.note}` : ''}`,
            ...(answeredVia !== undefined && { componentId: answeredVia }),
          },
        ]);
      } else {
        recordDecisions(scope, [
          {
            middleware: askedBy,
            moment: 'before-tool',
            at: 'tool',
            toolName,
            toolCallId,
            iteration,
            outcome: 'allow',
            personApproved: true,
            changed: false,
            why: `approved by ${decision.by}${decision.note ? `: ${decision.note}` : ''}`,
            ...(answeredVia !== undefined && { componentId: answeredVia }),
          },
        ]);
        // The common resumed admission rechecks today's policy and the bound call.
        const resolved = links.resolveTool(
          toolName,
          scope.pausedToolParty as ToolParty | undefined,
        );
        const tool = resolved.tool;
        const runArgs = args;
        const env = scope.$getEnv();
        const dispatched = await links.resolveCredentialAndExecute(
          scope,
          resolved,
          toolName,
          runArgs,
          toolCallId,
          iteration,
          env,
          'ask',
          scriptSeen,
        );
        resumedHalt = dispatched.halt;
        negativeResultId = dispatched.negativeResultId;
        result = dispatched.result;
        error = dispatched.error;
        toolRan = dispatched.executed === true;
        // A ceiling-refused call RAN but must not advance a step (9.20.0);
        // its envelope — status 'invalid' plus any surviving declared
        // effects — is still picked up and judged below.
        stepToolRan =
          dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true;
        if (dispatched.executed === true && error !== true) {
          resumeEnvelope = dispatched.envelope;
          resumeUnknownStatus = dispatched.unknownStatus;
        }
        // skip_step behind a middleware ask, approved (9.18.0): the
        // placeholder just landed — replace it with the authoritative
        // sentence BEFORE the chain's last word, the execute loop's
        // composition kept.
        if (links.frameworkSkipStepAnswered(toolName, tool) && stepToolRan) {
          result = links.applySkipStep(scope, { args: runArgs, toolCallId, iteration });
        }
        // present behind a middleware ask, approved (9.22.0): same
        // overwrite the batch loop applies — the snapshot (or refusal)
        // replaces the placeholder before the chain's last word. A miss
        // is an errored call here too.
        if (deps.artifactStore && toolName === PRESENT_TOOL_NAME && stepToolRan) {
          const presented = await links.applyPresent(scope, {
            args: runArgs,
            toolCallId,
            iteration,
          });
          result = presented.text;
          if (!presented.ok) {
            error = true;
            stepToolRan = false;
          }
        }
        // The tool ran on this side of the pause, so the chain gets its
        // last word here too — a rule about results cannot be skipped by
        // routing a call through a human.
        if (dispatched.executed === true) {
          modelResult = await links.afterMoment(scope, {
            ...(tool && { tool }),
            toolName,
            toolCallId,
            iteration,
            args: runArgs,
            result,
            negativeResultId,
            ...(scriptSeen.resultFinalizer && {
              onSourceWithheld: scriptSeen.resultFinalizer.withheld,
            }),
            ...(error === true && { error: true }),
            history: [...(scope.history as readonly LLMMessage[])],
            ...(scope.runIdentity && { identity: scope.runIdentity }),
            ...(env.signal && { signal: env.signal }),
          });
        }
      }

      // `modelResult` is only set where the after-tool moment ran; everywhere
      // else the two are the same value.
      if (modelResult === undefined) modelResult = result;
      // Placement then the truncation net — the batch loop's precedence,
      // kept on this door (a resumed result is as placeable as an inline
      // one; `stepToolRan` is exactly "ran clean").
      const askPlaced = await links.placeResults(
        scope,
        { toolName, toolCallId, iteration },
        { result, modelResult },
        stepToolRan,
      );
      let askCapped = links.capResults(toolName, askPlaced);
      modelResult = askCapped.modelResult;
      if (scriptSeen.resultFinalizer) {
        const uncapped = modelResult === askPlaced.modelResult;
        const finalized = await finalizeResumedResult(
          scope,
          scriptSeen.resultFinalizer,
          toolName,
          askCapped,
          {
            eligible: stepToolRan && uncapped,
            ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope?.status }),
            ...(!uncapped && { unavailableReason: 'result-capped' as const }),
          },
          links.capResults,
          negativeResultId,
        );
        askCapped = finalized.values;
        modelResult = askCapped.modelResult;
        if (finalized.refused) {
          result = askCapped.result;
          stepToolRan = false;
          resumeEnvelope = { content: result, effects: [], status: 'invalid', malformed: [] };
        }
      }
      scriptSeen.resultFinalizer?.assertFinalized();
      const sourceHalt = sourceEvidenceHaltOf(scope);
      if (sourceHalt && resumedHalt === undefined)
        scope.$break(`policy-halt: ${sourceHalt.reason}`);
      let askResultStr = typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
      const askToolChars = askResultStr.length;
      if (deps.negativeClaimsArmed === true)
        askResultStr = serveNegativeHandle(scope, negativeResultId, askResultStr);
      // How the call settled — read by the step and by the message's `outcome`.
      const askSettled: DispatchSettlement = {
        ran: toolRan,
        clean: stepToolRan,
        ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        ...(resumeUnknownStatus !== undefined && { unknownStatus: resumeUnknownStatus }),
      };
      // Step boundary (9.18.0) — a result finalized HERE is as final as one
      // from the batch loop: the answered call advances or holds the step
      // before the push by the same rule (`stepOutcomeOf`).
      if (deps.stepPlanFor) {
        askResultStr = links.applyStepReturn(
          scope,
          { toolName, toolCallId, iteration, settled: askSettled },
          askResultStr,
        );
      }
      // Typed tool effects (9.19.0) — a resumed call's envelope is judged
      // exactly as an inline one's (fresh single-call batch state).
      if (resumeEnvelope !== undefined) {
        const askTransition: TransitionBatchState = { losers: [] };
        askResultStr += links.applyToolEffects(
          scope,
          { toolName, toolCallId, iteration },
          resumeEnvelope,
          askTransition,
        );
        links.emitTransitionConflict(scope, iteration, askTransition);
      }
      // The batch settlement (9.113.0): the answered call's result, then the
      // siblings the pause left un-dispatched, each settled — never run.
      const askSettlement = links.settleBatch(
        [
          ...(scope.history as readonly LLMMessage[]),
          {
            role: 'tool',
            content: askResultStr,
            ...(deps.negativeClaimsArmed === true && { toolChars: askToolChars }),
            toolCallId,
            toolName,
            ...(deps.findings === true && !toolRan && { toolResultOrigin: 'not-entered' as const }),
            ...innerCallsFieldOf(scope, toolCallId, iteration),
            // A declined ask ran nothing → 'refused'; read by the check-in trail.
            ...outcomeField(askSettled),
            ...reportedStatusField(askSettled),
          },
        ],
        { toolName, toolCallId },
      );
      const askHistory = askSettlement.history;
      scope.history = askHistory;
      scope.lastToolResult = {
        toolName,
        result: askResultStr,
        ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
      };
      appendBatchResult(scope, {
        toolName,
        result: askResultStr,
        toolCallId,
        ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
      });
      await judgeLanded(
        scope,
        deps.findingsJudge,
        toolRan,
        { toolName, result: askResultStr, toolCallId },
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
          result: askCapped.result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
          ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
          ...(askCapped.modelResult !== askCapped.result && {
            modelResult: askCapped.modelResult,
          }),
        },
        toolRan,
        undefined,
        negativeResultId,
        args,
      );
      links.bracketSettled(scope, askSettlement);
      typedEmit(scope, 'agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: iteration,
        // The brackets THIS leg closed: the answered call's, plus one per
        // settled sibling. The calls before the paused one closed theirs on
        // the leg that paused, which ended in a checkpoint, not here.
        toolCallCount: 1 + askSettlement.settled.length,
        history: askHistory,
      });
      if (deps.inputsLayer === true) scope.argumentAsk = undefined;
      scope.iteration = iteration + 1;
      await links.endCall(scope);
      scope.pausedToolCallId = '';
      scope.pausedToolName = '';
      scope.pausedToolStartMs = 0;
      scope.pausedAsk = false;
      scope.pausedAskArgs = undefined;
      scope.pausedAskIndex = undefined;
      scope.pausedAskMiddleware = undefined;
      scope.pausedAskChain = undefined;
      // The request was answered — and spent — by this resume.
      scope.pausedRequest = undefined;
      scope.pausedGatePolicy = undefined;
      // Cleared ONLY when it was set: a later component-less pause in this
      // run must not inherit this ask's surface, and a run that never
      // carried one must not gain the key (byte-identical).
      if (answeredVia !== undefined) scope.pausedComponentId = undefined;
      // The served party the checkpoint carried is consumed with it (9.92.0);
      // written back only when it was there, so an older checkpoint's resume
      // commits exactly what it always did.
      if (scope.pausedToolParty !== undefined) scope.pausedToolParty = undefined;
      if (resumedHalt !== undefined) haltResumedCall(scope, resumedHalt, iteration);
      return;
    } catch (error) {
      scriptSeen.resultFinalizer?.withheld();
      throw error;
    } finally {
      scriptSeen.resultFinalizer?.close();
    }
  };
  return { resumeAsk };
}
