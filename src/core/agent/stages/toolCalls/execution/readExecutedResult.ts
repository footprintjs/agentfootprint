import type { DeclaredDispatch } from 'footprintjs/declared-attempts';
import { type CodeRunSlot, codeRunsOf } from '../../../../codeRunnerTool.js';
import { readToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import {
  readNativeToolFailure,
  type ToolFailureResult,
} from '../../../../../semantics/toolFailure.js';
import type { ExecutedToolResultEnvelope, MeasuredToolFailure } from '../contracts/callCells.js';
import type { Tool } from '../../../../../tools/tools.js';

/** Take the identity and timing before negative-claim capture can copy the payload. */
export function captureToolReturn(
  value: unknown,
  startedAt: number,
  startedMonotonic: number,
  dispatch?: DeclaredDispatch,
): { readonly result: unknown; readonly declaredFailure?: MeasuredToolFailure } {
  const durationMs = performance.now() - startedMonotonic;
  const declaration = readNativeToolFailure(value);
  if (declaration === undefined) return { result: value };
  return {
    result: (value as ToolFailureResult).content,
    declaredFailure: { ...declaration, startedAt, durationMs, dispatch },
  };
}

/** Admit the code runner's status at the same boundary as other typed tool returns. */
export function readExecutedResult(
  tool: Tool,
  returned: unknown,
  slot: CodeRunSlot,
  declaredFailure?: MeasuredToolFailure,
): ExecutedToolResultEnvelope | undefined {
  if (declaredFailure !== undefined) {
    return { content: returned, status: 'failure', effects: [], malformed: [], declaredFailure };
  }
  const nativeResult = slot.result;
  if (
    nativeResult !== undefined &&
    nativeResult.text === returned &&
    nativeResult.runs === codeRunsOf(tool)
  ) {
    return {
      content: nativeResult.text,
      status: nativeResult.status,
      effects: [],
      malformed: [],
      outputCounts: nativeResult.outputCounts,
    };
  }
  return readToolResultEnvelope(returned);
}
