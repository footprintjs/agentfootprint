import { readBack, supportsFrozenLookback, type PeriodFacts } from './convert.js';
import { formCapMs, sourceClockLookback } from './convert/covering.js';
import type { InstantText } from './instant.js';
import { formArguments, type PeriodForm } from './periodForm.js';
import { sameRange } from './range.js';
import type { CallWindowRow } from './rows.js';
import type { ZoneName } from './zone.js';

/** Check the same witnessed absolute range after tool middleware. */
export function frozenLookbackDispatchMatches(
  window: CallWindowRow,
  args: Readonly<Record<string, unknown>>,
  forms: readonly PeriodForm[],
  now: InstantText,
  appZone: ZoneName | undefined,
): boolean {
  const selected = window.form === undefined ? undefined : forms[window.form];
  const expected = window.sent ?? window.asked;
  if (selected === undefined || expected === undefined || !supportsFrozenLookback(selected))
    return false;
  const keys = formArguments(selected);
  if (keys.some(({ role, argument }) => role !== 'zone' && !Object.hasOwn(args, argument)))
    return false;
  const context = { now, precise: true as const, ...(appZone !== undefined && { appZone }) };
  const final = readBack(args, selected, context);
  if (final === undefined || !sameRange(final, expected)) return false;
  const selectedKeys = new Set(keys.map(({ argument }) => argument));
  return forms.every((form, index) => {
    if (index === window.form) return true;
    if (formArguments(form).some(({ argument }) => !selectedKeys.has(argument) && argument in args))
      return false;
    const competing = readBack(args, form, context);
    return (
      competing === undefined || (supportsFrozenLookback(form) && sameRange(competing, expected))
    );
  });
}

/**
 * Check, after tool middleware, that a call filled with a look-back the
 * library lengthens at dispatch (`coversAtDispatch`) still holds THAT
 * look-back and no other period argument: the library replaces only its own
 * fill, never a value a middleware wrote.
 */
export function coveringDispatchMatches(
  window: CallWindowRow,
  args: Readonly<Record<string, unknown>>,
  forms: readonly PeriodForm[],
  now: InstantText,
  facts?: PeriodFacts,
): boolean {
  const selected = window.form === undefined ? undefined : forms[window.form];
  if (selected?.kind !== 'lookback' || window.asked === undefined) return false;
  const filled = sourceClockLookback(window.asked, selected, now, formCapMs(selected, facts));
  if (filled === undefined || !Object.hasOwn(args, selected.argument)) return false;
  const expected = readBack(filled.values, selected, { now });
  const final = readBack(args, selected, { now });
  if (expected === undefined || final === undefined || !sameRange(final, expected)) return false;
  return forms.every(
    (form, index) =>
      index === window.form ||
      formArguments(form).every(
        ({ argument }) => argument === selected.argument || !(argument in args),
      ),
  );
}
