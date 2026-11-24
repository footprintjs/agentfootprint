import type { BindContext, CallToBind } from '../bind.js';
import { formReach, readBack, type Conversion } from '../convert.js';
import { readBound, readZone } from '../convert/bounds.js';
import { convertOne, supportsFrozenLookback } from '../convert/exact.js';
import { durationMs } from '../duration.js';
import { spellInstant } from '../instant.js';
import {
  FACT_UNITS,
  formArguments,
  formMaxRange,
  isPlain,
  periodFactProblem,
  type PeriodForm,
} from '../periodForm.js';
import { MAX_PERIOD_FORMS, untakenBesides } from '../periodSurface.js';
import { sameRange, type TimeRange } from '../range.js';
import { readControlWindow, windowEndpointOf } from '../windowEndpoint.js';
import { windowToConvert, type TurnWindow } from '../windows.js';

type Arguments = Readonly<Record<string, unknown>>;
type ReadContext = Pick<BindContext, 'now' | 'appZone'>;

export interface ExactComparisonArguments {
  readonly form: number;
  readonly values: Conversion['values'];
  readonly original?: TimeRange;
  /** The selected form is already exact and its competing keys are absent. */
  readonly same: boolean;
}

const atUtc = (ms: number | undefined) =>
  ms === undefined ? undefined : spellInstant({ ms, nanos: 0 }, 0);

/** A mixed form retains each bound's own ISO point or declared grid semantics. */
function readComparisonRange(
  args: Arguments,
  form: PeriodForm,
  ctx: ReadContext,
): TimeRange | undefined {
  if (formArguments(form).some(({ argument }) => !Object.hasOwn(args, argument))) return undefined;
  if (form.kind === 'object') {
    const value = args[form.argument];
    if (
      !isPlain(value) ||
      !Object.hasOwn(value, form.keys.from) ||
      !Object.hasOwn(value, form.keys.to)
    ) {
      return undefined;
    }
  }
  if (form.kind !== 'bounds' || (form.from.as === 'iso') === (form.to.as === 'iso')) {
    return readBack(args, form, { ...ctx, precise: true });
  }
  const zone = readZone(args, form, ctx);
  const lower = args[form.from.argument];
  const upper = args[form.to.argument];
  const from =
    form.from.as === 'iso'
      ? lower
      : atUtc(readBound(lower, 'from', form.from.as, 'inclusive', zone));
  const to =
    form.to.as === 'iso' ? upper : atUtc(readBound(upper, 'to', form.to.as, form.to.edge, zone));
  const read = readControlWindow({
    from,
    to,
    end: form.to.as === 'iso' ? form.to.edge : 'exclusive',
  });
  return read === undefined ? undefined : { from: read.from, to: read.to };
}

/** Read the proposed interval only if its declared period arguments have one meaning. */
function originalRange(
  args: Arguments,
  forms: readonly PeriodForm[],
  ctx: ReadContext,
): TimeRange | undefined {
  let original: TimeRange | undefined;
  const unread = new Set(
    forms
      .flatMap(formArguments)
      .map(({ argument }) => argument)
      .filter((argument) => Object.hasOwn(args, argument)),
  );
  for (const form of forms) {
    if (hasCompetingObjectKeys(args, form, forms)) continue;
    const read = readComparisonRange(args, form, ctx);
    if (read === undefined) continue;
    if (original !== undefined && !sameRange(original, read)) return undefined;
    original = read;
    for (const { argument } of formArguments(form)) unread.delete(argument);
  }
  return unread.size === 0 ? original : undefined;
}

/** A shared object argument may contain bounds that belong only to another form. */
function competingObjectKeys(
  form: Extract<PeriodForm, { kind: 'object' }>,
  forms: readonly PeriodForm[],
): ReadonlySet<string> {
  return new Set(
    forms
      .flatMap((other) =>
        other.kind === 'object' && other.argument === form.argument
          ? [other.keys.from, other.keys.to]
          : [],
      )
      .filter((key) => key !== form.keys.from && key !== form.keys.to),
  );
}

