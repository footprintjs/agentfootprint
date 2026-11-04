import type { ToolResourcesOperations } from '../contracts/operations/resources.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { PauseAnswerRequiredError } from '../../../../pause.js';
import { argsForPausedCall } from '../batch/paused.js';
import { pausedNegativeResultId } from '../../../negativeClaims/capture.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { safeStringify } from '../../../validators.js';
import { appendBatchResult } from '../batch/settle.js';
import { judgeLanded } from '../evidence/judgeLanded.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ResumeResultFrame } from '../contracts/resumeFrames.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolMiddlewareOperations } from '../contracts/operations/middleware.js';
import type { ToolArtifactsOperations } from '../contracts/operations/artifacts.js';
import type { ToolLimitsOperations } from '../contracts/operations/limits.js';
import type { ToolStepsOperations } from '../contracts/operations/steps.js';
import type { ToolSettlementOperations } from '../contracts/operations/settlement.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolObservationsOperations } from '../contracts/operations/observations.js';

interface ResumePlainLinks {
  readonly endCall: ToolResourcesOperations['endCall'];
  readonly lookupTool: ToolCatalogOperations['lookupTool'];
  readonly peelsReserved: ToolCatalogOperations['peelsReserved'];
  readonly afterMoment: ToolMiddlewareOperations['afterMoment'];
  readonly placeResults: ToolArtifactsOperations['placeResults'];
  readonly capResults: ToolLimitsOperations['capResults'];
  readonly applyStepReturn: ToolStepsOperations['applyStepReturn'];
  readonly settleBatch: ToolSettlementOperations['settleBatch'];
  readonly turnStampOf: ToolCatalogOperations['turnStampOf'];
  readonly fileResumedScript: ToolScriptsOperations['fileResumedScript'];
  readonly emitToolEnd: ToolObservationsOperations['emitToolEnd'];
  readonly bracketSettled: ToolSettlementOperations['bracketSettled'];
}

