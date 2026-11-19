import { copyArgumentDisplay } from '../../../lib/argumentDisplay.js';
import { canonicalJson } from '../../../lib/canonicalJson.js';
import { isPersonEntry } from '../../../lib/saidByPerson.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import { isPlaceholder } from '../../../redaction/marker.js';
import { recordedCallOutcome } from '../../../semantics/toolOutcome.js';
import { isRecord, str, unfinishedCallStatus } from './recordValues.js';
import { rowList } from './sources.js';
import type { AnswerAssessment } from './types.js';

/** One tool result of this turn, where it sits in `history`. */
export interface TurnResult {
  readonly index: number;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly outcome?: NonNullable<ReturnType<typeof recordedCallOutcome>>;
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
export function turnResults(history: readonly unknown[]): {
  readonly results: readonly TurnResult[];
  readonly from: AnswerAssessment['turnFrom'];
  readonly begins: number;
} {
  let start = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    // The WHOLE entry goes to the rule (`lib/saidByPerson.ts` · `isPersonEntry`),
    // the answer account's reader too: a copy of three fields dropped
    // `ephemeral`, and the two disagreed on where this turn begins.
    if (isPersonEntry(history[i])) {
      start = i;
      break;
    }
  }
  const results: TurnResult[] = [];
  for (let i = start + 1; i < history.length; i++) {
    const m = history[i];
    if (!isRecord(m) || m.role !== 'tool') continue;
    const toolCallId = str(m.toolCallId);
    const toolName = str(m.toolName);
    const outcome = recordedCallOutcome(m);
    const reportedStatus = unfinishedCallStatus(m);
    results.push({
      index: i,
      ...(toolCallId !== undefined && { toolCallId }),
      ...(toolName !== undefined && { toolName }),
      ...(outcome !== undefined && { outcome }),
      ...(reportedStatus !== undefined && { reportedStatus }),
      content: toolBytesOf({ content: m.content, toolChars: m.toolChars }),
    });
  }
  return { results, from: start >= 0 ? 'person' : 'whole-history', begins: start };
}

function hasHiddenValue(value: unknown): boolean {
  if (isPlaceholder(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value).some(hasHiddenValue);
}

/** An absent, malformed or partly hidden proposal cannot establish equality. */
function argsKey(value: unknown): string | undefined {
  const args = copyArgumentDisplay(value);
  return args === undefined || hasHiddenValue(args) ? undefined : canonicalJson(args);
}

interface RecordedArguments {
  readonly signature: string;
  readonly proposedAt: number;
}

/**
 * A result can compare its arguments only with its own preceding proposal.
 * Consume the proposal at the result so an id reused later in this turn
 * cannot overwrite an earlier call's recorded arguments.
 */
function resultArguments(
  history: readonly unknown[],
  begins: number,
): ReadonlyMap<number, RecordedArguments> {
  const proposals = new Map<string, { call: Readonly<Record<string, unknown>>; index: number }>();
  const argsByResult = new Map<number, RecordedArguments>();
  for (let index = begins + 1; index < history.length; index++) {
    const message = history[index];
    if (!isRecord(message)) continue;
    if (message.role === 'assistant') {
      for (const call of rowList(message.toolCalls)?.entries ?? []) {
        if (isRecord(call) && typeof call.id === 'string') proposals.set(call.id, { call, index });
      }
      continue;
    }
    if (message.role !== 'tool' || typeof message.toolCallId !== 'string') continue;
    const proposal = proposals.get(message.toolCallId);
    proposals.delete(message.toolCallId);
    if (
      proposal === undefined ||
      proposal.call.name !== message.toolName ||
      proposal.call.argumentsFailure !== undefined
    )
      continue;
    const args = argsKey(proposal.call.args);
    if (args !== undefined) {
      argsByResult.set(index, {
        signature: JSON.stringify([message.toolName, args]),
        proposedAt: proposal.index,
      });
    }
  }
  return argsByResult;
}

/**
 * A completion excuses a failed, refused or unfinished call only when it was proposed
 * after that result. A call already in flight was not tried again. A framework
 * notice or an undispatched sibling never stands in for a completed result.
 */
export function recoveredCallOutcomes(
  results: readonly TurnResult[],
  history: readonly unknown[],
  begins: number,
  retainedHistory?: (history: readonly unknown[]) => unknown,
): ReadonlySet<number> {
  const recovered = new Set<number>();
  const needsRetry = (result: TurnResult): boolean =>
    result.outcome !== undefined || result.reportedStatus !== undefined;
  if (!results.some(needsRetry)) return recovered;
  const recordedHistory = retainedHistory === undefined ? history : retainedHistory(history);
  if (!Array.isArray(recordedHistory)) return recovered;
  const argsByResult = resultArguments(recordedHistory, begins);
  const completed = new Map<string, number>();
  for (const result of [...results].reverse()) {
    const args = argsByResult.get(result.index);
    if (args === undefined) continue;
    const latestRetry = completed.get(args.signature) ?? -1;
    if (needsRetry(result)) {
      if (latestRetry > result.index) recovered.add(result.index);
      continue;
    }
    const recorded = history[result.index];
    if (
      isRecord(recorded) &&
      recorded.outcome === undefined &&
      recorded.reportedStatus === undefined &&
      recorded.notDispatched === undefined &&
      recorded.toolResultOrigin === undefined
    ) {
      completed.set(args.signature, Math.max(latestRetry, args.proposedAt));
    }
  }
  return recovered;
}
