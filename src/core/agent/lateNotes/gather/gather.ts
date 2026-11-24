import { readOwnList } from '../../../../lib/boundedJson.js';
import { readDisplayName } from '../../../../lib/displayName.js';
import { isPlaceholder } from '../../../../redaction/marker.js';
import { coverageRows } from '../../assessment/coverageRows.js';
import { witnessRowIndex } from '../../assessment/pointer.js';
import { isRecord } from '../../assessment/recordValues.js';
import {
  isLibraryLimit,
  libraryResultReasons,
} from '../../assessment/results/library-did/stage.js';
import { standingAdmission } from '../../assessment/standingAdmission.js';
import { MAX_ENTERED_TOOL_CALLS } from '../../honesty/enteredToolCalls.js';
import { historyCallAt, historyCallResolver, type HistoryCall } from '../../recordedCalls.js';
import type { LateNotePoint } from '../compose/render.js';

type RecordState = Readonly<Record<string, unknown>>;
type Admission = ReturnType<typeof standingAdmission>;
const MAX_GAPS_PER_SECTION = 8;

function ownField(row: unknown, key: PropertyKey): unknown {
  return isRecord(row) ? Object.getOwnPropertyDescriptor(row, key)?.value : undefined;
}

function visibleText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && !isPlaceholder(value) ? value : undefined;
}

function displayTool(
  value: unknown,
  displayNames: ReadonlyMap<string, string>,
): string | undefined {
  const name = visibleText(value);
  return name === undefined ? undefined : readDisplayName(visibleText(displayNames.get(name)));
}

function gapPoints(
  recorded: RecordState,
  admission: Admission,
  displayNames: ReadonlyMap<string, string>,
): readonly LateNotePoint[] {
  const declarations = readOwnList(recorded.coverageDeclared, MAX_ENTERED_TOOL_CALLS)?.entries;
  if (declarations === undefined) return [];
  const points: LateNotePoint[] = [];
  const admitted = coverageRows(declarations, () => undefined, undefined, admission.nativeResult);
  for (const declaration of admitted) {
    if (!declaration.gap) continue;
    const row = declarations[declaration.index];
    const tool = displayTool(ownField(row, 'toolName'), displayNames);
    if (tool === undefined) continue;
    for (const kind of ['notChecked', 'cannotCover'] as const) {
      const section = readOwnList(ownField(row, kind), MAX_GAPS_PER_SECTION)?.entries ?? [];
      for (const item of section) {
        if (visibleText(ownField(item, 'what')) === undefined) continue;
        // The attributed JSON carrier escapes the complete retained WHY. The
        // standing line's display formatter would shorten it or remove breaks.
        const why = visibleText(ownField(item, 'why'));
        points.push({ owner: 'tool', kind, tool, ...(why !== undefined && { why }) });
      }
    }
  }
  return points;
}

function libraryPoints(
  recorded: RecordState,
  admission: Admission,
  displayNames: ReadonlyMap<string, string>,
): readonly LateNotePoint[] {
  const rows = recorded.libraryResultLimits;
  if (!Array.isArray(rows)) return [];
  const points: LateNotePoint[] = [];
  for (const { reason, witness } of libraryResultReasons(recorded)) {
    if (!isLibraryLimit(reason) || witness.kind !== 'state' || !admission.admit(reason, witness))
      continue;
    const index = witnessRowIndex(witness.path);
    if (index === undefined) continue;
    const row: unknown = Object.getOwnPropertyDescriptor(rows, String(index))?.value;
    const tool = displayTool(ownField(row, 'toolName'), displayNames);
    if (tool !== undefined) points.push({ owner: 'library', kind: reason, tool });
  }
  return points;
}

function failurePoints(
  recorded: RecordState,
  admission: Admission,
  displayNames: ReadonlyMap<string, string>,
): readonly LateNotePoint[] {
  if (admission.settlements === undefined) return [];
  const failures = [...admission.settlements.byKey].filter(
    ([, { fact }]) => fact.outcome === 'failed' && fact.delivery !== 'withheld',
  );
  if (failures.length === 0) return [];
  // Settlements prove what happened, but carry no name. A whole bounded
  // window may name the occurrence; a clipped one cannot rule out a duplicate.
  const history = readOwnList(recorded.history, MAX_ENTERED_TOOL_CALLS);
  if (history === undefined || history.unread !== 0) return [];
  const calls: HistoryCall[] = [];
  for (let index = 0; index < history.entries.length; index++) {
    const call = historyCallAt(history.entries, index);
    if (call !== undefined) calls.push(call);
  }
  const resolve = historyCallResolver(calls);
  const points: LateNotePoint[] = [];
  for (const [key, { fact }] of failures) {
    const occurrence = resolve(undefined, undefined, key);
    if (occurrence.kind !== 'matched') continue;
    const tool = displayTool(occurrence.call.toolName, displayNames);
    if (tool === undefined) continue;
    const kind =
      fact.failureCategory === undefined ? 'call-failed' : `call-failed:${fact.failureCategory}`;
    points.push({ owner: 'tool', kind, tool });
  }
  return points;
}

/** Fold only admitted current-turn facts and project the already served names and words. */
export function gatherLateNotePoints(
  recorded: RecordState,
  displayNames: ReadonlyMap<string, string>,
): readonly LateNotePoint[] {
  if (displayNames.size === 0) return [];
  const admission = standingAdmission(recorded, [], [], []);
  if (admission.settlements === undefined) return [];
  return [
    ...gapPoints(recorded, admission, displayNames),
    ...libraryPoints(recorded, admission, displayNames),
    ...failurePoints(recorded, admission, displayNames),
  ];
}
