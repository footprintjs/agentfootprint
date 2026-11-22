import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import { isPlaceholder } from '../../../../../redaction/marker.js';
import type { CoverageRow } from '../../coverageRows.js';
import { witnessRowIndex } from '../../pointer.js';
import type { AssessmentPointer, AssessmentReason, AssessmentToolWords } from '../../types.js';
import { readDeclaredWords } from './declaredWords.js';

const MAX_TOOL_WORDS_CHARS = 160;
const MAX_TOOL_WORDS_ENTRIES = 3;

export function coverageUsesToolWords(reason: AssessmentReason): boolean {
  return reason === 'coverage-gap' || reason === 'declared-absent';
}

function rowAt(rows: readonly unknown[], index: number): unknown {
  return Object.getOwnPropertyDescriptor(rows, String(index))?.value;
}

/** Link only admitted declarations to an exact occurrence, never a reused provider id. */
export function declaredWordsReader(
  coverage: readonly CoverageRow[],
  words: unknown,
): (
  reason: AssessmentReason,
  witness: readonly AssessmentPointer[],
  periodOccurrenceOf?: (pointer: AssessmentPointer) => string | undefined,
) => AssessmentToolWords | undefined {
  if (!Array.isArray(words)) return () => undefined;
  const byIndex = new Set<number>();
  const byOccurrence = new Map<string, number[]>();
  for (const row of coverage) {
    const key = row.occurrenceKey;
    const visible = rowAt(words, row.index);
    if (
      key === undefined ||
      visible === null ||
      typeof visible !== 'object' ||
      readCallOccurrenceKey(visible) !== key
    )
      continue;
    byIndex.add(row.index);
    const rows = byOccurrence.get(key);
    if (rows === undefined) byOccurrence.set(key, [row.index]);
    else rows.push(row.index);
  }
  return (reason, witness, periodOccurrenceOf) => {
    const selected = new Set<number>();
    for (const pointer of witness) {
      if (pointer.kind === 'state' && pointer.key === 'coverageDeclared') {
        const index = witnessRowIndex(pointer.path);
        if (index !== undefined && byIndex.has(index)) selected.add(index);
        continue;
      }
      const occurrence = periodOccurrenceOf?.(pointer);
      if (occurrence !== undefined) {
        for (const index of byOccurrence.get(occurrence) ?? []) selected.add(index);
      }
    }
    const entries: AssessmentToolWords['entries'][number][] = [];
    const seen = new Set<string>();
    let remaining = MAX_TOOL_WORDS_CHARS;
    let omitted = 0;
    const add = (
      kind: AssessmentToolWords['entries'][number]['kind'],
      text: string,
      toolName?: string,
    ) => {
      const key = JSON.stringify([kind, text, toolName]);
      if (seen.has(key)) return;
      seen.add(key);
      if (text.length <= remaining && entries.length < MAX_TOOL_WORDS_ENTRIES) {
        entries.push({ kind, text, ...(toolName !== undefined && { toolName }) });
        remaining -= text.length;
      } else {
        omitted++;
      }
    };
    for (const index of selected) {
      const visible = rowAt(words, index);
      if (visible === null || typeof visible !== 'object') continue;
      const row = readDeclaredWords(visible);
      if (row === undefined) continue;
      const name = Object.getOwnPropertyDescriptor(visible, 'toolName')?.value as unknown;
      const toolName =
        typeof name === 'string' && name.length > 0 && name.length <= 128 && !isPlaceholder(name)
          ? name
          : undefined;
      if (reason !== 'declared-absent') {
        for (const kind of ['notChecked', 'cannotCover'] as const) {
          for (const text of row[kind].words) add(kind, text, toolName);
          omitted += row[kind].omitted;
        }
      }
      if (reason !== 'coverage-gap') {
        if (row.tryInstead !== undefined) add('tryInstead', row.tryInstead, toolName);
        if (row.adviceOmitted) omitted++;
      }
    }
    return entries.length > 0 || omitted > 0 ? { entries, omitted } : undefined;
  };
}
