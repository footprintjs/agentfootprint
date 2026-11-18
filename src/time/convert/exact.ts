import type { ConvertContext, WindowToConvert } from '../convert.js';
import { needsZone, type PeriodForm } from '../periodForm.js';
import { wallAt, type ZoneName } from '../zone.js';
import { formZone, writeBound } from './bounds.js';
import { midnightOf, nextDay, spellDate } from './calendar.js';
import { absoluteOf } from './instants.js';
import { lookbackInto } from './lookback.js';

/** One form's exact values for a window, or `undefined` when the form does not hold it exactly. */
function convertOne(
  window: WindowToConvert,
  form: PeriodForm,
  ctx: ConvertContext,
): { readonly values: Record<string, unknown>; readonly rounded: boolean } | undefined {
  if (form.kind === 'lookback') {
    const sent = lookbackInto(window, form, ctx);
    return sent === undefined
      ? undefined
      : { values: { [form.argument]: sent.value }, rounded: sent.rounded };
  }
  const zone = formZone(form, ctx);
  if (needsZone(form) && zone === undefined) return undefined;
  const zoneValue: Record<string, unknown> =
    'zone' in form && form.zone !== undefined ? { [form.zone.argument]: ctx.zone } : {};
  const span = absoluteOf(window, ctx.now);
  if (span === undefined) return undefined;
  const [from, to] = span;
  if (form.kind === 'day') {
    const z = zone as ZoneName;
    const wall = wallAt(z, from.ms);
    const date = { year: wall.year, month: wall.month, day: wall.day };
    if (midnightOf(date, z) !== from.ms || midnightOf(nextDay(date), z) !== to.ms) return undefined;
    return { values: { [form.argument]: spellDate(date), ...zoneValue }, rounded: false };
  }
  const fromAs = form.kind === 'bounds' ? form.from.as : form.as;
  const toAs = form.kind === 'bounds' ? form.to.as : form.as;
  // `bounds` / `object` declare their edge (TQ18); only a `joined` form (the sugar's) defaults.
  const edge =
    form.kind === 'joined'
      ? form.edge ?? 'inclusive'
      : form.kind === 'bounds'
      ? form.to.edge
      : form.edge;
  const a = writeBound(from, 'from', fromAs, 'inclusive', zone);
  const b = writeBound(to, 'to', toAs, edge, zone);
  if (a === undefined || b === undefined) return undefined;
  const rounded = a.rounded || b.rounded;
  switch (form.kind) {
    case 'bounds':
      return {
        values: { [form.from.argument]: a.value, [form.to.argument]: b.value, ...zoneValue },
        rounded,
      };
    case 'joined':
      return {
        values: { [form.argument]: `${a.value}${form.joiner}${b.value}`, ...zoneValue },
        rounded,
      };
    case 'object':
      return {
        values: {
          [form.argument]: { [form.keys.from]: a.value, [form.keys.to]: b.value },
          ...zoneValue,
        },
        rounded,
      };
  }
}

export { convertOne };
