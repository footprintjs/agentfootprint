/**
 * time/drift — the clock at dispatch (time design § 7.4, step T5b).
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
 * Role:    L0 leaf (the time layer). Imports `convert.ts` and `range.ts`
 *          types only. Asked by ToolCalls (`stages/timeLayer.ts` ·
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
 * | larger | the model's look-back BESIDE a confirmed window (`model-chosen`) | yes, and its `maxRange` holds the interval | the interval it named on the frozen clock, in that form | `drift: { outcome: 'redrawn', form }` |
 * | any | a CONFIRMED look-back in a length-only form (`coversAtDispatch`) | — | the smallest length that still reaches the window's start from dispatch | `drift: { outcome: 'covered', form, sent }` |
 *
 * The last row is the widening law at dispatch ({@link coverAtDispatch}): a
 * confirmed window is never read shorter because a click took time. It is
 * decided on every such call, whatever the drift, and refuses a window still
 * running at dispatch or a length past the form's `maxRange`.
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

import { convertExact, type PeriodFacts, type PeriodForm } from './convert.js';
import { coveringLookback, formCapMs, type Uncoverable } from './convert/covering.js';
import { instantOf, type InstantText } from './instant.js';
import type { TimeRange } from './range.js';
import type { ZoneName } from './zone.js';

/** What a call's `call-window` row says about its window — the fields the decision reads. */
export interface DispatchedWindow {
  readonly how: string;
  readonly form?: number;
  readonly asked?: TimeRange;
  readonly coversAtDispatch?: true;
  /**
   * The turn holds a CONFIRMED window (the row's `person` carries an endpoint): a look-back the
   * model wrote names an interval on the frozen clock, so it is re-sent as those bounds too.
   */
  readonly confirmedTurn?: true;
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

/** A confirmed look-back's covering value at dispatch, or why none exists. */
export type DispatchCover =
  | {
      readonly byMs: number;
      readonly outcome: 'covered';
      readonly form: number;
      readonly values: Readonly<Record<string, unknown>>;
      readonly sent: TimeRange;
    }
  | { readonly outcome: 'uncoverable'; readonly why: Uncoverable };

/**
 * The covering look-back for one dispatched call whose `call-window` row says
 * `coversAtDispatch` (`convert/covering.ts` · `coveringLookback`, measured
 * from `clock.dispatchedAt`, held to the form's own `maxRange`), or
 * `undefined` when the row says no such thing. Pure.
 */
export function coverAtDispatch(
  window: DispatchedWindow | undefined,
  forms: readonly PeriodForm[],
  clock: Pick<DispatchClock, 'now' | 'dispatchedAt'>,
  facts?: PeriodFacts,
): DispatchCover | undefined {
  if (window?.coversAtDispatch !== true || window.how !== 'filled') return undefined;
  const form = window.form === undefined ? undefined : forms[window.form];
  const now = instantOf(clock.now, 'strict');
  const at = instantOf(clock.dispatchedAt, 'strict');
  if (form?.kind !== 'lookback' || window.asked === undefined) {
    return { outcome: 'uncoverable', why: 'still-running' };
  }
  if (now === undefined || at === undefined)
    return { outcome: 'uncoverable', why: 'still-running' };
  const cover = coveringLookback(window.asked, form, clock.dispatchedAt, formCapMs(form, facts));
  if ('uncoverable' in cover) return { outcome: 'uncoverable', why: cover.uncoverable };
  return {
    byMs: at.ms - now.ms,
    outcome: 'covered',
    form: window.form as number,
    values: cover.values,
    sent: cover.sent,
  };
}

/**
 * Whether the call SENT a look-back: its `call-window` row names a form, that
 * form is a `lookback`, and the call dispatched with a window in it (filled,
 * bound, or the model's). The one reading of it — the drift decision here and
 * the result checks' step allowance (`check.ts` · `differsOf`) both ask it.
 */
export function sentLookback(
  window: Pick<DispatchedWindow, 'how' | 'form'>,
  forms: readonly PeriodForm[],
): boolean {
  if (window.form === undefined || forms[window.form]?.kind !== 'lookback') return false;
  return (
    window.how === 'filled' ||
    window.how === 'bound' ||
    window.how === 'model-chosen' ||
    window.how === 'model'
  );
}

/**
 * The drift decision for one dispatched call (the module table), or
 * `undefined` when the call sent no look-back or the drift is within the
 * tool's step. Pure.
 */
export function driftAtDispatch(
  window: DispatchedWindow | undefined,
  forms: readonly PeriodForm[],
  clock: DispatchClock,
  facts?: PeriodFacts,
): DispatchDrift | undefined {
  if (window === undefined || !sentLookback(window, forms)) return undefined;
  // A covering look-back has its own decision ({@link coverAtDispatch}); it is never shifted.
  if (window.coversAtDispatch === true) return undefined;
  const now = instantOf(clock.now, 'strict');
  const at = instantOf(clock.dispatchedAt, 'strict');
  if (now === undefined || at === undefined) return undefined;
  const byMs = at.ms - now.ms;
  // Beside a confirmed window the model's own look-back is an interval on the frozen clock: past
  // the tool's step it keeps that interval. The spelling changes, never the window.
  const modelInterval = window.how === 'model-chosen' && window.confirmedTurn === true;
  if (Math.abs(byMs) <= clock.granularityMs) return undefined;
  // Otherwise only the library's own fill is re-sent; the model's value runs as sent (§ 7.3).
  if (
    (window.how === 'filled' || modelInterval) &&
    window.asked !== undefined &&
    clock.zone !== undefined
  ) {
    // A form whose own `maxRange` is shorter than the asked range cannot hold it: never redrawn
    // into (the look-back then runs as sent, `shifted`).
    const asked = window.asked;
    const from = instantOf(asked.from, 'strict');
    const to = instantOf(asked.to, 'strict');
    const lengthMs = from === undefined || to === undefined ? undefined : to.ms - from.ms;
    const absolute = forms
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => {
        if (f.kind === 'lookback') return false;
        const cap = formCapMs(f, facts);
        return cap === undefined || (lengthMs !== undefined && lengthMs <= cap + 1);
      });
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
