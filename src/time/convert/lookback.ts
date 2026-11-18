import type { ConvertContext, WindowToConvert } from '../convert.js';
import { AXIS_UNITS, durationMs, LOOKBACK_UNITS, spellDuration } from '../duration.js';
import type { PeriodForm } from '../periodForm.js';
import { msOf } from './instants.js';

function lookbackInto(
  window: WindowToConvert,
  form: Extract<PeriodForm, { kind: 'lookback' }>,
  ctx: ConvertContext,
): { readonly value: string; readonly rounded: boolean } | undefined {
  const units = form.units ?? LOOKBACK_UNITS;
  const sign = form.signed ? '-' : '';
  if (window.lookback !== undefined) {
    const ms = durationMs(window.lookback, AXIS_UNITS);
    const spelled = ms === undefined ? undefined : spellDuration(ms, units);
    return spelled === undefined ? undefined : { value: `${sign}${spelled}`, rounded: false };
  }
  // A range ending at now (within the tool's step): the smallest spelling that covers `from`.
  const now = msOf(ctx.now);
  const from = msOf(window.range.from);
  const to = msOf(window.range.to);
  if (now === undefined || from === undefined || to === undefined) return undefined;
  if (Math.abs(to.ms - now.ms) > ctx.granularityMs) return undefined;
  const need = now.ms - from.ms;
  if (need <= 0) return undefined;
  const finest = finestUnitMs(units);
  const length = Math.ceil(need / finest) * finest;
  const spelled = spellDuration(length, units);
  // Rounded when the length grew, or the end moved to now (a look-back ends at now, both ends inside).
  const endMoved = to.ms !== now.ms && to.ms !== now.ms + 1;
  return spelled === undefined
    ? undefined
    : { value: `${sign}${spelled}`, rounded: length !== need || endMoved };
}

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function finestUnitMs(units: string): number {
  return Math.min(...[...units].map((u) => UNIT_MS[u] as number));
}

export { lookbackInto, finestUnitMs };
