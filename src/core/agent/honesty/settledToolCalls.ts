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
  recordedToolExecution,
  readRewrittenToolResult,
  type RecordedToolSettlement,
} from '../recordedCalls.js';
import { MAX_ENTERED_TOOL_CALLS, seedEnteredToolCalls } from './enteredToolCalls.js';
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
  const settlement: RecordedToolSettlement = {
    callOccurrenceKey,
    execution,
    ...(outcome !== undefined && { outcome }),
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
  seedEnteredToolCalls(scope, deps, continuing, recovered?.entries);
  seedToolSettlements(
    scope,
    deps.honestyLayers?.answer === true,
    continuing,
    recovered?.settlements,
  );
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
