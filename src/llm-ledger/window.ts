/**
 * llm-ledger/window — the ledger's one instant validator, and the window built on it.
 *
 * Pattern: a validator, not a second grammar. It accepts a strict SUBSET of
 *          what `time/instant.ts` · `instantOf` accepts in its `strict`
 *          profile, and gives the same epoch milliseconds for every string it
 *          accepts — pinned by `test/llm-ledger/window-differential.test.ts`.
 *          The parser is generated from the time layer so this folder can stay a closed leaf.
 *          This wrapper keeps the stored window and entry format narrower than that parser.
 * Role:    the closed leaf's time check: a receipt's and a note's `window`,
 *          and every entry's `at`.
 * Emits:   N/A.
 *
 * ## The grammar
 *
 * `YYYY-MM-DDTHH:MM:SS[.f]` then `Z` or `±HH:MM`:
 *
 *   - upper-case `T` and `Z` only;
 *   - seconds required, 0–59 (no leap second);
 *   - a fraction of 1–3 digits (millisecond precision), or none;
 *   - a day that exists in its month; hours 0–23; an offset of at most ±23:59.
 *
 * Anything else is refused. A window is `{ from, to }`, half-open, with
 * `from` strictly before `to`; the strings are kept as written.
 */
import type { LedgerWindow } from './types.js';
import { instantOf } from './instantParser.js';

/** The stored window and entry grammar requires explicit seconds and at most milliseconds. */
export function instantMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || /\.\d{4}/.test(value)) return undefined;
  const instant = instantOf(value, 'strict');
  return instant?.precision === 'minute' ? undefined : instant?.ms;
}

/** Whether `value` is an instant in UTC (`Z`): what every entry's `at` must be. */
export function isUtcInstant(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith('Z') && instantMs(value) !== undefined;
}

/**
 * The window `value` names, as a fresh frozen `{ from, to }`, or `undefined`
 * (the refusal `bad-window`) when it is not exactly those two keys, both
 * instants, with `from` before `to`.
 */
export function readWindow(value: unknown): LedgerWindow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('from') || !keys.includes('to')) return undefined;
  // Read through descriptors, so a getter is never called: an accessor has no `value`, and
  // `undefined` is not an instant, so an accessor end is refused like any other non-instant.
  const fromField = Object.getOwnPropertyDescriptor(value, 'from');
  const toField = Object.getOwnPropertyDescriptor(value, 'to');
  const from = instantMs(fromField?.value);
  const to = instantMs(toField?.value);
  if (from === undefined || to === undefined || from >= to) return undefined;
  return Object.freeze({ from: fromField?.value as string, to: toField?.value as string });
}

export type TimeSpan = readonly [from: number, to: number];

interface CitedSpan {
  readonly span: TimeSpan;
  readonly seq: number;
}

/** Convert an admitted typed window to a half-open interval. */
export function spanOf(window: LedgerWindow): TimeSpan {
  return [instantMs(window.from) as number, instantMs(window.to) as number];
}

/** Missing ranges in order, with one deterministic receipt for each witnessed side. */
export function missingRanges(
  [from, to]: TimeSpan,
  cited: readonly CitedSpan[],
): readonly { readonly span: TimeSpan; readonly receipts: readonly number[] }[] {
  const gaps: { span: TimeSpan; receipts: number[] }[] = [];
  const ordered = cited
    .map(({ span: [a, b], seq }) => ({ start: Math.max(from, a), end: Math.min(to, b), seq }))
    .filter(({ start, end }) => start < end)
    .sort((a, b) => a.start - b.start || a.seq - b.seq);
  let reach = from;
  let left: number | undefined;
  for (const { start, end, seq } of ordered) {
    if (start > reach)
      gaps.push({ span: [reach, start], receipts: left === undefined ? [seq] : [left, seq] });
    if (end > reach || (end === reach && left !== undefined && seq < left)) {
      reach = end;
      left = seq;
    }
  }
  if (reach < to) gaps.push({ span: [reach, to], receipts: left === undefined ? [] : [left] });
  return gaps;
}