function hasCompetingObjectKeys(
  args: Arguments,
  form: PeriodForm,
  forms: readonly PeriodForm[],
): boolean {
  if (form.kind !== 'object') return false;
  const value = args[form.argument];
  return (
    isPlain(value) && [...competingObjectKeys(form, forms)].some((key) => Object.hasOwn(value, key))
  );
}

/** Copy only this form's arguments, retaining unrelated fields within its object. */
function givenValues(call: CallToBind, form: PeriodForm): Arguments {
  const values = Object.fromEntries(
    formArguments(form)
      .filter(({ argument }) => !call.isMissing(argument))
      .map(({ argument }) => [argument, call.args[argument]]),
  );
  if (form.kind !== 'object') return values;
  const object = values[form.argument];
  if (!isPlain(object)) return values;
  const competitors = competingObjectKeys(form, call.forms);
  return {
    ...values,
    [form.argument]: Object.fromEntries(
      Object.entries(object).filter(([key]) => !competitors.has(key)),
    ),
  };
}

/** Verify the final period surface immediately before dispatch. */
export function comparisonArgumentsMatch(
  args: Arguments,
  forms: readonly PeriodForm[],
  formIndex: number,
  range: TimeRange,
  ctx: ReadContext,
): boolean {
  if (forms.length > MAX_PERIOD_FORMS) return false;
  const form = forms[formIndex];
  if (form === undefined || form.kind === 'lookback') return false;
  for (const argument of untakenBesides(forms, formIndex)) {
    if (Object.hasOwn(args, argument)) return false;
  }
  if (hasCompetingObjectKeys(args, form, forms)) return false;
  const selected = readComparisonRange(args, form, ctx);
  if (selected === undefined || !sameRange(selected, range)) return false;
  // Two declarations can share all their argument names yet decode them differently.
  return forms.every((alternative, index) => {
    if (index === formIndex) return true;
    const other = readComparisonRange(args, alternative, ctx);
    return other === undefined || sameRange(other, range);
  });
}

/** Choose the first declared form that can hold both confirmed endpoints exactly. */
export function exactComparisonArguments(
  call: CallToBind,
  window: TurnWindow,
  ctx: BindContext,
): ExactComparisonArguments | undefined {
  if (call.forms.length === 0 || call.forms.length > MAX_PERIOD_FORMS) return undefined;
  const endpoint = window.endpoint ?? windowEndpointOf(window.range.to);
  const input = windowToConvert({ ...window, endpoint });
  const reach = formReach(input);
  const facts = { direction: call.facts?.direction, retention: call.facts?.retention };
  if (reach === undefined || periodFactProblem(input.range, facts, ctx.now) !== undefined)
    return undefined;

  for (const [index, form] of call.forms.entries()) {
    if (
      form.kind === 'lookback' ||
      (input.freezeLookback === true && !supportsFrozenLookback(form))
    )
      continue;
    const limit = formMaxRange(form, call.facts);
    const widest = limit === undefined ? undefined : durationMs(limit, FACT_UNITS);
    if (widest !== undefined && reach > widest) continue;

    const given = givenValues(call, form);
    let values: Conversion['values'] = given;
    if (!comparisonArgumentsMatch(given, call.forms, index, input.range, ctx)) {
      const converted = convertOne(input, form, { ...ctx, zone: window.zone }, true);
      if (converted === undefined || converted.rounded) continue;
      values = converted.values;
      if (form.kind === 'object') {
        const old = given[form.argument];
        const fresh = values[form.argument];
        if (isPlain(old) && isPlain(fresh)) {
          values = { ...values, [form.argument]: { ...old, ...fresh } };
        }
      }
      if (!comparisonArgumentsMatch(values, call.forms, index, input.range, ctx)) continue;
    }
    const same = comparisonArgumentsMatch(call.args, call.forms, index, input.range, ctx);
    const original = same ? undefined : originalRange(call.args, call.forms, ctx);
    return { form: index, values, same, ...(original !== undefined && { original }) };
  }
  return undefined;
}
