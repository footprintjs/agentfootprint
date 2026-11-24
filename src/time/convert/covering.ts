/**
 * time/convert/covering — a confirmed look-back for a source that takes only
 * a LENGTH of time (the widening law applied to a frozen look-back).
 *
 * Pattern: two pure steps over one rule. A confirmed look-back is a closed
 *          range `[now − L, now)` on the run's frozen clock. A form that
 *          takes only a length is read by the SOURCE against its own clock,
 *          at dispatch, so the same length sent later reads a later window
 *          and loses the oldest part of what the person confirmed. The
 *          library therefore sends a length that still reaches the window's
 *          start FROM THE DISPATCH MOMENT: read more, never less, and say so.
 * Role:    L0 leaf (the time layer). {@link sourceClockLookback} is asked by
 *          `convert.ts` · `convertForTool` before the call (the value the
 *          call holds until it is handed over); {@link coveringLookback} by
 *          `drift.ts` · `coverAtDispatch` at the dispatch moment.
 * Emits:   N/A.
 *
 * | Step | Clock | Sends | Says |
 * |------|-------|-------|------|
 * | before the call | the frozen `now` | the window's own length, rounded up to the form's finest unit | `coversAtDispatch` |
 * | at dispatch | the dispatch moment | the smallest length in the form's units that reaches the window's start | `sent`, and what it adds |
 *
 * A window still running at dispatch has no covering look-back (a look-back
 * ends at the source's now), and a length past the form's `maxRange` is one
 * the tool will not read: both are refused, never shortened.
 *
 * @example
 * ```ts
 * const form = { kind: 'lookback', argument: 'window', signed: false, units: 'm' } as const;
 * const asked = { from: '2026-11-13T18:00:00Z', to: '2026-11-13T20:00:00Z' };
 * sourceClockLookback(asked, form);                          // { values: { window: '120m' }, rounded: false }
 * coveringLookback(asked, form, '2026-11-13T20:01:01.000Z'); // { values: { window: '122m' }, sent: …, extra: [ … ] }
 * ```
 */

import { LOOKBACK_UNITS, spellDuration } from '../duration.js';
import { compareInstants, instantOf, type InstantText } from '../instant.js';
import type { PeriodForm } from '../periodForm.js';
import { lookbackRange, type TimeRange } from '../range.js';
import { finestUnitMs } from './lookback.js';
import { extraOfPrecise } from './widen.js';

type LookbackForm = Extract<PeriodForm, { kind: 'lookback' }>;

/** Why no look-back can cover a window at dispatch. */
export type Uncoverable = 'still-running' | 'max-range';

/** The covering look-back at dispatch: the value to send, what the source reads with it, what it adds. */
export interface CoveringLookback {
  readonly values: Readonly<Record<string, unknown>>;
  /** `[dispatch − length, dispatch]`, both ends inside — what the source's clock reads if it agrees with ours. */
  readonly sent: TimeRange;
  /** The parts of `sent` the window did not ask for, in time order. */
  readonly extra: readonly TimeRange[];
}

/** The smallest length in the form's units that reaches at least `needMs` back. */
function reachIn(
  form: LookbackForm,
  needMs: number,
): { readonly spelled: string; readonly lengthMs: number } | undefined {
  const units = form.units ?? LOOKBACK_UNITS;
  const finest = finestUnitMs(units);
  const lengthMs = Math.max(finest, Math.ceil(needMs / finest) * finest);
  const spelled = spellDuration(lengthMs, units);
  return spelled === undefined ? undefined : { spelled, lengthMs };
}

const valueOf = (form: LookbackForm, spelled: string): Readonly<Record<string, unknown>> => ({
  [form.argument]: `${form.signed ? '-' : ''}${spelled}`,
});

/**
 * The value a frozen look-back holds in a length-only form BEFORE dispatch:
 * the window's own length on the frozen clock, rounded up to the form's
 * finest unit. `undefined` when the range is not a closed window or the
 * length is past `capMs` (the form's `maxRange`).
 */
export function sourceClockLookback(
  range: TimeRange,
  form: LookbackForm,
  capMs?: number,
): { readonly values: Readonly<Record<string, unknown>>; readonly rounded: boolean } | undefined {
  const from = instantOf(range.from, 'strict');
  const to = instantOf(range.to, 'strict');
  if (from === undefined || to === undefined || compareInstants(from, to) >= 0) return undefined;
  // Reach back from the first whole millisecond at or after the end to the start's millisecond.
  const needMs = to.ms + (to.nanos > 0 ? 1 : 0) - from.ms;
  const reach = reachIn(form, needMs);
  if (reach === undefined || (capMs !== undefined && reach.lengthMs > capMs)) return undefined;
  return { values: valueOf(form, reach.spelled), rounded: reach.lengthMs !== needMs };
}

/**
 * The look-back that covers `asked` when the source reads it at
 * `dispatchedAt`: the smallest length in the form's units that reaches the
 * window's start from that moment. The reason when none can: the window is
 * still running at dispatch, or the length is past `capMs`.
 */
export function coveringLookback(
  asked: TimeRange,
  form: LookbackForm,
  dispatchedAt: InstantText,
  capMs?: number,
): CoveringLookback | { readonly uncoverable: Uncoverable } {
  const from = instantOf(asked.from, 'strict');
  const to = instantOf(asked.to, 'strict');
  const at = instantOf(dispatchedAt, 'strict');
  if (from === undefined || to === undefined || at === undefined) {
    return { uncoverable: 'still-running' };
  }
  // An exclusive cutoff equal to the dispatch moment is closed; one after it is still running.
  if (compareInstants(from, to) >= 0 || compareInstants(to, at) > 0) {
    return { uncoverable: 'still-running' };
  }
  const reach = reachIn(form, at.ms - from.ms);
  if (reach === undefined) return { uncoverable: 'max-range' };
  if (capMs !== undefined && reach.lengthMs > capMs) return { uncoverable: 'max-range' };
  const sent = lookbackRange(dispatchedAt, reach.spelled, form.units ?? LOOKBACK_UNITS);
  const extra = extraOfPrecise(sent, asked);
  if (extra === undefined) return { uncoverable: 'still-running' };
  return { values: valueOf(form, reach.spelled), sent, extra };
}
