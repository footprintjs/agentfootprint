import type { buildCallStart } from './callStart.js';
import type { buildDispatchContext } from '../batch/dispatchContext.js';
import type {
  CallDelivery,
  CallExecution,
  CallOutcome,
  CallSkillRoute,
  CallArguments,
} from '../contracts/callCells.js';
import type { buildToolStepsOperations } from '../routing/stepsOperations.js';
import type { buildToolEffectsOperations } from '../routing/effectsOperations.js';
import type { buildToolResourcesOperations } from './resourcesOperations.js';
import { type repeatedCallLedgers, noteRepeatedCall } from '../../../repeatedCall.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type { buildToolCatalogOperations } from './catalogOperations.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { serveNegativeHandle } from '../../../negativeClaims/capture.js';
import { UNSCOPED_RUN } from '../helpers/unscopedRun.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;
type DispatchContext = ReturnType<
  ReturnType<typeof buildDispatchContext>['prepareDispatchContext']
>;

interface LandCallResultFrame {
  readonly delivery: CallDelivery;
  readonly execution: CallExecution;
  readonly tc: DispatchCall;
  readonly outcome: CallOutcome;
  readonly skillRoute: CallSkillRoute;
  readonly callArguments: CallArguments;
  readonly readSkillStepIntroFor: ReturnType<
    typeof buildToolStepsOperations
  >['readSkillStepIntroFor'];
  readonly applyStepReturn: ReturnType<typeof buildToolStepsOperations>['applyStepReturn'];
  readonly iteration: number;
  readonly applyToolEffects: ReturnType<typeof buildToolEffectsOperations>['applyToolEffects'];
  readonly transitionState: DispatchContext['transitionState'];
  readonly runFactsOf: ReturnType<typeof buildToolResourcesOperations>['runFactsOf'];
  readonly tool: CallStartFacts['tool'];
  readonly repeatLedgers: ReturnType<typeof repeatedCallLedgers>;
  readonly inputs: InputsDispatch | undefined;
  readonly resolution: ReturnType<ReturnType<InputsDispatch['resolutionsFor']>['get']>;
  readonly args: CallStartFacts['args'];
  readonly noteOptionsFor: ReturnType<typeof buildToolCatalogOperations>['noteOptionsFor'];
  readonly newHistory: DispatchContext['newHistory'];
  readonly batchResults: DispatchContext['batchResults'];
}

