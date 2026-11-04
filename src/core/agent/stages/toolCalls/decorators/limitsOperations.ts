import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { capToolResult } from '../../../toolResultCap.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { ToolResultStatus } from '../../../../../semantics/toolEffects.js';
import { applyResultCeiling } from '../../../resultCeiling.js';
import { servedToModel } from '../../../../../semantics/coverage/read.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolLimitsOperations } from '../contracts/operations/limits.js';

/** Compose the existing limits callbacks once for this handler. */
export function buildToolLimitsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'maxToolResultChars'>,
): ToolLimitsOperations {
  /**
   * The tool-result ceiling, applied at the ONE place a result leaves dispatch.
   *
   * Both channels are measured SEPARATELY and on purpose. `result` is the
   * tool's own truth and is what `stream.tool_end` reports; `modelResult` is
   * what an `onToolResult` rule let the model read, and a rule that summarized
   * a huge result down to a paragraph should not then be told it was
   * truncated. Measuring each against the same cap keeps every channel honest
   * about what IT is carrying — and stops a capped run from shipping the very
   * payload it capped to an event sink.
   *
   * Absent cap → both values come back by reference, so an agent that did not
   * ask for a ceiling is byte-identical.
   */
  const capResults = (
    toolName: string,
    values: { readonly result: unknown; readonly modelResult: unknown },
  ): { readonly result: unknown; readonly modelResult: unknown } => {
    const max = deps.maxToolResultChars;
    if (max === undefined) return values;
    const result = capToolResult(values.result, { toolName, maxChars: max }).value;
    return {
      result,
      // One marker when the two channels carry one value — the common case, and
      // the one where two distinct objects would be a difference with no fact
      // behind it.
      modelResult:
        values.modelResult === values.result
          ? result
          : capToolResult(values.modelResult, { toolName, maxChars: max }).value,
    };
  };

  // LENS · tool-result · persistent-history
  // reads: the tool's own declared resultCeiling / resultColumns ← ../../../resultCeiling.ts · applyResultCeiling, one owner of the measurement and the sentence
  // law: may omit, never deny; every clause anchored to the call it was composed on.
  /**
   * The tool's OWN refusing ceiling (9.20.0) — ONE implementation for every
   * dispatch door, applied at the execute boundary the moment the handler's
   * return lands (BEFORE the after-tool chain, the read_skill-gate precedent:
   * governance composes over what the model will actually read).
   *
   * `undefined` = no ceiling declared or the result fits — the caller keeps
   * today's path byte for byte. Otherwise: the typed `tools.result_refused`
   * event records the true size (the only place it survives), and the returned
   * TEACHING REFUSAL replaces the payload on every channel — history,
   * `stream.tool_end`, recorders. Distinct from the agent-level
   * `maxToolResultChars` (which truncates with a verbatim head, measured AFTER
   * the chain): this is the tool author's own contract, and the two compose —
   * the refusal sentence is far under any sane agent cap.
   */
  const refuseOverCeiling = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    tool: Tool | undefined,
    value: unknown,
    declaredStatus?: ToolResultStatus,
  ): string | undefined => {
    const ceiling = tool?.resultCeiling;
    // Measured on what the MODEL will read: the record-only coverage fields
    // (`short`, `kind`) come off before serving (`afterMoment`), so declaring
    // them must never tip a served result into a refusal. Same reference when
    // nothing is declared — the measurement is the one it always was.
    const verdict = applyResultCeiling(servedToModel(value), {
      toolName: call.toolName,
      ceiling,
    });
    if (verdict === undefined || ceiling === undefined) return undefined;
    typedEmit(scope, 'agentfootprint.tools.result_refused', {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      sizeChars: verdict.sizeChars,
      maxChars: ceiling.maxChars,
      // Copied — event payloads are detached plain data, never shared refs.
      ...(ceiling.narrowBy !== undefined && { narrowBy: [...ceiling.narrowBy] }),
      ...(declaredStatus !== undefined && { declaredStatus }),
    });
    return verdict.refusal;
  };

  return { capResults, refuseOverCeiling };
}
