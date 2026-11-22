import { type CodeRunSlot, codeRunsOf } from '../../../../codeRunnerTool.js';
import { readToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import type { ExecutedToolResultEnvelope } from '../contracts/callCells.js';
import type { Tool } from '../../../../../tools/tools.js';

/** Admit the code runner's status at the same boundary as other typed tool returns. */
export function readExecutedResult(
  tool: Tool,
  returned: unknown,
  slot: CodeRunSlot,
): ExecutedToolResultEnvelope | undefined {
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