/** Compose only the existing plain resume door and its original landing order. */
export function buildResumePlain(
  deps: Pick<ToolCallsHandlerDeps, 'negativeClaimsArmed' | 'stepPlanFor' | 'findingsJudge'>,
  links: ResumePlainLinks,
) {
  const resumePlain = async (
    scope: TypedScope<AgentState>,
    frame: ResumeResultFrame,
  ): Promise<void> => {
    const { input, toolName, toolCallId, startMs } = frame;

    // ── The `pauseHere` / `askHuman` path ────────────────────────────
    // Reached when none of the three decision pauses above claimed this
    // resume: a tool called `pauseHere()` / `askHuman()` from inside its own
    // `execute`, and the value the consumer supplies IS that tool's result —
    // this handler's contract since it was written.
    //
    // Which is why the after-tool moment runs here too (8.13.0). The tool RAN:
    // `pauseHere` throws from inside `execute`, so it started and may have done
    // half its work — the case `ToolResultContext.error` was written for. Its
    // before-tool chain already walked in the loop, so skipping the after half
    // left the ledger with an opening row and no closing one, and left every
    // `onToolResult` rule — redaction first among them — unapplied to the one
    // value a PERSON typed.
    // A pause of this kind exists to collect a value, and the value BECOMES
    // the tool's result. Resuming with nothing has two live readings — "the
    // person gave no answer" and "just carry on" — and the library does not
    // get to pick. Before 8.18.0 it picked the worst one silently: the
    // undefined answer became `content: undefined` on a `role: 'tool'`
    // message and the next turn died in the messages slot with an anonymous
    // TypeError. Refused here, at the top of the branch, so no middleware has
    // been told about a result that does not exist and the checkpoint is
    // still good — answer it and resume again.
    if (input === undefined) {
      throw new PauseAnswerRequiredError({ toolName, toolCallId });
    }
    const iteration = scope.iteration as number;
    const env = scope.$getEnv();
    const tool = links.lookupTool(toolName);
    // Peeled under the arm unless the tool owns the name — the same rule as
    // `peelCall` on the dispatch side, asked of the same tool.
    const args = argsForPausedCall(scope, toolCallId, links.peelsReserved(tool));
    // No `error` flag: a human's answer is not a tool failure.
    const rawPauseResult = await links.afterMoment(scope, {
      ...(tool && { tool }),
      toolName,
      toolCallId,
      iteration,
      args,
      result: input,
      negativeResultId:
        deps.negativeClaimsArmed === true ? pausedNegativeResultId(scope) : undefined,
      history: [...(scope.history as readonly LLMMessage[])],
      ...(scope.runIdentity && {
        identity: scope.runIdentity as {
          tenant?: string;
          principal?: string;
          conversationId: string;
        },
      }),
      ...(env.signal && { signal: env.signal }),
    });
    // A person's answer is measured too. The cap is about what one turn can
    // afford to carry, and a pasted transcript costs a window exactly as much
    // as a tool's rows do — which is also why PLACEMENT judges it: the
    // handler's contract makes the answer the tool's result, so a pasted
    // 500KB transcript is checked in as `tool-result/<tool>` and the model
    // routes the ticket.
    const pausePlaced = await links.placeResults(
      scope,
      { toolName, toolCallId, iteration },
      { result: input, modelResult: rawPauseResult },
      true,
    );
    const pauseCapped = links.capResults(toolName, pausePlaced);
    const modelResult = pauseCapped.modelResult;
    let resultStr = typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
    // Step boundary (9.18.0) — THE HITL step ("ask a human, then export"):
    // the tool paused mid-step, the person's answer IS its result, and the
    // completed step advances here at the same boundary it would have
    // inline. The pointer itself crossed the checkpoint for free (it is
    // committed shared state); this is the half that has to be wired.
    if (deps.stepPlanFor) {
      resultStr += links.applyStepReturn(scope, { toolName, toolCallId, iteration });
    }
    // The batch settlement (9.113.0) — the door a `requestInput` answer
    // comes back through, and the one most likely to meet a batch: a tool
    // that asks a person mid-lookup, batched with the lookups after it.
    const pauseSettlement = links.settleBatch(
      [
        ...(scope.history as readonly LLMMessage[]),
        {
          role: 'tool',
          content: resultStr,
          toolCallId,
          toolName,
        },
      ],
      { toolName, toolCallId },
    );
    const newHistory = pauseSettlement.history;
    scope.history = newHistory;
    // Drives `on-tool-return` triggers, same as every other dispatch path.
    scope.lastToolResult = { toolName, result: resultStr };
    appendBatchResult(scope, { toolName, result: resultStr, toolCallId });
    // The person's answer IS the tool's result (the handler's contract
    // above), so it ran by definition.
    await judgeLanded(
      scope,
      deps.findingsJudge,
      true,
      { toolName, result: resultStr, toolCallId },
      iteration,
      links.turnStampOf(scope),
    );

    // The tool asked a person from inside `execute`, and the answer IS its
    // result (the handler's contract): the call returned, and no runner
    // reported an execution — `returned`, never `completed`.
    links.fileResumedScript(scope, {
      toolName,
      toolCallId,
      iteration,
      carried: args,
      entered: true,
      seen: {},
    });
    links.emitToolEnd(
      scope,
      toolName,
      {
        toolCallId,
        // The REAL value the pause returned, not what a rule let the model read
        // — the same split the other four paths keep. Capped when a ceiling is
        // configured, because the marker IS the result on every channel.
        result: pauseCapped.result,
        durationMs: Date.now() - startMs,
        ...(pauseCapped.modelResult !== pauseCapped.result && {
          modelResult: pauseCapped.modelResult,
        }),
      },
      true,
      undefined,
      deps.negativeClaimsArmed === true ? pausedNegativeResultId(scope) : undefined,
    );
    links.bracketSettled(scope, pauseSettlement);
    typedEmit(scope, 'agentfootprint.agent.iteration_end', {
      turnIndex: 0,
      iterIndex: iteration,
      // The brackets this leg closed — see the ask path's twin.
      toolCallCount: 1 + pauseSettlement.settled.length,
      // Plain local array — see the matching note on the execute path.
      history: newHistory,
    });
    scope.iteration = iteration + 1;
    // Clear pause checkpoint fields.
    await links.endCall(scope);
    scope.pausedToolCallId = '';
    scope.pausedToolName = '';
    scope.pausedToolStartMs = 0;
    scope.pausedToolArgs = undefined;
  };
  return { resumePlain };
}
