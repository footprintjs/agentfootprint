/**
 * core/time/drift — the clock at dispatch (time design § 7.4, step T5b).
 *
 * Pattern: one pure decision per dispatched call. The turn's clock is frozen
 *          at the message (§ 4); a LOOK-BACK is evaluated by the tool, against
 *          its own clock, when it is handed the call. After a pause (or with
 *          an app `now` far from the wall clock) the two differ by
 *          `drift = dispatchedAt − now`. Within the tool's step nothing
 *          changes; past it, the library re-sends its OWN look-back fill as
 *          the asked range in the tool's first absolute form that holds it
 *          exactly, and records a look-back it cannot re-send — the model's
 *          own (never written over, § 7.3), or a tool with no absolute form —
 *          as shifted.
 * Role:    core/ leaf (the time layer). Imports `convert.ts` and `range.ts`
 *          types only. Asked by ToolCalls (`stages/toolCalls.ts` ·
 *          `timeAtDispatch`) at both execute sites, just before the tool
 *          runs; the answer rides the `call` row (`rows.ts` · `CallDrift`).
 * Emits:   N/A.
 *
 * | Drift | The call sent | Tool has an absolute form | Sent | Recorded |
 * |-------|---------------|---------------------------|------|----------|
 * | ≤ the tool's step (one minute when none) | — | — | as it was | nothing |
 * | larger | the library's look-back fill | yes | the asked range in that form | `drift: { outcome: 'redrawn', form }` |
 * | larger | the library's look-back fill | no | the look-back | `drift: { outcome: 'shifted' }` |
 * | larger | the model's look-back | — | the look-back, as sent | `drift: { outcome: 'shifted' }` |
 *
 * @example
 * ```ts
 * driftAtDispatch(
 *   { how: 'filled', form: 0, asked: { from: '2026-10-09T14:40:00Z', to: '2026-10-09T15:40:00.001Z' } },
 *   [{ kind: 'lookback', argument: 'window', signed: false },
 *    { kind: 'bounds', from: { argument: 'start', as: 'epoch-ms' },
 *      to: { argument: 'end', as: 'epoch-ms', edge: 'exclusive' } }],
 *   { now: '2026-10-09T15:40:00Z', dispatchedAt: '2026-10-09T16:10:00.000Z', granularityMs: 60_000 },
 * );
 * // { byMs: 1_800_000, outcome: 'redrawn', form: 1,
 * //   values: { start: 1791556800000, end: 1791560400001 } }
 * ```
 */

import { convertExact, type PeriodForm } from './convert.js';
import { instantOf, type InstantText } from './instant.js';
import type { TimeRange } from './range.js';
import type { ZoneName } from './zone.js';

/** What a call's `call-window` row says about its window — the fields the decision reads. */
export interface DispatchedWindow {
  readonly how: string;
  readonly form?: number;
  readonly asked?: TimeRange;
}

/** The clocks and the tool's step. */
export interface DispatchClock {
  /** The turn's frozen clock. */
  readonly now: InstantText;
  /** The wall clock at dispatch — the `call` row's. */
  readonly dispatchedAt: InstantText;
  /** The tool's `granularity` in milliseconds, else one minute. */
  readonly granularityMs: number;
  /** The clock's zone — a wall or date form's zone argument is sent in it. */
  readonly zone?: ZoneName;
  /** The app's `.time({ zone })`, for a form that declares `wallZone: 'app'`. */
  readonly appZone?: ZoneName;
}

/** The decision: nothing, a redraw (with the values to send), or a shift. */
export type DispatchDrift =
  | {
      readonly byMs: number;
      readonly outcome: 'redrawn';
      readonly form: number;
      readonly values: Readonly<Record<string, unknown>>;
    }
  | { readonly byMs: number; readonly outcome: 'shifted' };

/**
 * The drift decision for one dispatched call (the module table), or
 * `undefined` when the call sent no look-back or the drift is within the
 * tool's step. Pure.
 */
export function driftAtDispatch(
  window: DispatchedWindow | undefined,
  forms: readonly PeriodForm[],
  clock: DispatchClock,
): DispatchDrift | undefined {
  if (window === undefined || window.form === undefined) return undefined;
  if (forms[window.form]?.kind !== 'lookback') return undefined;
  const sentLookback =
    window.how === 'filled' ||
    window.how === 'bound' ||
    window.how === 'model-chosen' ||
    window.how === 'model';
  if (!sentLookback) return undefined;
  const now = instantOf(clock.now, 'strict');
  const at = instantOf(clock.dispatchedAt, 'strict');
  if (now === undefined || at === undefined) return undefined;
  const byMs = at.ms - now.ms;
  if (Math.abs(byMs) <= clock.granularityMs) return undefined;
  // Only the library's own fill is re-sent; the model's value is never written over (§ 7.3).
  if (window.how === 'filled' && window.asked !== undefined && clock.zone !== undefined) {
    const absolute = forms.map((f, i) => ({ f, i })).filter(({ f }) => f.kind !== 'lookback');
    const conversion = convertExact(
      { range: window.asked },
      absolute.map(({ f }) => f),
      {
        now: clock.now,
        zone: clock.zone,
        ...(clock.appZone !== undefined && { appZone: clock.appZone }),
        granularityMs: clock.granularityMs,
      },
    );
    if (conversion !== undefined) {
      return {
        byMs,
        outcome: 'redrawn',
        form: (absolute[conversion.form] as { i: number }).i,
        values: conversion.values,
      };
    }
  }
  return { byMs, outcome: 'shifted' };
}
