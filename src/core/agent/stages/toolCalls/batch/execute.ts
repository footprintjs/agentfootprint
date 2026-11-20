import { refuseToolBatch, refuseSourceDeclarationBatch } from './refusal.js';
import { recordFindings } from '../../../findings/ledger.js';
import { shownArgsOf } from '../../../../toolShownArgs.js';
import type { AskedArgument } from '../../../arguments/sourceCorrection.js';
import { batchAddress, type BatchAddress } from '../../../arguments/batchAddress.js';
import { prepareSourceContractFeedback } from '../../../findings/sourceContractFeedback.js';
import { toolBatchFailure } from '../../toolCallShape.js';
import { hasUnbindableCallId } from '../../batchParties.js';
import { restoreServedParties, saveServedParties } from '../../servedParties.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { PausableHandler, TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import { readBatchResolutions } from './inputResolutions.js';
import { completeToolBatch } from './completion.js';
import { loadTimeLineage } from '../../turnExempt.js';
import type { ToolCallOperations } from '../compose.js';
import type { DispatchBatchFrame } from '../contracts/dispatchBatch.js';
import type { DispatchCallRunner } from '../contracts/dispatchCall.js';
import { resultRowsetsOf } from '../../../../../tools/resultRowsets.js';
import { noteUnansweredRowsets } from '../../../resultRowsets/judge.js';
import type { DispatchCall } from '../contracts/batchCall.js';

