import { type CodeRunSlot, codeRunsOf } from '../../../../codeRunnerTool.js';
import {
  type ReadToolResultEnvelope,
  readToolResultEnvelope,
} from '../../../../../semantics/toolEffects.js';
import type { Tool } from '../../../../../tools/tools.js';

/** Admit the code runner's status at the same boundary as other typed tool returns. */
export function readExecutedResult(
  tool: Tool,
  returned: unknown,
  slot: CodeRunSlot,
): ReadToolResultEnvelope | undefined {
  const nativeResult = slot.result;
  if (
    nativeResult !== undefined &&
    nativeResult.text === returned &&
    nativeResult.runs === codeRunsOf(tool)
  ) {
    return { content: nativeResult.text, status: nativeResult.status, effects: [], malformed: [] };
  }
  return readToolResultEnvelope(returned);
}
