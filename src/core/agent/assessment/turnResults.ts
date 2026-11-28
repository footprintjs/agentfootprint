import { isPersonEntry } from '../../../lib/saidByPerson.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import { readNotDispatched } from '../../../semantics/toolRan.js';
import {
  assessmentCallOutcome,
  isRecordedBatchRefusal,
  readHistoryCalls,
  type HistoryCall,
} from '../recordedCalls.js';
import { unfinishedCallStatus } from './recordValues.js';
import type { AnswerAssessment } from './types.js';

/** One tool result of this turn, where it sits in `history`. */
export interface TurnResult {
  readonly index: number;
  readonly rewritten?: true;
  readonly batchRefusal?: true;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly outcome?: NonNullable<ReturnType<typeof assessmentCallOutcome>>;
  readonly outcomePath?:
    | '/outcome'
    | '/notDispatched/pausedCall/toolCallId'
    | '/toolResultOrigin'
    | '/toolResultExecution';
  readonly reportedStatus?: NonNullable<ReturnType<typeof unfinishedCallStatus>>;
  /**
   * The TOOL's own bytes — `content` cut at the tool-bytes boundary
   * (`lib/toolBytes.ts` · `toolBytesOf`). The inputs layer appends a note
   * after a filled call's result; read whole, the note breaks the parse and
   * the one emptiness reader returns `unknown`, which would hide
   * `empty-undeclared`, `declared-absent` and a listed gap on exactly the
   * calls that ran on a default nobody chose.
   */
  readonly content: unknown;
}

/**
 * The results after the last message a person said — or all of them, said so,
 * when none is — each read as the tool's own bytes; and where that message
 * sits (`begins`, `-1` when there is none).
 */
export function turnResults(
  history: readonly unknown[],
  occurrences: readonly HistoryCall[] = readHistoryCalls(history),
): {
  readonly results: readonly TurnResult[];
  readonly from: AnswerAssessment['turnFrom'];
  readonly begins: number;
} {
  let start = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    // The WHOLE entry goes to the rule (`lib/saidByPerson.ts` · `isPersonEntry`),
    // the answer account's reader too: a copy of three fields dropped
    // `ephemeral`, and the two disagreed on where this turn begins.
    if (isPersonEntry(Object.getOwnPropertyDescriptor(history, String(i))?.value)) {
      start = i;
      break;
    }
  }
  const results: TurnResult[] = [];
  for (const occurrence of occurrences) {
    const { index: i, message: m, providerId: toolCallId, toolName } = occurrence;
    if (i <= start) continue;
    const outcome = assessmentCallOutcome(m);
    const reportedStatus = unfinishedCallStatus(m);
    const outcomePath =
      outcome === undefined
        ? readNotDispatched(m.notDispatched) === 'settled'
          ? '/notDispatched/pausedCall/toolCallId'
          : undefined
        : m.outcome !== undefined
        ? '/outcome'
        : m.toolResultOrigin !== undefined
        ? '/toolResultOrigin'
        : '/toolResultExecution';
    results.push({
      index: i,
      ...(toolCallId !== undefined && { toolCallId }),
      ...(toolName !== undefined && { toolName }),
      ...(outcome !== undefined && { outcome }),
      ...(outcomePath !== undefined && { outcomePath }),
      ...(reportedStatus !== undefined && { reportedStatus }),
      content: toolBytesOf({ content: m.content, toolChars: m.toolChars }),
    });
  }
  const beforeBatches = results.length;
  for (let index = start + 1; index < history.length; index++) {
    const message = Object.getOwnPropertyDescriptor(history, String(index))?.value;
    if (isRecordedBatchRefusal(message)) {
      results.push({ index, batchRefusal: true, outcome: 'refused', content: undefined });
    }
  }
  if (results.length > beforeBatches) results.sort((a, b) => a.index - b.index);
  return { results, from: start >= 0 ? 'person' : 'whole-history', begins: start };
}
