import { servedUnderPolicy } from '../../../redaction/marker.js';
import {
  declarationOccurrences,
  historyStartsWith,
  readCallOccurrences,
} from '../recordedCalls.js';
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

const CALL_TYPES = new Set([
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_end',
  'agentfootprint.tools.absent',
  'agentfootprint.tools.coverage_declared',
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

  const rowCounts: Counts[] = [];
  for (const row of rows) {
    if (!isRecord(row)) return undefined;
    const counts = countsOf(row);
    if (counts === undefined) return undefined;
    rowCounts.push(counts);
  }

  // The occurrence reader pairs declarations through recorded events.
  // Event item lists may omit composed facets, so only committed rows supply counts.
  const events = turn.events.flatMap(({ type, meta, payload }, index) =>
    CALL_TYPES.has(type) && isRecord(meta) && isRecord(payload)
      ? [{ type, meta, payload, index }]
      : [],
  );
  const occurrences = readCallOccurrences(events, []);
  const rowOwners = declarationOccurrences(
    rows,
    events,
    occurrences,
    servedUnderPolicy(turn.snapshot),
  );

  const result: TurnCallCoverage[] = [];
  const byOccurrence = new Map<(typeof occurrences)[number], Counts>();
  for (const [index, row] of rowCounts.entries()) {
    const occurrence = rowOwners.get(index);
    if (occurrence === undefined) {
      result.push(row);
      continue;
    }
    const previous = byOccurrence.get(occurrence);
    if (previous === undefined) {
      const summary = { toolCallId: occurrence.providerId, ...row };
      byOccurrence.set(occurrence, summary);
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
