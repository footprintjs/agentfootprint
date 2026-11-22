import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { NativeResultFinalizer, ResultFinalizationLanding } from './finalization.js';
import type {
  CappedResults,
  ToolLimitsOperations,
} from '../stages/toolCalls/contracts/operations/limits.js';
import { keepNegativeResultOut } from '../negativeClaims/capture.js';

/** The three executing resume owners use the same final refusal on both channels. */
export async function finalizeResumedResult(
  scope: TypedScope<AgentState>,
  finalizer: NativeResultFinalizer,
  toolName: string,
  values: CappedResults,
  landing: ResultFinalizationLanding,
  cap: ToolLimitsOperations['capResults'],
  negativeResultId?: string,
) {
  const refusal = await finalizer(values.modelResult, landing);
  if (refusal === undefined) return { values, refused: false as const };
  if (negativeResultId !== undefined) keepNegativeResultOut(scope, negativeResultId);
  return {
    values: cap(toolName, { result: refusal, modelResult: refusal }),
    refused: true as const,
  };
}
