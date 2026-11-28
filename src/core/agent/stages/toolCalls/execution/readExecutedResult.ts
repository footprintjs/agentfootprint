import type { CallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import type { DeclaredDispatch } from 'footprintjs/declared-attempts';
import { type CodeRunSlot, codeRunsOf } from '../../../../codeRunnerTool.js';
import { readToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import {
  readNativeToolFailure,
  type ToolFailureResult,
} from '../../../../../semantics/toolFailure.js';
import type { ExecutedToolResultEnvelope, MeasuredToolFailure } from '../contracts/callCells.js';
import {
  captureReturnedEffectAuthority,
  type EffectAuthority,
} from '../decorators/effectAdmission.js';
import type { Tool } from '../../../../../tools/tools.js';

interface NativeToolReturn {
  readonly result: unknown;
  readonly declaredFailure?: MeasuredToolFailure;
  readonly effectAuthority?: EffectAuthority;
}

/** Snapshot native evidence before resource cleanup and result projection. */
export function captureToolReturn(
  value: unknown,
  startedAt: number,
  startedMonotonic: number,
  dispatch?: DeclaredDispatch,
  effectOccurrence?: CallOccurrenceKey,
): NativeToolReturn {
  const durationMs = performance.now() - startedMonotonic;
  const declaration = readNativeToolFailure(value);
  if (declaration === undefined)
    return {
      result: value,
      ...(effectOccurrence && {
        effectAuthority: captureReturnedEffectAuthority(value, effectOccurrence),
      }),
    };
  return {
    result: (value as ToolFailureResult).content,
    declaredFailure: { ...declaration, startedAt, durationMs, dispatch },
  };
}

/** Read the delivered value and code-runner status after native capture.
 *
 * Keep content unwrapping here so framework projections still operate on
 * the existing delivery value. Proposal authority only comes from the
 * independently captured native return and never from this later read.
 */
export function readExecutedResult(
  tool: Tool,
  returned: unknown,
  slot: CodeRunSlot,
  nativeReturn?: NativeToolReturn,
): ExecutedToolResultEnvelope | undefined {
  const { declaredFailure, effectAuthority } = nativeReturn ?? {};
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
  const envelope = readToolResultEnvelope(returned);
  return effectAuthority && envelope ? { ...envelope, effectAuthority } : envelope;
}
