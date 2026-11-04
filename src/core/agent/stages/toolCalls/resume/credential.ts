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
import { appendBatchResult } from '../batch/settle.js';
import { judgeLanded } from '../evidence/judgeLanded.js';
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
    'negativeClaimsArmed' | 'stepPlanFor' | 'findings' | 'findingsJudge'
  >,
  links: ResumeCredentialLinks,
) {
  const resumeCredential = async (
    scope: TypedScope<AgentState>,
    frame: ResumeCallFrame,
  ): Promise<void> => {
    const { toolName, toolCallId, startMs } = frame;

    const iteration = scope.iteration as number;
    const args = (scope.pausedCredentialArgs ?? {}) as Readonly<Record<string, unknown>>;
    const env = scope.$getEnv();
    // Resolved against the party the checkpoint carries (9.92.0).
    const resolved = links.resolveTool(toolName, scope.pausedToolParty as ToolParty | undefined);
    const tool = resolved.tool;
    /** What the call's `execute` saw — its script row reads it. */
    const scriptSeen: ResumedCallFacts = {};
    const dispatched = await links.resolveCredentialAndExecute(
      scope,
      resolved,
      toolName,
      args,
      toolCallId,
      iteration,
      env,
      undefined,
      scriptSeen,
    );
    const result = dispatched.result;
    const error = dispatched.error;
    let modelResult: unknown;
    if (dispatched.executed === true) {
      modelResult = await links.afterMoment(scope, {
        ...(tool && { tool }),
        toolName,
        toolCallId,
        iteration,
        args,
        result,
        negativeResultId: dispatched.negativeResultId,
        ...(error === true && { error: true }),
        history: [...(scope.history as readonly LLMMessage[])],
        ...(scope.runIdentity && { identity: scope.runIdentity }),
        ...(env.signal && { signal: env.signal }),
      });
    }
    if (modelResult === undefined) modelResult = result;
    // Placement then the truncation net — the batch loop's precedence.
    const consentPlaced = await links.placeResults(
      scope,
      { toolName, toolCallId, iteration },
      { result, modelResult },
      dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true,
    );
    const consentCapped = links.capResults(toolName, consentPlaced);
    modelResult = consentCapped.modelResult;
    let consentResultStr =
      typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
    const consentToolChars = consentResultStr.length;
    if (deps.negativeClaimsArmed === true)
      consentResultStr = serveNegativeHandle(scope, dispatched.negativeResultId, consentResultStr);
    // Step boundary (9.18.0) — a step tool that waited on 3LO consent
    // advances the moment its resumed dispatch really ran, clean. A
    // ceiling-refused result is not clean (9.20.0): the model holds no
    // data and was told to call again.
    if (
      deps.stepPlanFor &&
      dispatched.executed === true &&
      error !== true &&
      dispatched.ceilingRefused !== true
    ) {
      consentResultStr += links.applyStepReturn(scope, { toolName, toolCallId, iteration });
    }
    // Typed tool effects (9.19.0) — same judge as every other path.
    const consentEnvelope =
      dispatched.executed === true && error !== true ? dispatched.envelope : undefined;
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
    if (scope.$getValue('argumentAsk') !== undefined) scope.argumentAsk = undefined;
    scope.iteration = iteration + 1;
    // Clear ALL pause checkpoint fields (shared + credential).
    await links.endCall(scope);
    scope.pausedToolCallId = '';
    scope.pausedToolName = '';
    scope.pausedToolStartMs = 0;
    scope.pausedCredential = false;
    scope.pausedCredentialArgs = undefined;
    scope.pausedCredentialService = undefined;
    if (scope.pausedToolParty !== undefined) scope.pausedToolParty = undefined;
    return;
  };
  return { resumeCredential };
}
