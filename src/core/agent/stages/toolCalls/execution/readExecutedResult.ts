import type { CallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import type { DeclaredDispatch } from 'footprintjs/declared-attempts';
import { type CodeRunSlot, codeRunsOf } from '../../../../codeRunnerTool.js';
import { readToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import {
  readNativeToolFailure,
  type ToolFailureResult,
} from '../../../../../semantics/toolFailure.js';
import type { ExecutedToolResultEnvelope, MeasuredToolFailure } from '../contracts/callCells.js';
import { captureEffectAuthority } from '../decorators/effectAdmission.js';
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

/**
 * Admit the code runner's status at the same boundary as other typed tool returns.
 *
 * The typed effects channel (9.19.0): a recognized envelope is
 * unwrapped at the native return, at the one boundary the raw return crosses —
 * everything downstream (governance rules, the cap, history,
 * `tool_end`) sees the CONTENT, exactly what a bare return
 * would have shown. The effects are judged below, after the
 * gates, in call order.
 *
 * The typed effects channel (9.19.0) — same unwrap as the batch loop,
 * at this path's own execute boundary, so a resumed call's envelope is
 * judged exactly as an inline one's.
 */
export function readExecutedResult(
  tool: Tool,
  returned: unknown,
  slot: CodeRunSlot,
  declaredFailure?: MeasuredToolFailure,
  effectOccurrence?: CallOccurrenceKey,
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
  const envelope = readToolResultEnvelope(returned);
  if (!effectOccurrence || !envelope || envelope.effects.length + envelope.malformed.length === 0)
    return envelope;
  return {
    ...envelope,
    effectAuthority: captureEffectAuthority(returned, envelope, effectOccurrence),
  };
}
