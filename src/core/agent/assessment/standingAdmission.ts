import {
  callEntered,
  historyCallResolver,
  recordedToolExecution,
  resultDispositions,
  type HistoryCall,
} from '../recordedCalls.js';
import type { ArgumentRowRead } from './argumentRows.js';
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
  const call = resolve(address.id, address.name);
  return call.kind === 'matched' ? call.call.index : undefined;
}

/** One projection of the committed record for the public standing and its counts. */
export function standingAdmission(
  state: Row,
  history: readonly HistoryCall[],
  current: readonly HistoryCall[],
  argumentsOfTurn: readonly ArgumentRowRead[],
  declarationAddresses?: ReadonlyMap<number, number>,
) {
  const resolve = historyCallResolver(current);
  const resolveAll = historyCallResolver(history);
  const dispositions = resultDispositions(history, state.middlewareDecisions);
  const argumentIndices = new Map(argumentsOfTurn.map((row) => [row.index, row.historyIndex]));
  const calls = new Map(
    history.map(({ index, message }) => [
      index,
      {
        execution: recordedToolExecution(message),
        disposition: dispositions.get(index),
      },
    ]),
  );
  const entered = (index: number | undefined): boolean =>
    index !== undefined && callEntered(calls.get(index)?.execution);
  const returned = (index: number | undefined, native = false): boolean => {
    const call = index === undefined ? undefined : calls.get(index);
    return (
      call?.execution === 'returned' &&
      call.disposition !== 'withheld' &&
      (!native || call.disposition !== 'rewritten')
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
    const occurrence =
      row.kind === 'argument' || (pointer.key === 'findingsLedger' && argumentIndices.has(index))
        ? argumentIndices.get(index)
        : row.kind === 'contingent'
        ? indexOf(row.declaredOn, resolve)
        : pointer.key === 'coverageDeclared'
        ? declarationAddresses?.get(index) ?? indexOf(row, resolve)
        : indexOf(row, resolve);
    return kind === 'input' ? entered(occurrence) : returned(occurrence, true);
  };
  // A rule can reject an error notice, even when there is no returned result.
  // Such notices leave their recorded settlement and make no withheld-result claim.
  for (const [index, call] of calls) {
    if (call.execution === 'not-entered' || call.execution === 'threw') {
      dispositions.delete(index);
    }
  }
  return { admit, dispositions, entered, returned };
}
