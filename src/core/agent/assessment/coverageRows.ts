import { isRecord } from './recordValues.js';

/** One coverage row the run committed, as the fold reads it. */
export interface CoverageRow {
  readonly index: number;
  readonly kind: 'absence' | 'ledger';
  readonly historyIndex?: number;
  readonly gap: boolean;
}

const listed = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

export function coverageRows(
  rows: unknown,
  resolve: (row: Readonly<Record<string, unknown>>) => number | undefined,
  addresses?: ReadonlyMap<number, number>,
  nativeFacts?: (row: Readonly<Record<string, unknown>>, address?: number) => boolean,
): readonly CoverageRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown, index) => {
    if (!isRecord(row) || (row.kind !== 'absence' && row.kind !== 'ledger')) return [];
    const historyIndex = resolve(row) ?? addresses?.get(index);
    if (nativeFacts?.(row, historyIndex) === false) return [];
    return [
      {
        index,
        kind: row.kind,
        ...(historyIndex !== undefined && { historyIndex }),
        gap: listed(row.notChecked) || listed(row.cannotCover),
      },
    ];
  });
}
