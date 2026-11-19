import { isPlaceholder, servedUnderPolicy } from '../../../redaction/marker.js';
import { historyStartsWith, readCallOccurrences } from '../recordedCalls.js';
import { isRecord, recordedTurn } from './source.js';
import type { TurnEvidenceSource } from './types.js';

/** Counts for one call occurrence or one unattributed declaration in the completed leg. */
export interface TurnCallCoverage {
  /** Full provider call ID. Absent if the record cannot establish the occurrence. */
  readonly toolCallId?: string;
  readonly declarations: number;
  readonly checked: number;
  readonly notChecked: number;
  readonly cannotCover: number;
}

const DECLARATION_KIND = {
  'agentfootprint.tools.absent': 'absence',
  'agentfootprint.tools.coverage_declared': 'ledger',
} as const;
const DECLARATION_TYPES = Object.keys(DECLARATION_KIND);
const CALL_TYPES = new Set([
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_end',
  ...DECLARATION_TYPES,
]);

type Declaration = Readonly<Record<string, unknown>>;
type Counts = {
  -readonly [Field in Exclude<keyof TurnCallCoverage, 'toolCallId'>]: TurnCallCoverage[Field];
};

function countsOf(row: Declaration): Counts | undefined {
  if (
    !Array.isArray(row.checked) ||
    !Array.isArray(row.notChecked) ||
    !Array.isArray(row.cannotCover)
  )
    return undefined;
  return {
    declarations: 1,
    checked: row.checked.length,
    notChecked: row.notChecked.length,
    cannotCover: row.cannotCover.length,
  };
}

function declarationKey(row: Declaration, kind: unknown, served: boolean): string | undefined {
  const { toolCallId, toolName, iteration } = row;
  if (
    (kind !== 'absence' && kind !== 'ledger') ||
    typeof toolCallId !== 'string' ||
    toolCallId.length === 0 ||
    typeof toolName !== 'string' ||
    typeof iteration !== 'number' ||
    !Number.isSafeInteger(iteration) ||
    (served && (isPlaceholder(toolCallId) || isPlaceholder(toolName)))
  )
    return undefined;
  return JSON.stringify([toolCallId, toolName, iteration, kind]);
}

function ownRows(snapshot: Declaration): readonly unknown[] | undefined {
  const { sharedState, initialState } = snapshot;
  if (!isRecord(sharedState) || !isRecord(initialState)) return undefined;
  const before: unknown = initialState.coverageDeclared;
  const after: unknown = sharedState.coverageDeclared;
  if (before === undefined && after === undefined) return [];
  if (!Array.isArray(after)) return undefined;
  if (before === undefined) return after;
  if (!Array.isArray(before) || !historyStartsWith(after, before)) return undefined;
  return after.slice(before.length);
}

function group<T>(byKey: Map<string, T[]>, key: string, value: T): void {
  const existing = byKey.get(key);
  if (existing === undefined) byKey.set(key, [value]);
  else existing.push(value);
}

/**
 * Read the exact current-leg coverage from committed state before merging any
 * declarations. The run ID is the completed invocation's `turn_end.meta.runId`.
 * A resumed leg excludes the ledger it inherited from the checkpoint. Reused
 * provider call IDs can appear on separate rows. Unattributed declarations
 * keep their counts and omit `toolCallId`.
 *
 * An empty list means the leg declared no coverage. `undefined` means the
 * committed state or its starting point could not be read for this invocation.
 */
export function readTurnCoverage(
  source: TurnEvidenceSource,
  runId: string,
): readonly TurnCallCoverage[] | undefined {
  const turn = recordedTurn(source, runId);
  if (turn?.snapshot === undefined) return undefined;
  const rows = ownRows(turn.snapshot);
  if (rows === undefined) return undefined;
  if (rows.length === 0) return [];

  const served = servedUnderPolicy(turn.snapshot);
  const rowCounts: Counts[] = [];
  const rowsByKey = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) return undefined;
    const counts = countsOf(row);
    if (counts === undefined) return undefined;
    rowCounts.push(counts);
    const key = declarationKey(row, row.kind, served);
    if (key !== undefined) group(rowsByKey, key, index);
  }

  // Typed events identify the occurrence. Their item lists may omit composed
  // facets, so only the committed rows supply counts. Dispatch writes and
  // emits declarations in the same order. Refuse positional attribution for
  // a key if either side lost a declaration or retained an unpaired event.
  const events = turn.events.flatMap(({ type, meta, payload }, index) =>
    CALL_TYPES.has(type) && isRecord(meta) && isRecord(payload)
      ? [{ type, meta, payload, index }]
      : [],
  );
  const occurrences = readCallOccurrences(events, []);
  const eventOwners = new Map<number, number>();
  for (const [index, occurrence] of occurrences.entries()) {
    for (const type of DECLARATION_TYPES) {
      for (const event of occurrence.eventsOf(type)) eventOwners.set(event.index, index);
    }
  }
  const eventsByKey = new Map<string, number[]>();
  for (const event of events) {
    if (
      event.type !== 'agentfootprint.tools.absent' &&
      event.type !== 'agentfootprint.tools.coverage_declared'
    )
      continue;
    const key = declarationKey(event.payload, DECLARATION_KIND[event.type], served);
    if (key !== undefined) group(eventsByKey, key, event.index);
  }
  const rowOwners = new Map<number, number>();
  for (const [key, indices] of rowsByKey) {
    const witnesses = eventsByKey.get(key);
    if (witnesses?.length !== indices.length) continue;
    for (const [position, eventIndex] of witnesses.entries()) {
      const rowIndex = indices[position];
      const owner = eventOwners.get(eventIndex);
      if (rowIndex !== undefined && owner !== undefined) rowOwners.set(rowIndex, owner);
    }
  }

  const result: TurnCallCoverage[] = [];
  const byOccurrence = new Map<number, Counts>();
  for (const [index, row] of rowCounts.entries()) {
    const owner = rowOwners.get(index);
    const occurrence = owner === undefined ? undefined : occurrences[owner];
    if (owner === undefined || occurrence === undefined) {
      result.push(row);
      continue;
    }
    const previous = byOccurrence.get(owner);
    if (previous === undefined) {
      const summary = { toolCallId: occurrence.providerId, ...row };
      byOccurrence.set(owner, summary);
      result.push(summary);
      continue;
    }
    previous.declarations += row.declarations;
    previous.checked += row.checked;
    previous.notChecked += row.notChecked;
    previous.cannotCover += row.cannotCover;
  }
  return result;
}
