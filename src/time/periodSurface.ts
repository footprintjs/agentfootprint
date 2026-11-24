import { formArguments, type PeriodForm } from './periodForm.js';

/** Forms per period — a tool spells its period in a handful of shapes, never dozens. */
export const MAX_PERIOD_FORMS = 8;

/** The period arguments that competing forms name and the selected form does not. */
export function untakenBesides(forms: readonly PeriodForm[], taken: number): ReadonlySet<string> {
  const chosen = forms[taken];
  if (chosen === undefined) return new Set();
  const mine = new Set(formArguments(chosen).map((a) => a.argument));
  return new Set(
    forms.flatMap((form) => formArguments(form).map((a) => a.argument)).filter((a) => !mine.has(a)),
  );
}
