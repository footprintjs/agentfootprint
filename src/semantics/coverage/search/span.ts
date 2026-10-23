/**
 * search/span — the instants a period facet stands for.
 *
 * Pattern: one pure rule over the time layer's own conversions.
 * Role:    semantics/ layer, pure. No clock is read: the DISPATCH instant —
 *          when the call actually ran, the clock the time layer hands the
 *          tool — is injected, so a call resumed hours after its pause
 *          composes the span it ran with, never the turn's start. The row
 *          keeps the spelling (`'2h'`) beside the span; a checker keys a
 *          relative window by its spelling within a run leg.
 * Emits:   N/A.
 *
 * Two sources, both as half-open `[from, to)` ranges:
 *   • a look-back the tool's `period` declares for that argument, sent or
 *     defaulted, resolved at the dispatch instant (`time/range.ts` ·
 *     `lookbackRange`);
 *   • the result's own declared `period.queried` (inclusive bounds, made
 *     half-open by one millisecond — `time/range.ts` · `fromInclusive`).
 *
 * Anything else composes no span — an absolute spelling the tool does not
 * declare as a look-back, a missing clock — and a checker keys that reading
 * by its value instead. Never a guess.
 */

import { isDuration, LOOKBACK_UNITS } from '../../../time/duration.js';
import { sugarForms, type PeriodShapes } from '../../../time/periodForm.js';
import { fromInclusive, lookbackRange } from '../../../time/range.js';
import type { ComposedSpan } from '../composedCoverage.js';
import type { DeclaredPeriod } from '../period.js';

/**
 * The span a relative window resolves to at the dispatch instant, or `undefined`
 * when the tool's `period` declares no look-back for `argument` or the value
 * is not one.
 */
export function relativeSpan(
  argument: string,
  value: unknown,
  period: PeriodShapes | undefined,
  dispatchedAt: string | undefined,
): ComposedSpan | undefined {
  if (period === undefined || dispatchedAt === undefined || typeof value !== 'string') {
    return undefined;
  }
  const form = sugarForms(period).find((f) => f.kind === 'lookback' && f.argument === argument);
  if (form === undefined || form.kind !== 'lookback') return undefined;
  const spelled = form.signed && value.startsWith('-') ? value.slice(1) : value;
  const units = form.units ?? LOOKBACK_UNITS;
  if (!isDuration(spelled, units)) return undefined;
  try {
    const range = lookbackRange(dispatchedAt, spelled, units);
    return { from: range.from, to: range.to };
  } catch {
    return undefined;
  }
}

/** The result's declared `queried`, half-open, or `undefined` when it cannot be read. */
export function resultSpan(period: DeclaredPeriod): ComposedSpan | undefined {
  try {
    const range = fromInclusive({ from: period.queried.from, to: period.queried.to });
    return { from: range.from, to: range.to };
  } catch {
    return undefined;
  }
}
