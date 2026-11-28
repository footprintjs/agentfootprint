import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';

interface NativeCallWitness {
  readonly occurrenceKey: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
}

function own(row: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

/** Corroborating metadata for a start already selected by its occurrence key. */
export function readNativeCallWitness(
  start: Readonly<Record<string, unknown>>,
  iteration: unknown,
): NativeCallWitness | undefined {
  const occurrenceKey = readCallOccurrenceKey(start);
  const toolCallId = own(start, 'toolCallId');
  const toolName = own(start, 'toolName');
  const statedIteration = own(start, 'iteration');
  if (
    typeof occurrenceKey !== 'string' ||
    typeof toolCallId !== 'string' ||
    typeof toolName !== 'string' ||
    typeof iteration !== 'number' ||
    (statedIteration !== undefined && statedIteration !== iteration)
  )
    return undefined;
  return { occurrenceKey, toolCallId, toolName, iteration };
}

/** Check a row selected by its occurrence. The provider ID corroborates the
 * row's identity and cannot select a row, even when it is distinct. */
export function corroboratesNativeCall(
  witness: NativeCallWitness,
  row: Readonly<Record<string, unknown>>,
  source: 'terminal' | 'decision' | 'declaration' | 'history',
): boolean {
  const name = own(row, 'toolName');
  const iteration = own(row, 'iteration');
  return (
    readCallOccurrenceKey(row) === witness.occurrenceKey &&
    own(row, 'toolCallId') === witness.toolCallId &&
    (name === witness.toolName || (source === 'terminal' && name === undefined)) &&
    (source === 'history' ||
      iteration === witness.iteration ||
      (source === 'terminal' && iteration === undefined))
  );
}
