import type { TypedScope } from 'footprintjs';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { readToolOutputCounts } from '../recordedCalls/outputCounts.js';
import { readNotDispatched } from '../../../semantics/toolRan.js';
import type { AgentState } from '../types.js';
import type { PendingResumeHistory } from '../runtime/conversation/seedHistory.js';
import { declaredByValue, readEmptiness } from '../emptiness.js';
import {
  assessmentCallOutcome,
  recordedToolFailureCategory,
  recordedToolExecution,
  readResultDispositionMark,
  readRewrittenToolResult,
  readToolSettlements,
  type RecordedToolSettlement,
} from '../recordedCalls.js';
import { MAX_ENTERED_TOOL_CALLS, seedEnteredToolCalls } from './enteredToolCalls.js';
import { recordLibraryResultLimits } from './libraryResultLimits.js';
import type { HonestyLayers } from './armed.js';

type Coverage = NonNullable<AgentState['coverageDeclared']>;

/** File only the result properties the standing can lawfully read after settlement. */
export function toolSettlementOf(
  message: LLMMessage,
  coverage: Coverage = [],
): RecordedToolSettlement | undefined {
  const key = readCallOccurrenceKey(message);
  const address = message.callOccurrenceKey;
  if (typeof key !== 'string' || address === undefined) return undefined;
  const execution = recordedToolExecution({ ...message });
  if (execution === 'unknown' || execution === 'entered-unknown-result') return undefined;
  const callOccurrenceKey = [...address] as const;
  if (
    (execution === 'returned' || execution === 'returned-unserved') &&
    message.toolResultDisposition === 'withheld'
  ) {
    return { callOccurrenceKey, execution, delivery: 'withheld' };
  }

  const unwrapped = toolBytesOf({ content: message.content, toolChars: message.toolChars });
  const rewrite =
    execution === 'returned' && message.toolResultDisposition === 'rewritten'
      ? readRewrittenToolResult(unwrapped)
      : undefined;
  const outcome =
    rewrite !== undefined
      ? rewrite.outcome
      : readNotDispatched(message.notDispatched) === 'settled'
      ? 'settled'
      : assessmentCallOutcome({ ...message });
  const failureCategory = recordedToolFailureCategory(message);
  const settlement: RecordedToolSettlement = {
    callOccurrenceKey,
    execution,
    ...(outcome !== undefined && { outcome }),
    ...(failureCategory !== undefined && { failureCategory }),
  };
  if (execution !== 'returned') return settlement;

  const reportedStatus = rewrite !== undefined ? rewrite.reportedStatus : message.reportedStatus;
  const outputCounts =
    rewrite === undefined && (outcome === 'failed' || reportedStatus === 'partial')
      ? readToolOutputCounts(message.toolOutputCounts)
      : undefined;
  const content = rewrite === undefined ? unwrapped : rewrite.content;
  const rows =
    rewrite === undefined ? coverage.filter((row) => readCallOccurrenceKey(row) === key) : [];
  const door =
    rows.length === 0
      ? undefined
      : {
          absent: rows.some((row) => row.kind === 'absence'),
          bounded: rows.some((row) => row.kind === 'ledger'),
        };
  const reading = readEmptiness(content, door === undefined ? undefined : { door });
  const gap =
    door === undefined
      ? declaredByValue(content)?.gap === true
      : rows.some((row) => row.notChecked.length > 0 || row.cannotCover.length > 0);
  const empty =
    reading.emptiness === 'declared-absent'
      ? 'declared-absent'
      : door === undefined && reading.emptiness === 'undeclared-empty'
      ? 'empty-undeclared'
      : undefined;
  return {
    ...settlement,
    delivery: rewrite === undefined ? 'native' : 'rewritten',
    ...((reportedStatus === 'partial' || reportedStatus === 'pending') && { reportedStatus }),
    ...(outputCounts !== undefined && { outputCounts }),
    ...(empty !== undefined && { empty }),
    ...(gap && { gap: true as const }),
    ...(rewrite?.period !== undefined && { rewrittenPeriod: rewrite.period }),
  };
}

/** The same-request error carries its partial proof. A new turn starts empty. */
export function seedToolSettlements(
  scope: TypedScope<AgentState>,
  armed: boolean,
  continuing: boolean,
  recovered?: { readonly rows: readonly RecordedToolSettlement[]; readonly complete: boolean },
): void {
  if (!armed) return;
  scope.settledToolCalls = recovered === undefined ? [] : [...recovered.rows];
  scope.settledToolCallsComplete = recovered?.complete ?? !continuing;
}

