import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import {
  callEntered,
  historyCallResolver,
  recordedToolExecution,
  resultDispositions,
  type HistoryCall,
} from '../recordedCalls.js';
import type { ArgumentRowRead } from './argumentRows.js';
import { ENTRY_EVIDENCE_KEY, entryEvidenceOf, legacyEntryKeys } from './entryEvidence.js';
import { reasonClassOf, type ReasonWitnessKind } from './reasonClasses.js';
import { isRecord } from './recordValues.js';
import { callAddressOf, rowList } from './sources.js';
import type { AssessmentPointer, AssessmentReason } from './types.js';

type Resolve = ReturnType<typeof historyCallResolver>;
type Row = Readonly<Record<string, unknown>>;

function itemAt(source: unknown, index: number): unknown {
  return Array.isArray(source) && Number.isSafeInteger(index) && index >= 0
    ? Object.getOwnPropertyDescriptor(source, String(index))?.value
    : undefined;
}

function rowOf(state: Row, pointer: AssessmentPointer): Row | undefined {
  if (pointer.kind !== 'state') return undefined;
  const [, segment, entry] = pointer.path.split('/');
  const subject = state[pointer.key];
  const read =
    pointer.key === 'answerValidation' && segment === 'checks' && isRecord(subject)
      ? itemAt(subject.checks, Number(entry))
      : itemAt(subject, Number(segment));
  return isRecord(read) ? read : undefined;
}

function witnessKind(row: Row | undefined): ReasonWitnessKind {
  if (row?.kind === 'contingent' && row.declaredOn === 'answer') return 'answer';
  if (row?.kind === 'call-window' && row.refused === 'beyond-retention') return 'retention-refusal';
  if (row?.kind === 'period') return 'period';
  return row?.kind === 'argument' || row?.kind === 'contingent' ? 'argument' : 'ordinary';
}

function indexOf(ref: unknown, resolve: Resolve): number | undefined {
  if (!isRecord(ref)) return undefined;
  const address = callAddressOf(ref);
  if (address === undefined) return undefined;
  const call = resolve(address.id, address.name, address.occurrenceKey);
  return call.kind === 'matched' ? call.call.index : undefined;
}

/** One projection of the committed record for the public standing and its counts. */
export function standingAdmission(
  state: Row,
  history: readonly HistoryCall[],
  current: readonly HistoryCall[],
  argumentsOfTurn: readonly ArgumentRowRead[],
  declarationAddresses?: ReadonlyMap<number, number>,
  historyBytes: readonly unknown[] = [],
  legacyEvents?: unknown,
) {
  const resolve = historyCallResolver(current);
  const resolveAll = historyCallResolver(history);
  const dispositions = resultDispositions(history, state.middlewareDecisions);
  const argumentByIndex = new Map(argumentsOfTurn.map((row) => [row.index, row]));
  const entryEvidence = entryEvidenceOf(state[ENTRY_EVIDENCE_KEY]);
  let legacyEntered: ReadonlySet<string> | undefined;
  const calls = new Map(
    history.map(({ index, message, occurrenceKey }) => [
      index,
      {
        execution: recordedToolExecution(message),
        occurrenceKey,
        disposition: dispositions.get(index),
      },
    ]),
  );
  const entered = (index: number | undefined, occurrenceKey?: string | null): boolean => {
    const call = index === undefined ? undefined : calls.get(index);
    const key = occurrenceKey ?? call?.occurrenceKey;
    if (occurrenceKey === null || key === null) return false;
    if (typeof key !== 'string') return callEntered(call?.execution);
    if (entryEvidence !== undefined) return entryEvidence.keys.has(key);
    if (resolveAll(undefined, undefined, key).kind === 'ambiguous') return false;
    if (callEntered(call?.execution)) return true;
    return (legacyEntered ??= legacyEntryKeys(legacyEvents, historyBytes)).has(key);
  };
  const returned = (index: number | undefined, native = false): boolean => {
    const call = index === undefined ? undefined : calls.get(index);
    return (
      call?.execution === 'returned' &&
      (call.occurrenceKey === undefined ||
        (typeof call.occurrenceKey === 'string' &&
          resolveAll(undefined, undefined, call.occurrenceKey).kind === 'matched')) &&
      call.disposition !== 'withheld' &&
      (!native || call.disposition !== 'rewritten')
    );
  };

  const nativeResult = (row: Row, address?: number): boolean => {
    if (address !== undefined) return returned(address, true);
    if (row.kind !== 'period' || row.nativePeriodServed !== true) return false;
    const key = readCallOccurrenceKey(row);
    // The period writer attested that this occurrence's native result was
    // served. Keep that fact after the owning result leaves history.
    return (
      typeof key === 'string' &&
      resolve(undefined, undefined, key).kind === 'missing' &&
      entered(undefined, key)
    );
  };

  const admit = (reason: AssessmentReason, pointer: AssessmentPointer): boolean => {
    const row = rowOf(state, pointer);
    const kind = reasonClassOf(reason, witnessKind(row));
    if (kind === 'turn' || kind === 'settlement') return true;
    if (pointer.kind === 'history') {
      return kind === 'input' ? entered(pointer.index) : returned(pointer.index);
    }
    if (pointer.kind !== 'state' || row === undefined) return false;
    if (row.kind === 'conflict') {
      const refs = rowList(row.witnesses);
      return (
        refs !== undefined &&
        refs.unread === 0 &&
        refs.entries.length > 0 &&
        refs.entries.every((ref) => returned(indexOf(ref, resolveAll)))
      );
    }
    const index = Number(pointer.path.split('/')[1]);
    const argument = pointer.key === 'findingsLedger' ? argumentByIndex.get(index) : undefined;
    if (argument !== undefined) {
      return kind === 'input'
        ? entered(argument.historyIndex, argument.occurrenceKey)
        : returned(argument.historyIndex, true);
    }
    const occurrence =
      row.kind === 'argument'
        ? undefined
        : row.kind === 'contingent'
        ? indexOf(row.declaredOn, resolve)
        : pointer.key === 'coverageDeclared'
        ? indexOf(row, resolve) ??
          (readCallOccurrenceKey(row) === undefined ? declarationAddresses?.get(index) : undefined)
        : indexOf(row, resolve);
    const key = readCallOccurrenceKey(
      row.kind === 'contingent' && isRecord(row.declaredOn) ? row.declaredOn : row,
    );
    return kind === 'input' ? entered(occurrence, key) : nativeResult(row, occurrence);
  };
  // A rule can reject an error notice, even when there is no returned result.
  // Such notices leave their recorded settlement and make no withheld-result claim.
  for (const [index, call] of calls) {
    if (call.execution === 'not-entered' || call.execution === 'threw') {
      dispositions.delete(index);
    }
  }
  return {
    admit,
    dispositions,
    entered,
    returned,
    threw: (index: number) => calls.get(index)?.execution === 'threw',
    nativeResult,
    entryIncomplete: entryEvidence?.complete === false,
    hasEntryEvidence: entryEvidence !== undefined,
  };
}
