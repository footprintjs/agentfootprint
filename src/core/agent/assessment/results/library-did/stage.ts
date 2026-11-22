import { readOwnList } from '../../../../../lib/boundedJson.js';
import { MAX_ENTERED_TOOL_CALLS } from '../../../honesty/enteredToolCalls.js';
import {
  copyLibraryResultLimit,
  type LibraryResultLimit,
} from '../../../honesty/libraryResultLimits.js';
import { statePointer } from '../../pointer.js';
import type { AnswerAssessment, AssessmentPointer, AssessmentReason } from '../../types.js';

type State = Readonly<Record<string, unknown>>;
type LimitKind = LibraryResultLimit['kind'];

export const LIBRARY_LIMIT_WORDS: Readonly<Record<LimitKind, string>> = {
  'result-cut': 'a tool result was cut',
  'placed-unread': 'a tool result was stored by reference and not read',
  'times-without-zone': 'some times in a dataset have no zone',
};
export const INCOMPLETE_LIMIT_WORDS =
  "the record could not keep every limit on this turn's tool results";

export function isLibraryLimit(reason: AssessmentReason): reason is LimitKind {
  return reason === 'result-cut' || reason === 'placed-unread' || reason === 'times-without-zone';
}

type LimitReason = { reason: LimitKind | 'check-unreachable'; witness: AssessmentPointer };
const EMPTY: readonly LimitReason[] = [];

/** Map committed, turn-local producer receipts to evidence for the shared admission check. */
export function libraryResultReasons(state: State): readonly LimitReason[] {
  if (state.libraryResultLimits === undefined && state.libraryResultLimitsIncomplete !== true)
    return EMPTY;
  const reasons: LimitReason[] = [];
  const rows = readOwnList(state.libraryResultLimits, MAX_ENTERED_TOOL_CALLS);
  if (state.libraryResultLimitsIncomplete === true || (rows && rows.unread > 0)) {
    reasons.push({
      reason: 'check-unreachable',
      witness:
        state.libraryResultLimitsIncomplete === true
          ? statePointer('libraryResultLimitsIncomplete')
          : statePointer('libraryResultLimits', 'length'),
    });
  }
  if (!rows) return reasons;
  for (const [index, entry] of rows.entries.entries()) {
    const row = copyLibraryResultLimit(entry);
    if (row === undefined || row.turn !== state.turnNumber) continue;
    const field =
      row.kind === 'times-without-zone'
        ? 'naiveCount'
        : row.kind === 'result-cut'
        ? 'keptChars'
        : 'kind';
    reasons.push({ reason: row.kind, witness: statePointer('libraryResultLimits', index, field) });
  }
  return reasons;
}

function limitClause(row: LibraryResultLimit, displayName: string | undefined): string {
  switch (row.kind) {
    case 'result-cut':
      return `${displayName ?? 'a tool result'} was cut to ${row.keptChars.toLocaleString(
        'en-US',
      )} of ${row.totalChars.toLocaleString('en-US')} characters`;
    case 'placed-unread':
      return `${displayName ?? 'a tool result'} was stored by reference and not read`;
    case 'times-without-zone':
      return `${row.naiveCount.toLocaleString('en-US')} ${
        row.naiveCount === 1 ? 'time' : 'times'
      } in ${displayName ?? 'a dataset'} ${row.naiveCount === 1 ? 'has' : 'have'} no zone`;
  }
}

/** Rebuild the same clauses during replay using only the exact rows the fold admitted. */
export function libraryLimitClauses(
  assessment: AnswerAssessment,
  displayNames: ReadonlyMap<string, string>,
  state?: State,
): ReadonlyMap<AssessmentReason, readonly string[]> | undefined {
  if (!state || !assessment.reasons.some(({ reason }) => isLibraryLimit(reason))) return undefined;
  const rows = state.libraryResultLimits;
  if (!Array.isArray(rows)) return undefined;
  const byReason = new Map<AssessmentReason, string[]>();
  for (const { reason, witness } of assessment.reasons) {
    if (!isLibraryLimit(reason)) continue;
    const clauses: string[] = [];
    for (const pointer of witness) {
      if (pointer.kind !== 'state' || pointer.key !== 'libraryResultLimits') continue;
      const index = pointer.path.split('/')[1];
      if (index === undefined) continue;
      const row = copyLibraryResultLimit(Object.getOwnPropertyDescriptor(rows, index)?.value);
      if (row?.kind === reason && row.turn === state.turnNumber) {
        clauses.push(limitClause(row, displayNames.get(row.toolName)));
      }
    }
    if (clauses.length > 0) byReason.set(reason, clauses);
  }
  return byReason;
}