/** The existing native batch handler: original waits, one serial call loop, and defined pause propagation. */
export function buildToolBatchExecution(
  deps: ToolCallsHandlerDeps,
  operations: ToolCallOperations,
  dispatchCall: DispatchCallRunner,
): PausableHandler<TypedScope<AgentState>>['execute'] {
  const noteUndispatchedRowsets = (calls: readonly DispatchCall[]): void => {
    if (deps.columnCheckMode === undefined) return;
    for (const call of calls) {
      const resolved = operations.resolveTool(call.name);
      const tool = resolved.tool;
      if (tool !== undefined)
        noteUnansweredRowsets(
          deps.integrityLedger,
          deps.resultRowsetsFor === undefined
            ? resultRowsetsOf(call.name, tool, tool.resultColumns)
            : deps.resultRowsetsFor(call.name, tool, resolved.party),
        );
    }
  };
  const execute: PausableHandler<TypedScope<AgentState>>['execute'] = async (scope) => {
    if (deps.servedTools?.argumentAskPending === true) deps.resources?.expectAnswer();
    restoreServedParties(scope, deps.servedTools);
    if (deps.servedTools?.argumentAskPending === true) deps.resources?.expectAnswer();
    // Replay and pausable resume both admit the saved native owner and current executable catalog.
    deps.resources?.restore(scope, operations.resourceFactsOf(scope));
    const catalog = deps.prepareProviderTools?.(scope);
    if (catalog) await catalog;
    scope.$getEnv().signal?.throwIfAborted();

    // Durable-write barrier — the LAST iteration's state must have landed in
    // the session store before THIS iteration's tools are allowed to run.
    // `undefined` (no composer, or nothing outstanding) means no await, no
    // microtask, no behaviour change whatsoever.
    const durable = deps.awaitDurable?.();
    if (durable) await durable;
    // The time layer: a resume whose pause was the inputs layer's argument
    // ask re-runs THIS function from its top — the kept clock is recorded
    // against the resume's `time` here, first, exactly as the resume door
    // does (TQ21). A fresh run passed no resume `time`: nothing is filed.
    if (deps.time !== undefined) {
      (await import('../../timeLayer.js')).recordClockOnResume(scope, deps.time);
    }
    const { toolCalls, iteration, findingsRefusals } = operations.admitFindingsBatch(scope);
    if (hasUnbindableCallId(toolCalls)) {
      if (deps.declarationCorrection !== undefined) scope.argumentSourceOmissionRows = [];
      refuseToolBatch(scope, 'invalid-call-id', deps.answerLayer === true);
      return;
    }
    // THE INPUTS LAYER'S HALF OF DISPATCH (honesty layer 2) — loaded through
    // `import()` only under the arm, so an unarmed batch awaits nothing new.
    const inputs: InputsDispatch | undefined =
      deps.inputsLayer === true ? await import('../../../arguments/dispatch.js') : undefined;
    const excludedCallAddresses = toolCalls
      .filter((_, index) => findingsRefusals[index] !== undefined)
      .map((call) => batchAddress(call.id, call.callOccurrenceKey));
    let resolutions = readBatchResolutions(
      scope,
      inputs,
      iteration,
      toolCalls,
      excludedCallAddresses,
      deps.declarationCorrection === undefined,
    );
    const originalResolutions = resolutions;
    const settle = (
      outcome: 'correction' | 'asked' | 'preempted',
      members?: readonly AskedArgument[],
    ) => {
      if (deps.declarationCorrection === undefined || inputs === undefined) return;
      const turn = scope.turnNumber as number;
      inputs.settleOmissions(
        scope,
        turn,
        iteration,
        outcome,
        (rows) => recordFindings(scope, rows, { turn }),
        members,
      );
    };
    const settleRefused = (addresses: readonly BatchAddress[]) => {
      if (
        deps.declarationCorrection === undefined ||
        inputs === undefined ||
        addresses.length === 0
      )
        return;
      const refused = new Set(addresses);
      settle(
        'preempted',
        inputs
          .pendingOmissions(scope, scope.turnNumber as number, iteration)
          .filter((row) => refused.has(batchAddress(row.toolCallId, row.callOccurrenceKey))),
      );
    };
    if (deps.declarationCorrection !== undefined)
      settleRefused([
        ...excludedCallAddresses,
        ...[...(resolutions ?? [])]
          .filter(([, entry]) => entry.refused !== undefined)
          .map(([address]) => address),
      ]);
    // ── THE BATCH ASK (honesty layer 2, step 4) — FIRST, before anything
    // is written or dispatched: when the layer named an `ask` argument a
    // call of this batch left out, the person is asked ONCE for everything
    // the batch needs (`../../argumentAsk.ts` · `askBeforeDispatch`, which
    // pauses through footprintjs's `interrupt()`). The resume re-runs this
    // stage from here; the answer comes back out of the same interrupt, is
    // bound, and the entries below carry the answered fills. A pass that
    // carries an answer has asked this batch's one human question: every
    // later pause in the SAME batch is refused by name (`askedLayer`, the
    // layer's dispatch half, set only then).
    let askedLayer: InputsDispatch | undefined;
    if (
      inputs !== undefined &&
      resolutions !== undefined &&
      ([...resolutions.values()].some((r) => r.ask !== undefined) ||
        deps.time?.reader !== undefined)
    ) {
      // Loaded on first use — the optional-family law: a plain agent's
      // graph never carries the ask (`test/trace-toolpack/browserGraph`).
      const { askBeforeDispatch } = await import('../../argumentAsk.js');
      const asked = askBeforeDispatch(scope, resolutions, {
        pendingAsk: deps.servedTools?.argumentAskPending === true,
        settledAsk: () => {
          if (deps.servedTools !== undefined) deps.servedTools.argumentAskPending = false;
        },
        refuseMalformedBatch: () => {
          const malformed = toolBatchFailure(toolCalls);
          if (malformed === undefined) return false;
          settle('preempted');
          refuseToolBatch(scope, malformed, deps.answerLayer === true);
          return true;
        },
        ...(deps.declarationCorrection !== undefined &&
          inputs !== undefined && {
            refusedCalls: settleRefused,
            correctOmissions: (asks: readonly import('../../../arguments/ask.js').CallAsk[]) => {
              if (
                deps.servedTools?.argumentAskPending === true ||
                scope.sourceDeclarationCorrectionSpent === true ||
                toolCalls.some((call) => call.argumentsFailure !== undefined) ||
                findingsRefusals.some((refusal) => refusal !== undefined)
              )
                return false;
              const rows = inputs.pendingOmissions(scope, scope.turnNumber as number, iteration);
              if (!inputs.onlyOmissions(rows, asks)) return false;
              const feedback = prepareSourceContractFeedback(
                toolCalls,
                rows,
                deps.findings === true,
              );
              if (feedback === undefined) return false;
              scope.$getEnv().signal?.throwIfAborted();
              const bound = toolCalls.map((call) => ({
                call,
                tool: operations.resolveTool(call.name).tool,
                args: operations.peelCall(call).args,
              }));
              const shownCalls = bound.map(({ call, tool, args }) => ({
                ...call,
                args: shownArgsOf(tool, args),
              }));
              scope.$getEnv().signal?.throwIfAborted();
              scope.sourceDeclarationCorrectionSpent = true;
              settle('correction');
              for (const call of toolCalls) {
                const at = { toolName: call.name, toolCallId: call.id, iteration };
                operations.noticeEmptyLookup(scope, at, call.args, undefined, [], false);
                operations.judgeColumns(scope, at, undefined);
              }
              noteUndispatchedRowsets(toolCalls);
              refuseSourceDeclarationBatch(scope, toolCalls, feedback, shownCalls);
              return true;
            },
          }),
        excludedCallAddresses,
        ...(deps.argumentSources === true && { argumentSources: true as const }),
        toolOf: (toolName) => operations.resolveTool(toolName).tool,
        admitAnswer: () => deps.resources?.answer.record(),
        saveParties: () =>
          saveServedParties(scope, deps.servedTools, {
            calls: toolCalls,
            iteration,
            partyOf: (name) => operations.resolveTool(name).party,
            argumentAsk: true,
          }),
        ...((deps.declarationCorrection !== undefined ||
          deps.emptyLookupGrounding !== undefined ||
          deps.columnDeclarations !== undefined ||
          deps.columnCheckMode !== undefined) && {
          beforePause: (asked: readonly AskedArgument[]) => {
            settle('asked', asked);
            // This fresh argument ask holds the WHOLE current batch before
            // dispatch. A promised write has no result yet, so its existing
            // checker meets a not-applicable encounter, never a fabricated
            // pass/finding. Earlier completed batches keep their own notes.
            for (const call of toolCalls) {
              const at = { toolName: call.name, toolCallId: call.id, iteration };
              operations.noticeEmptyLookup(scope, at, call.args, undefined, [], false);
              operations.judgeColumns(scope, at, undefined);
            }
            noteUndispatchedRowsets(toolCalls);
          },
        }),
        runId: () => operations.runFactsOf(scope)?.runId,
        ...(deps.argumentAskContext !== undefined && { hostContext: deps.argumentAskContext }),
        ...(deps.time !== undefined && {
          time: {
            ...(deps.time.appZone !== undefined && { appZone: deps.time.appZone }),
            ...(deps.time.reader !== undefined && { reader: deps.time.reader }),
          },
        }),
      });
      if (asked.refused === true) return;
      resolutions = asked.resolutions;
      if (asked.answered) askedLayer = inputs;
    }
    if (
      deps.declarationCorrection !== undefined &&
      inputs !== undefined &&
      originalResolutions !== undefined
    ) {
      inputs.dropUsedKept(scope, originalResolutions, toolCalls);
    }
    const oneQuestionAsked = askedLayer !== undefined;
    const {
      newHistory,
      frozenTurn,
      callbackHistory,
      frozenArgsAt,
      batchResults,
      towers,
      transitionState,
      runIdentity,
      env,
    } = operations.prepareDispatchContext(
      scope,
      toolCalls,
      iteration,
      // Under `.time()`, the time the person said is exempt at dispatch as at the answer.
      deps.evidenceExempt?.timeLineage === true
        ? await loadTimeLineage(deps.evidenceExempt)
        : undefined,
    );
    const batch: DispatchBatchFrame = {
      toolCalls,
      iteration,
      findingsRefusals,
      inputs,
      resolutions,
      askedLayer,
      oneQuestionAsked,
      newHistory,
      frozenTurn,
      callbackHistory,
      frozenArgsAt,
      batchResults,
      towers,
      transitionState,
      runIdentity,
      env,
    };
    for (const [callIndex, tc] of toolCalls.entries()) {
      const result = await dispatchCall(scope, tc, callIndex, batch);
      if (result.kind === 'paused') {
        // Only the siblings AFTER this real pause were never entered. The
        // paused call's owner and every earlier completed result keep theirs.
        noteUndispatchedRowsets(toolCalls.slice(callIndex + 1));
        saveServedParties(scope, deps.servedTools, {
          calls: toolCalls,
          iteration,
          partyOf: (name) => operations.resolveTool(name).party,
          paused: { id: tc.id, name: tc.name },
        });
        return result.pause;
      }
      if (result.kind === 'halted') return undefined;
    }
    completeToolBatch(scope, {
      askAnswered: oneQuestionAsked,
      inputsLayer: deps.servedTools?.argumentAskPending === true,
      newHistory,
      emitTransitionConflict: operations.emitTransitionConflict,
      iteration,
      transitionState,
      toolCalls,
    });
    if (deps.servedTools !== undefined) {
      deps.servedTools.pinned = undefined;
      deps.servedTools.restored = undefined;
      deps.servedTools.argumentAskPending = false;
    }
    return undefined; // explicit: no pause, flow continues to loopTo
  };
  return execute;
}
