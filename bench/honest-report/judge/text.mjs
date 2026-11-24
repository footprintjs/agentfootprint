/**
 * bench/honest-report/judge/text.mjs — the one rule for which text a judge reads (RULE.md § 4).
 *
 * The model's own text (`raw.modelText`, taken from the harness's own record of the replies),
 * for every ending alike; for a parsed fixed form, its `summary` (the form's prose; its status
 * and actions are read by code). Never the delivered text, never a library line. Undefined when
 * there is no text or it is empty: the run is then `no-answer`.
 *
 * Example: `textToJudge({ modelText: '', deliveredText: 'Not sure — the run stopped …' })` → undefined.
 */
export function textToJudge(raw) {
  const text = raw.form !== undefined ? raw.form.summary : raw.modelText;
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}
