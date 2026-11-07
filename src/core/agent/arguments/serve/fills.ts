/** Lens: the unchanged past-tense notes on calls that ran with filled arguments. */
import type { InputValue } from '../../../../tools/inputRequest.js';
import type { ServeOptions } from './schema.js';
import { printedValue } from './values.js';

// ─── The note on a result ───────────────────────────────────────────────

/** One filled argument, as the note names it. */
export interface FilledArgument {
  readonly argument: string;
  /** A window fill of an `object` form is an object (printed as JSON). */
  readonly value: InputValue | Readonly<Record<string, InputValue>>;
  readonly hidden: boolean;
  /**
   * `answered`: the person's answer to the batch ask filled it. `window`: the
   * turn's one window of the person's did (the time layer), `from` saying
   * whose. Absent: the tool's rule assumed it.
   */
  readonly source?: 'answered' | 'window';
  /**
   * On a `window` fill: the person's words, a `model` reader's unconfirmed
   * reading of them, a UI control — or the window the person CHOSE when the
   * library asked about their words (`answered`, the lazy word-driven ask).
   */
  readonly from?: 'said' | 'derived-from-reading' | 'control' | 'answered';
  /**
   * On a `window` fill: no form held the window exactly, so the value reads a
   * WIDER one (the time layer, step T5b) — `reads-more`, or `tool-trims` when
   * the tool declares that it drops the rows outside the asked window.
   */
  readonly wider?: 'reads-more' | 'tool-trims';
  /**
   * The value the call had CARRIED, which the person's answer replaced
   * (declared sources: an untraced value is asked about). Absent: the call
   * had left the argument out.
   */
  readonly carried?: InputValue;
}

// LENS · tool-result · persistent-history
// reads: the call's own fill (`argumentResolutions`, the layer's entry for this toolCallId), kept only
//        where the call RAN with it (`core/agent/arguments/dispatch.ts` · `fillsThatRan` — a middleware may rewrite one)
// law: may omit, never deny; every clause anchored to the call it was composed on — past tense,
// naming the call this result answers, so a later call of the turn re-reading it reads a true sentence.
/**
 * The past-tense note ToolCalls appends to the result of a call that RAN on a
 * value the library filled — one bracket per filled argument the call really
 * ran with (a clause whose fill a before-tool middleware rewrote is left
 * out), after the tool's own bytes. The message then carries `toolChars`, and
 * every reader of a result's content as the TOOL's words reads through that
 * cut (`lib/toolBytes.ts` · `toolBytesOf`): the evidence index, the answer's
 * standing and the answer account's in-view results, the unsupported-argument
 * seam's grounded corpus and the empty-lookup seam's producer corpus. The
 * value is kept in the note because the model needs it to reason about what
 * ran ("no errors in 2h"); it is never evidence for that value, and it never
 * hides a reading of the tool's own bytes.
 *
 * @example
 * ```ts
 * filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: false }]);
 * // '\n\n[window was not in the search_logs call this result answers; the call ran with "2h",
 * //  the value the tool's rule assumes — recorded as assumed, not as the person's.]'
 * ```
 */
export function filledNote(
  toolName: string,
  fills: readonly FilledArgument[],
  options?: ServeOptions,
): string {
  return fills
    .map((f) =>
      f.source === 'answered'
        ? answeredClause(toolName, f, options?.sources === true)
        : f.source === 'window'
        ? windowClause(toolName, f)
        : assumedClause(toolName, f),
    )
    .join('');
}

/** A filled value as a note prints it — an object form's value as JSON. */
function printedFill(value: FilledArgument['value']): string {
  return typeof value === 'object' ? JSON.stringify(value) : printedValue(value);
}

// LENS · tool-result · persistent-history
// reads: the call's window fill (`argumentResolutions`: the turn's ONE window of the person's, converted
//        into the tool's form — `time/bind.ts`), kept only where the call RAN with it, and whose window
//        it was (the person's words, a model reader's unconfirmed reading of them, a UI control)
// law: may omit, never deny; past tense, naming the call this result answers; a reading of the person's
//      words is never called their words.
/** The clause for a value the turn's one window of the person's filled (the time layer, step T5a). */
function windowClause(toolName: string, f: FilledArgument): string {
  const whose =
    f.from === 'control'
      ? 'from the window the person set in the app — recorded as set in the app'
      : f.from === 'answered'
      ? 'from the window the person chose when asked what their words meant — recorded as ' +
        "the person's answer"
      : f.from === 'derived-from-reading'
      ? "from a reading of the person's words they have not confirmed — recorded as a reading, " +
        "not as the person's"
      : "from the window the person's own words gave — recorded as the person's";
  const wider =
    f.wider === 'reads-more'
      ? "; the tool's form could not hold that window exactly, so the value reads a wider one — " +
        'recorded as wider than asked'
      : f.wider === 'tool-trims'
      ? "; the tool's form could not hold that window exactly, so the value reads a wider one, " +
        'and the tool declares that it drops the rows outside the asked window'
      : '';
  return f.hidden
    ? `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran with ` +
        `a value ${whose} (the value is hidden by the tool's view)${wider}.]`
    : `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran with ` +
        `${printedFill(f.value)}, ${whose}${wider}.]`;
}

function assumedClause(toolName: string, f: FilledArgument): string {
  return f.hidden
    ? `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran ` +
        "with the value the tool's rule assumes (the value is hidden by the tool's view) — " +
        "recorded as assumed, not as the person's.]"
    : `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran ` +
        `with ${printedFill(f.value)}, the value the tool's rule assumes — recorded as ` +
        "assumed, not as the person's.]";
}

/**
 * The clause an answered note gains under declared sources: a later call may
 * name the person's answer as its source — `turn`, checked against the
 * ledger's `answered` rows (`checks.ts` · `checkTurn`). A permission, never a
 * promise: the claim is still checked. In the paid step-5 run the model sent
 * an answered period again on the next turn with no `from` entry (and so was
 * asked again) or left it out (and so was asked again): nothing it was served
 * said an earlier ANSWER was a source it could name.
 */
export const ANSWERED_SOURCE_CLAUSE =
  "; a later call may cite that answer in `_findings.from` with source 'turn'";

// LENS · tool-result · persistent-history
// reads: the call's answered fill (the batch ask's answer bound to this toolCallId), kept only where the
//        call RAN with it (`core/agent/arguments/dispatch.ts` · `fillsThatRan`), the value the call had carried, if any, and
//        whether declared sources are armed (the `turn` clause)
// law: may omit, never deny; past tense, naming the call this result answers; the `turn` clause is a
// permission ("may cite"), never an outcome — the claim is checked like any other.
function answeredClause(toolName: string, f: FilledArgument, sources: boolean): string {
  const before =
    f.carried === undefined
      ? 'the call had left it out'
      : f.hidden
      ? 'the call had carried a value of its own'
      : `the call had carried ${printedValue(f.carried)}`;
  // A hidden answer is on the record as 'REDACTED' — a `turn` claim for it cannot be checked
  // (`checks.ts` · `checkTurn`: `uncheckable`), so its clause offers none.
  return f.hidden
    ? `\n\n[${f.argument} in the ${toolName} call this result answers was chosen by the person ` +
        `when asked (the value is hidden by the tool's view; ${before}).]`
    : `\n\n[${f.argument} = ${printedFill(f.value)} in the ${toolName} call this result answers ` +
        `was chosen by the person when asked (${before})${sources ? ANSWERED_SOURCE_CLAUSE : ''}.]`;
}
