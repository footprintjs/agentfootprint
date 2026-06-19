/**
 * compareFinders — run several finders on the same case and collect their answers
 * side by side (a leaderboard row per finder). PARAMETRIC: you pass the finders to
 * compare, so nothing is auto-discovered or retained — unused finders stay
 * tree-shakeable.
 */
import type { Finder, FindInput, FindResult } from './types.js';

/** One finder's result in a comparison (or the error it threw). */
export interface CompareRow {
  readonly finder: string;
  readonly result: FindResult | null;
  readonly error?: string;
}

/**
 * Run each finder on `input`; a finder that throws (e.g. missing a dep it needs)
 * becomes a row with `result: null` and `error` set, so one finder cannot abort
 * the comparison.
 */
export async function compareFinders(
  finders: readonly Finder[],
  input: FindInput,
): Promise<CompareRow[]> {
  const rows: CompareRow[] = [];
  for (const f of finders) {
    try {
      rows.push({ finder: f.name, result: await f.find(input) });
    } catch (e) {
      rows.push({ finder: f.name, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return rows;
}
