import { callOccurrenceField } from '../../../../../lib/callOccurrence.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { CallArguments, CallExecution, CallResultCell } from '../contracts/callCells.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import type { DispatchBatchFrame } from '../contracts/dispatchBatch.js';
import type { ToolCallOperations } from '../compose.js';
import { sourceLanding } from '../../../sourceEvidence/landing.js';
import { sourceEvidenceHaltOf } from '../../../sourceEvidence/permissions.js';
import { keepNegativeResultOut } from '../../../negativeClaims/capture.js';

interface FinalizeCallFrame {
  readonly tool: Tool | undefined;
  readonly tc: DispatchCall;
  readonly batch: DispatchBatchFrame;
  readonly callArguments: CallArguments;
  readonly execution: CallExecution;
  readonly outcome: CallResultCell;
  readonly sourceEvidenceArmed: boolean;
}

/** Final governance, placement, cap and native result contracts precede every delivery. */
export async function finalizeCallResult(
  scope: TypedScope<AgentState>,
  operations: ToolCallOperations,
  frame: FinalizeCallFrame,
) {
  const { tool, tc, batch, callArguments, execution, outcome } = frame;
  const occurrence = callOccurrenceField(tc.callOccurrenceKey);
  // ── The after-tool moment ────────────────────────────────────────
  // Last thing before the result becomes history, and only for a call
  // that ran. `modelResult` is what the model reads; `result` stays the
  // truth about the tool and is what `stream.tool_end` reports.
  const rawModelResult = execution.executed
    ? await operations.afterMoment(scope, {
        ...occurrence,
        ...(tool && { tool }),
        toolName: tc.name,
        toolCallId: tc.id,
        iteration: batch.iteration,
        args: callArguments.callArgs,
        result: outcome.result,
        negativeResultId: execution.negativeDispatch?.resultId,
        ...(execution.resultFinalizer && { onSourceWithheld: execution.resultFinalizer.withheld }),
        ...(outcome.error === true && { error: true }),
        history: batch.newHistory,
        ...(batch.runIdentity && { identity: batch.runIdentity }),
        ...(batch.env.signal && { signal: batch.env.signal }),
      })
    : outcome.result;
  const sourceHalt = frame.sourceEvidenceArmed ? sourceEvidenceHaltOf(scope) : undefined;
  if (sourceHalt !== undefined) {
    execution.denied = true;
    execution.haltContext ??= sourceHalt;
  }
  // Placement next (9.22.0) — the operator's ref-ing, judged on what
  // the chain let through (a rule that already summarized a huge
  // result is measured on what it produced, the same reasoning as the
  // cap). Over the threshold, the payload is checked into the store
  // and BOTH channels carry the ticket; the truncation net below then
  // measures the ticket. A refused/denied/errored call is never
  // placed: a refusal is already short, and 'tool-result/<name>' must
  // never claim an error is the tool's result.
  const placedValues = await operations.placeResults(
    scope,
    { toolName: tc.name, toolCallId: tc.id, iteration: batch.iteration, ...occurrence },
    { result: outcome.result, modelResult: rawModelResult },
    execution.executed && !outcome.error && !execution.denied && !execution.ceilingRefused,
  );
  // The write seam (9.77.0) — judged on `result`, the tool's own answer,
  // and on `newHistory`, which at this point holds every earlier tool
  // result and not yet this one. Same guard the placement decision uses:
  // a call that did not run, errored, was denied or had its payload
  // refused has no lookup answer to read.
  operations.noticeEmptyLookup(
    scope,
    { toolName: tc.name, toolCallId: tc.id, iteration: batch.iteration },
    callArguments.callArgs,
    outcome.result,
    batch.newHistory,
    execution.executed && !outcome.error && !execution.denied && !execution.ceilingRefused,
  );
  // The ceiling, last — after the tool, after the chain. A rule that
  // already summarized a huge result is measured on what it produced, so
  // the cap composes with governance rather than pre-empting it.
  let capped = operations.capResults(tc.name, placedValues);
  const uncapped = capped.modelResult === placedValues.modelResult;
  const refusal =
    execution.resultFinalizer === undefined
      ? undefined
      : await execution.resultFinalizer(capped.modelResult, {
          ...sourceLanding(execution, outcome, uncapped),
          ...(!uncapped && { unavailableReason: 'result-capped' as const }),
        });
  if (refusal !== undefined) {
    if (execution.negativeDispatch !== undefined)
      keepNegativeResultOut(scope, execution.negativeDispatch.resultId);
    execution.ceilingRefused = true;
    outcome.result = refusal;
    outcome.toolStatus = 'invalid';
    capped = operations.capResults(tc.name, { result: refusal, modelResult: refusal });
  }
  const modelResult = capped.modelResult;
  execution.resultFinalizer?.assertFinalized();

  return { capped, modelResult };
}
