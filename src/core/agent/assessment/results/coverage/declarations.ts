import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import { declaredByValue } from '../../../emptiness.js';
import type { CoverageRow } from '../../coverageRows.js';
import type { TurnResult } from '../../turnResults.js';

type Row = Readonly<Record<string, unknown>>;

/** Reuse existing positive delivery proof; never infer it from a missing history message. */
export function declaredResultAdmitted(
  row: Row,
  address: number | undefined,
  proof: {
    readonly native: (row: Row, address?: number) => boolean;
    readonly returned: (address: number | undefined, key: string | null | undefined) => boolean;
  },
): boolean {
  return (
    proof.native(row, address) ||
    ((row.kind === 'ledger' || row.kind === 'absence' || row.kind === 'period') &&
      proof.returned(address, readCallOccurrenceKey(row)))
  );
}

/** A native declaration cannot classify the replacement's bytes or erase its own declaration. */
export function deliveredDeclarationDoor<T>(rewritten: boolean, nativeDoor: T): T | undefined {
  return rewritten ? undefined : nativeDoor;
}

export function declarationsForResult(result: TurnResult, nativeRows: readonly CoverageRow[]) {
  const rows = deliveredDeclarationDoor(result.rewritten === true, nativeRows) ?? [];
  const own = rows.length === 0 ? declaredByValue(result.content) : undefined;
  return {
    rows,
    declared: nativeRows.length > 0 || own !== undefined,
    ...(own !== undefined && { own }),
  };
}

/** The rewrite is another witness; a native settlement merely repeats its native declaration. */
export function hasOwnDeclarationWitness(
  delivery: string | undefined,
  nativeHasReason: boolean,
): boolean {
  return delivery === 'rewritten' || !nativeHasReason;
}
