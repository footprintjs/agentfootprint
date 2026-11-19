import { finalizeResumedResult } from '../../../resultRowsets/resumed.js';
import type { ToolResourcesOperations } from '../contracts/operations/resources.js';
import { buildToolResolver } from '../../toolResolver.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolParty } from '../../../../slots/buildToolsSlot.js';
import type { ResumedCallFacts, TransitionBatchState } from '../contracts/callFacts.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { safeStringify } from '../../../validators.js';
import { serveNegativeHandle } from '../../../negativeClaims/capture.js';
import { appendBatchResult, missingResultFields } from '../batch/settle.js';
import { judgeLanded } from '../evidence/judgeLanded.js';
import type { DispatchSettlement } from '../../../../../semantics/toolOutcome.js';
import {
  outcomeField,
  reportedStatusField,
  toolResultExecutionField,
} from '../execution/outcomeField.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ResumeCallFrame } from '../contracts/resumeFrames.js';
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
import { sourceEvidenceHaltOf } from '../../../sourceEvidence/permissions.js';
import { innerCallsFieldOf } from '../../../innerToolCalls.js';
import { haltResumedCall } from '../routing/policyHalt.js';
import { takeArguments } from '../../../innerCallArguments.js';

interface ResumeCredentialLinks {
  readonly endCall: ToolResourcesOperations['endCall'];
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

/** Compose only the existing credential resume door and its original landing order. */
export function buildResumeCredential(
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'inputsLayer'
    | 'answerLayer'
    | 'resultsLayer'
    | 'resources'
    | 'negativeClaimsArmed'
    | 'stepPlanFor'
    | 'findings'
    | 'findingsJudge'
  >,
  links: ResumeCredentialLinks,
) {
  const resumeCredential = async (
    scope: TypedScope<AgentState>,
    frame: ResumeCallFrame,
  ): Promise<void> => {
    const { toolName, toolCallId, startMs } = frame;
    deps.resources?.answer.record();

    const iteration = scope.iteration as number;
    const storedArgs = scope.$getValue('pausedCredentialArgs');
    const taken = storedArgs === undefined ? undefined : takeArguments(storedArgs);
    const args = taken?.kind === 'copied' ? taken.args : {};
    const env = scope.$getEnv();
    // Resolved against the party the checkpoint carries (9.92.0).
    const resolved = links.resolveTool(toolName, scope.pausedToolParty as ToolParty | undefined);
    const tool = resolved.tool;
    /** What the call's `execute` saw — its script row reads it. */
    const scriptSeen: ResumedCallFacts = {};
    try {
      const dispatched =
        taken?.kind === 'copied'
          ? await links.resolveCredentialAndExecute(
              scope,
              resolved,
              toolName,
              args,
              toolCallId,
              iteration,
              env,
              'credential',
              scriptSeen,
            )
          : { result: `Tool '${toolName}' could not be authorized after the wait.`, error: true };
      let result = dispatched.result;
      const error = dispatched.error;
      let modelResult: unknown;
      let toolResultDisposition: LLMMessage['toolResultDisposition'];
      if (dispatched.executed === true) {
        ({ modelResult, toolResultDisposition } = await links.afterMoment(scope, {
          ...(tool && { tool }),
          toolName,
          toolCallId,
          iteration,
          args,
          result,
          negativeResultId: dispatched.negativeResultId,
          ...(scriptSeen.resultFinalizer && {
            onSourceWithheld: scriptSeen.resultFinalizer.withheld,
          }),
          ...(error === true && { error: true }),
          history: [...(scope.history as readonly LLMMessage[])],
          ...(scope.runIdentity && { identity: scope.runIdentity }),
          ...(env.signal && { signal: env.signal }),
        }));
      }
      if (modelResult === undefined) modelResult = result;
      // Placement then the truncation net — the batch loop's precedence.
      const consentPlaced = await links.placeResults(
        scope,
        { toolName, toolCallId, iteration },
        { result, modelResult },
        dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true,
      );
      let consentCapped = links.capResults(toolName, consentPlaced);
      modelResult = consentCapped.modelResult;
      if (scriptSeen.resultFinalizer) {
        const uncapped = modelResult === consentPlaced.modelResult;
        const finalized = await finalizeResumedResult(
          scope,
          scriptSeen.resultFinalizer,
          toolName,
          consentCapped,
          {
            eligible:
              dispatched.executed === true &&
              error !== true &&
              dispatched.ceilingRefused !== true &&
              uncapped,
            ...(dispatched.envelope?.status !== undefined && {
              status: dispatched.envelope?.status,
            }),
            ...(!uncapped && { unavailableReason: 'result-capped' as const }),
          },
          links.capResults,
          dispatched.negativeResultId,
        );
        consentCapped = finalized.values;
        modelResult = consentCapped.modelResult;
        if (finalized.refused) {
          result = consentCapped.result;
          dispatched.ceilingRefused = true;
          dispatched.envelope = { content: result, effects: [], status: 'invalid', malformed: [] };
        }
      }
      scriptSeen.resultFinalizer?.assertFinalized();
      const sourceHalt = sourceEvidenceHaltOf(scope);
      if (sourceHalt && dispatched.halt === undefined)
        scope.$break(`policy-halt: ${sourceHalt.reason}`);
      let consentResultStr =
        typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
      const consentToolChars = consentResultStr.length;
      if (deps.negativeClaimsArmed === true)
        consentResultStr = serveNegativeHandle(
          scope,
          dispatched.negativeResultId,
          consentResultStr,
        );
      // Typed tool effects (9.19.0) — same judge as every other path.
      const consentEnvelope =
        dispatched.executed === true && error !== true ? dispatched.envelope : undefined;
      // How the call settled — read by the step and by the message's `outcome`.
      const consentSettled: DispatchSettlement = {
        ran: dispatched.executed === true,
        clean: error !== true && dispatched.ceilingRefused !== true,
        ...(consentEnvelope?.status !== undefined && { status: consentEnvelope.status }),
        ...(dispatched.executed === true &&
          error !== true &&
          dispatched.unknownStatus !== undefined && { unknownStatus: dispatched.unknownStatus }),
      };
      // Step boundary (9.18.0) — a step tool that waited on 3LO consent
      // advances or holds its step on the resumed dispatch by the same rule as
      // the batch loop (`stepOutcomeOf`). A blocked credential ran nothing, and
      // a ceiling-refused result is not clean (9.20.0): both hold silently.
      if (deps.stepPlanFor) {
        consentResultStr = links.applyStepReturn(
          scope,
          { toolName, toolCallId, iteration, settled: consentSettled },
          consentResultStr,
        );
      }
      if (consentEnvelope !== undefined) {
        const consentTransition: TransitionBatchState = { losers: [] };
        consentResultStr += links.applyToolEffects(
          scope,
          { toolName, toolCallId, iteration },
          consentEnvelope,
          consentTransition,
        );
        links.emitTransitionConflict(scope, iteration, consentTransition);
      }
      // The batch settlement (9.113.0) — the ask path's twin.
      const consentSettlement = links.settleBatch(
        [
          ...(scope.history as readonly LLMMessage[]),
          {
            role: 'tool',
            content: consentResultStr,
            ...(deps.negativeClaimsArmed === true && { toolChars: consentToolChars }),
            toolCallId,
            toolName,
            ...(deps.findings === true &&
              dispatched.executed !== true && { toolResultOrigin: 'not-entered' as const }),
            ...toolResultExecutionField(
              deps.answerLayer,
              scriptSeen.toolResultExecution,
              !consentSettled.clean ||
                dispatched.halt !== undefined ||
                sourceHalt !== undefined ||
                !Object.is(modelResult, consentPlaced.modelResult),
            ),
            ...(toolResultDisposition !== undefined && { toolResultDisposition }),
            ...innerCallsFieldOf(scope, toolCallId, iteration),
            // A blocked credential ran nothing → 'refused'; read by the check-in trail.
            ...outcomeField(consentSettled),
            ...reportedStatusField(consentSettled),
          },
        ],
        { toolName, toolCallId },
      );
      const consentHistory = consentSettlement.history;
      scope.history = consentHistory;
      scope.lastToolResult = {
        toolName,
        result: consentResultStr,
        ...(consentEnvelope?.status !== undefined && { status: consentEnvelope.status }),
      };
      appendBatchResult(scope, {
        toolName,
        result: consentResultStr,
        toolCallId,
        ...(deps.resultsLayer === true &&
          missingResultFields(dispatched.executed === true, scriptSeen.threw)),
        ...(consentEnvelope?.status !== undefined && { status: consentEnvelope.status }),
      });
      await judgeLanded(
        scope,
        deps.findingsJudge,
        dispatched.executed === true,
        { toolName, result: consentResultStr, toolCallId },
        iteration,
        links.turnStampOf(scope),
      );
      links.fileResumedScript(scope, {
        toolName,
        toolCallId,
        iteration,
        carried: args,
        entered: dispatched.executed === true,
        seen: scriptSeen,
      });
      links.emitToolEnd(
        scope,
        toolName,
        {
          toolCallId,
          result: consentCapped.result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
          ...(consentEnvelope?.status !== undefined && { status: consentEnvelope.status }),
          ...(consentCapped.modelResult !== consentCapped.result && {
            modelResult: consentCapped.modelResult,
          }),
        },
        dispatched.executed === true,
        undefined,
        dispatched.negativeResultId,
        args,
      );
      links.bracketSettled(scope, consentSettlement);
      typedEmit(scope, 'agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: iteration,
        // The brackets this leg closed — see the ask path's twin.
        toolCallCount: 1 + consentSettlement.settled.length,
        history: consentHistory,
      });
      if (deps.inputsLayer === true) scope.argumentAsk = undefined;
      scope.iteration = iteration + 1;
      // Clear ALL pause checkpoint fields (shared + credential).
      await links.endCall(scope);
      scope.pausedToolCallId = '';
      scope.pausedToolName = '';
      scope.pausedToolStartMs = 0;
      scope.pausedCredential = false;
      scope.pausedGatePolicy = undefined;
      scope.pausedCredentialArgs = undefined;
      scope.pausedCredentialService = undefined;
      if (scope.pausedToolParty !== undefined) scope.pausedToolParty = undefined;
      if (dispatched.halt !== undefined) haltResumedCall(scope, dispatched.halt, iteration);
      return;
    } catch (error) {
      scriptSeen.resultFinalizer?.withheld();
      throw error;
    } finally {
      scriptSeen.resultFinalizer?.close();
    }
  };
  return { resumeCredential };
}