/** The existing synchronous deliveredResult phase; no new await or checkpoint carrier. */
export function landCallResult(
  scope: TypedScope<AgentState>,
  deps: Pick<
    ToolCallsHandlerDeps,
    'negativeClaimsArmed' | 'stepPlanFor' | 'repeatedCallNudge' | 'findings'
  >,
  frame: LandCallResultFrame,
): void {
  // The tool's OWN answer, before any framework suffix joins it — what
  // the repeated-call ledger fingerprints. Fingerprinting the decorated
  // string instead would compare our own additions (a step that advanced
  // once, an effect note) and miss the repeat they decorate.
  const deliveredResult = frame.delivery.resultStr;
  if (deps.negativeClaimsArmed === true)
    frame.delivery.resultStr = serveNegativeHandle(
      scope,
      frame.execution.negativeDispatch?.resultId,
      frame.delivery.resultStr,
    );
  const hasNegativeNote = frame.delivery.resultStr !== deliveredResult;

  // ── Step boundary (9.18.0): advance decided, then decorate, THEN
  // push — the suffix must be part of the one past every reader sees
  // (history, `lastToolResult`, the batch), never spliced in later.
  // `stream.tool_end` above keeps reporting the tool's own truth.
  if (deps.stepPlanFor) {
    // The activation intro: an ACCEPTED read_skill pick of a stepped
    // skill says where the procedure starts (recency channel §1).
    if (
      frame.tc.name === 'read_skill' &&
      !frame.outcome.error &&
      !frame.execution.denied &&
      !frame.skillRoute.skillRejected
    ) {
      const pickedId = (frame.callArguments.callArgs as { id?: unknown }).id;
      if (typeof pickedId === 'string' && pickedId.length > 0) {
        frame.delivery.resultStr += frame.readSkillStepIntroFor(pickedId);
      }
    }
    // The advance: only a call that RAN clean completes a step — an
    // error result never advances (the pointer holds; the model
    // retries, skips with a reason, or routes around), and neither
    // does a permission denial, a gate refusal, or a ceiling refusal
    // (the model holds no data and was told to call again — advancing
    // would contradict the refusal's own instruction).
    if (
      frame.execution.executed &&
      !frame.outcome.error &&
      !frame.execution.denied &&
      !frame.skillRoute.skillRejected &&
      !frame.execution.ceilingRefused
    ) {
      frame.delivery.resultStr += frame.applyStepReturn(scope, {
        toolName: frame.tc.name,
        toolCallId: frame.tc.id,
        iteration: frame.iteration,
      });
    }
  }

  // ── Typed tool effects (9.19.0) — judged in call order ──────────
  // Only for a call that RAN clean and returned an envelope. Refusal
  // notes join the model-visible result AFTER the cap (framework
  // truth, the step-suffix precedent); accepted effects speak through
  // what they do — the cursor move, the delivered instruction — and
  // through `tools.effect` on the record.
  if (
    frame.outcome.toolEnvelope !== undefined &&
    frame.execution.executed &&
    !frame.outcome.error &&
    !frame.execution.denied
  ) {
    frame.delivery.resultStr += frame.applyToolEffects(
      scope,
      { toolName: frame.tc.name, toolCallId: frame.tc.id, iteration: frame.iteration },
      frame.outcome.toolEnvelope,
      frame.transitionState,
    );
  }

  // ── Repeated-call nudge (9.26.0) ───────────────────────────────
  // The framework is the only party that watched all three landings, so
  // it is the only one that can say so. A NOTE on the result — the call
  // ran, nothing was refused, and a later identical call is not blocked.
  // Only for a call that RAN: a permission denial, a gate rejection and
  // a ceiling refusal each already teach their own lesson, and stacking
  // a second one would bury it.
  //
  // Only this batch-loop dispatch gets the nudge. The other dispatch
  // owners are `resolveCredentialAndExecute` above (resume),
  // `../../../toolDispatch.ts` · `agentToolDispatch` (inner calls),
  // `mcp/mcpServe.ts` (external MCP clients), and
  // `trace-toolpack/traceToolpack.ts` · `callTraceTool` (offline).
  // Inner calls are the outer call's work, not another model turn.
  // The other doors never see a live multi-turn conversation the way
  // this loop does — a resumed check-in is a single call with no
  // "again" to notice, an MCP-served call has no ledger to be a run's
  // (the caller IS the loop, elsewhere), and a trace replay is judging
  // a run that already happened, not steering one in flight. Wiring
  // any of them would mean a second ledger with its own eviction and
  // its own idea of "this run", for a door that cannot act on the note
  // even if it fired one. Keep it this way.
  if (
    deps.repeatedCallNudge !== false &&
    frame.execution.executed &&
    !frame.execution.denied &&
    !frame.skillRoute.skillRejected
  ) {
    // Counted beside the run, never inside its state: a tracked write is
    // a commit-log entry, a snapshot key, a narrative line and a row in
    // every recording, and a turn that repeats NOTHING must stay
    // byte-identical to the release before this one. `currentRun()` is
    // the same accessor `ctx.runId` is composed from — one answer to
    // "which run is this", not a second spelling of it.
    const runKey = frame.runFactsOf(scope)?.runId ?? UNSCOPED_RUN;
    // `repeatedWhen: 'arguments'` (9.62.0) — read off the RESOLVED tool,
    // never off the call: only the tool's own definition knows whether
    // its result is signal or a stamp (a fresh version/timestamp/cursor
    // that changes on every call by design). `tool` here is the same
    // lookup the credential/wants/execute steps above already used for
    // this call, so a tool with no static or provider match (`tool ===
    // undefined`, already handled earlier as an error path before this
    // point is reachable) never reads `.repeatedWhen` on `undefined`.
    const repeatMode = frame.tool?.repeatedWhen === 'arguments' ? 'arguments' : undefined;
    const repeat = noteRepeatedCall(
      frame.repeatLedgers.read(runKey),
      frame.tc.name,
      frame.callArguments.callArgs,
      deliveredResult,
      repeatMode,
    );
    frame.repeatLedgers.write(runKey, repeat.ledger);
    if (repeat.note !== undefined) {
      frame.delivery.resultStr += repeat.note;
      typedEmit(scope, 'agentfootprint.tools.repeated_call', {
        toolName: frame.tc.name,
        toolCallId: frame.tc.id,
        iteration: frame.iteration,
        occurrences: repeat.occurrences,
        argsFingerprint: repeat.argsFingerprint,
        resultFingerprint: repeat.resultFingerprint,
        ...(repeat.mode !== undefined && { mode: repeat.mode }),
      });
    }
  }

  // ── The inputs layer's note (honesty layer 2) — LAST, after every
  // other suffix, and only for a call that RAN on a value the library
  // filled: one clause per fill the call really ran with
  // (`arguments/dispatch.ts` · `fillsThatRan` — a middleware may have
  // rewritten one). The message then carries `toolChars` (the tool's own
  // bytes), so every reader of a result's content as the TOOL's words
  // reads through the cut (`lib/toolBytes.ts` · `toolBytesOf`): a value
  // that sits only in the library's note grounds nothing and hides no
  // reading of the result. Under declared sources an answered clause
  // also says a later call may cite the answer (`arguments/serve.ts` ·
  // `ANSWERED_SOURCE_CLAUSE`).
  const layerNote =
    frame.inputs !== undefined && frame.execution.executed
      ? frame.inputs.noteFor(
          frame.tc.name,
          frame.tool,
          frame.resolution,
          frame.callArguments.callArgs,
          frame.args,
          frame.noteOptionsFor(frame.tool),
        )
      : '';
  if (layerNote !== '') frame.delivery.resultStr += layerNote;
  frame.newHistory.push({
    role: 'tool',
    content: frame.delivery.resultStr,
    toolCallId: frame.tc.id,
    toolName: frame.tc.name,
    ...(deps.findings === true &&
      !frame.execution.executed && { toolResultOrigin: 'not-entered' as const }),
    ...((layerNote !== '' || hasNegativeNote) && { toolChars: deliveredResult.length }),
    ...(frame.tc.argumentsFailure !== undefined && {
      toolArgumentsFailure: { ...frame.tc.argumentsFailure },
    }),
  });

  // ── Dynamic ReAct wiring ───────────────────────────────
  //
  // (1) `lastToolResult` drives `on-tool-return` Injection
  //     triggers — the InjectionEngine's NEXT pass will see
  //     this and activate any matching Instructions. Since
  //     9.16.0 the WHOLE batch rides `toolResults` beside it
  //     (call order preserved), so an earlier parallel call's
  //     routing implication is no longer overwritten by a
  //     later sibling's.
  scope.lastToolResult = {
    toolName: frame.tc.name,
    result: frame.delivery.resultStr,
    ...(frame.outcome.toolStatus !== undefined && { status: frame.outcome.toolStatus }),
  };
  frame.batchResults.push({
    toolName: frame.tc.name,
    result: frame.delivery.resultStr,
    toolCallId: frame.tc.id,
    ...(frame.outcome.toolStatus !== undefined && { status: frame.outcome.toolStatus }),
  });
  scope.toolResults = [...frame.batchResults];
}