export function seedToolEvidence(
  scope: TypedScope<AgentState>,
  deps: { readonly honestyLayers?: HonestyLayers; readonly findings?: boolean },
  resume?: PendingResumeHistory,
): void {
  const continuing = resume !== undefined && !resume.appendsUserTurn;
  const recovered = continuing ? resume.toolTurnEvidence : undefined;
  if (recovered?.libraryResultLimits !== undefined) {
    scope.libraryResultLimits = [...recovered.libraryResultLimits];
  }
  if (recovered?.libraryResultLimitsIncomplete === true) scope.libraryResultLimitsIncomplete = true;
  seedEnteredToolCalls(scope, deps, continuing, recovered?.entries);
  const armed = deps.honestyLayers?.answer === true;
  seedToolSettlements(scope, armed, continuing, recovered?.settlements);
}

/** Commit the facts at the same boundary as the newly settled messages. */
export function commitSettledToolHistory(
  scope: TypedScope<AgentState>,
  history: readonly LLMMessage[],
): void {
  const prior =
    'settledToolCalls' in scope
      ? (scope.$getValue('settledToolCalls') as AgentState['settledToolCalls'])
      : undefined;
  if (prior !== undefined) {
    const coverage = (scope.$getValue('coverageDeclared') as Coverage | undefined) ?? [];
    const added: RecordedToolSettlement[] = [];
    const room = MAX_ENTERED_TOOL_CALLS - prior.length;
    for (const message of history.slice(scope.history.length)) {
      if (message.role !== 'tool') continue;
      const fact = added.length < room ? toolSettlementOf(message, coverage) : undefined;
      if (fact !== undefined) added.push(fact);
      else if (scope.settledToolCallsComplete === true) scope.settledToolCallsComplete = false;
    }
    if (added.length > 0) scope.settledToolCalls = [...prior, ...added];
  }
  scope.history = history;
}

/** Append evidence of this turn's visible results removed by the applied window. */
export function commitWindowResultDrops(
  scope: TypedScope<AgentState>,
  nextHistory: readonly LLMMessage[],
  strategy: string,
): void {
  if (!Object.hasOwn(scope, 'settledToolCalls')) return;
  const prior = scope.$getValue('settledToolCalls') as AgentState['settledToolCalls'];
  if (prior === undefined || prior.length === 0) return;
  const settlements = readToolSettlements(prior, true);
  if (settlements === undefined || settlements.byKey.size === 0) return;
  const previous = scope.$getValue('history') as readonly LLMMessage[];
  // Only the applied window can prove a removal. Restrict the comparison to the bounded
  // settlement index for this turn, and leave duplicated history occurrences ambiguous.
  const dropped = new Map<string, LLMMessage | null>();
  for (const message of previous) {
    if (message.role !== 'tool') continue;
    const key = readCallOccurrenceKey(message);
    if (typeof key === 'string' && settlements.byKey.has(key))
      dropped.set(key, dropped.has(key) ? null : message);
  }
  if (dropped.size === 0) return;
  for (const message of nextHistory) {
    if (message.role !== 'tool') continue;
    const key = readCallOccurrenceKey(message);
    if (typeof key === 'string') dropped.delete(key);
    if (dropped.size === 0) return;
  }
  const receipts = [];
  for (const [key, message] of dropped) {
    const fact = settlements.byKey.get(key)?.fact;
    if (
      message === null ||
      fact?.execution !== 'returned' ||
      (fact.delivery !== 'native' && fact.delivery !== 'rewritten') ||
      typeof message.toolName !== 'string' ||
      typeof message.toolCallId !== 'string'
    )
      continue;
    const mark = readResultDispositionMark(message);
    if (
      mark === 'withheld' ||
      mark === 'unknown' ||
      recordedToolExecution({ ...message }) !== 'returned'
    )
      continue;
    receipts.push({
      call: {
        toolName: message.toolName,
        toolCallId: message.toolCallId,
        callOccurrenceKey: fact.callOccurrenceKey,
      },
      fact: { kind: 'result-dropped-from-window' as const, strategy },
    });
  }
  if (receipts.length === 0) return;
  const turn = scope.turnNumber;
  const existing =
    (scope.$getValue('libraryResultLimits') as AgentState['libraryResultLimits']) ?? [];
  const seen = new Set(
    existing
      .filter((row) => row.kind === 'result-dropped-from-window' && row.turn === turn)
      .map(readCallOccurrenceKey),
  );
  recordLibraryResultLimits(
    scope,
    receipts.filter(({ call }) => !seen.has(readCallOccurrenceKey(call))),
  );
}
