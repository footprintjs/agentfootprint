import { refuseToolBatch } from './refusal.js';
import { toolBatchFailure } from '../../toolCallShape.js';
import { restoreServedParties, saveServedParties } from '../../servedParties.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { PausableHandler, TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import { readBatchResolutions } from './inputResolutions.js';
import { completeToolBatch } from './completion.js';
import type { ToolCallOperations } from '../compose.js';
import type { DispatchBatchFrame } from '../contracts/dispatchBatch.js';
import type { DispatchCallRunner } from '../contracts/dispatchCall.js';
import { restoreArgumentParties } from '../../argumentParties.js';

/** The existing native batch handler: original waits, one serial call loop, and defined pause propagation. */
export function buildToolBatchExecution(
  deps: ToolCallsHandlerDeps,
  operations: ToolCallOperations,
  dispatchCall: DispatchCallRunner,
): PausableHandler<TypedScope<AgentState>>['execute'] {
  const execute: PausableHandler<TypedScope<AgentState>>['execute'] = async (scope) => {
    if (deps.inputsLayer === true && scope.argumentAsk !== undefined)
      deps.resources?.expectAnswer();
    restoreServedParties(scope, deps.servedTools);
    if (deps.inputsLayer === true) restoreArgumentParties(scope, deps.servedTools);
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
    // THE INPUTS LAYER'S HALF OF DISPATCH (honesty layer 2) — loaded through
    // `import()` only under the arm, so an unarmed batch awaits nothing new.
    const inputs: InputsDispatch | undefined =
      deps.inputsLayer === true ? await import('../../../arguments/dispatch.js') : undefined;
    let resolutions = readBatchResolutions(scope, inputs, iteration, toolCalls, findingsRefusals);
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
        refuseMalformedBatch: () => {
          const malformed = toolBatchFailure(toolCalls);
          if (malformed === undefined) return false;
          refuseToolBatch(scope, malformed);
          return true;
        },
        excludedCallIds: toolCalls
          .filter((_, index) => findingsRefusals[index] !== undefined)
          .map((call) => call.id),
        ...(deps.argumentSources === true && { argumentSources: true as const }),
        toolOf: (toolName) => operations.resolveTool(toolName).tool,
        partyOf: (toolName) => operations.resolveTool(toolName).party,
        admitAnswer: () => deps.resources?.answer.record(),
        saveParties: () => saveServedParties(scope, deps.servedTools),
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
    } = operations.prepareDispatchContext(scope, toolCalls, iteration);
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
        saveServedParties(scope, deps.servedTools);
        return result.pause;
      }
      if (result.kind === 'halted') return undefined;
    }
    completeToolBatch(scope, {
      askAnswered: oneQuestionAsked,
      inputsLayer: inputs !== undefined,
      newHistory,
      emitTransitionConflict: operations.emitTransitionConflict,
      iteration,
      transitionState,
      toolCalls,
    });
    if (deps.servedTools !== undefined) deps.servedTools.pinned = undefined;
    return undefined; // explicit: no pause, flow continues to loopTo
  };
  return execute;
}
