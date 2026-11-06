/** Lens: the unchanged past-tense refusal and kept-answer sentences. */
import type { PeriodFacts, TimeRefusal } from '../../../../time/convert.js';

// ─── The refusals ───────────────────────────────────────────────────────

// LENS · tool-result · persistent-history
// reads: the dispatch re-read of the tool's rules (`tools/declare.ts` · `rulesOf`) — the assert's own sentence
// law: may omit, never deny; every clause anchored to the call it was composed on.
/** The result a call reads when its tool's rules could not be read at dispatch. */
export function unreadableRulesRefusal(toolName: string, reason: string): string {
  const why = reason.replace(/^defineTool\('[^']*'\):\s*/, '');
  return `${toolName} was not run on that call: its argument rules could not be read (${why}).`;
}

// LENS · tool-result · persistent-history
// reads: nothing but the tool's declaration — the agent was built without the inputs layer
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * The result a call reads when its tool declares argument rules and the agent
 * was built without the inputs layer (a ToolProvider served the tool, and the
 * build could not see it) — refused rather than run unruled, because
 * configured-and-inert looks exactly like configured-and-working.
 */
export function unmountedRulesRefusal(toolName: string): string {
  return `${toolName} was not run on that call: it declares argument rules this agent was not built to apply.`;
}

// LENS · tool-result · persistent-history
// reads: the batch ask's settled state — the arguments whose answers never fit, and the rule they failed
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * The result a call reads when the person was asked for a ruled argument
 * `MAX_ASK_ROUNDS` times and no answer fitted what the tool accepts — the call
 * does not run. `expected` is the property schema's own expectation (never the
 * person's answer).
 */
export function unansweredRefusal(
  toolName: string,
  unanswered: readonly { readonly argument: string; readonly expected?: string }[],
): string {
  const names = unanswered.map((u) => u.argument).join(', ');
  const rules = unanswered.flatMap((u) =>
    u.expected !== undefined ? [`${u.argument}: ${u.expected}`] : [],
  );
  return (
    `${toolName} was not run on that call: the person's answers for ${names} did not fit what ` +
    `the tool accepts${rules.length > 0 ? ` (${rules.join('; ')})` : ''}.`
  );
}

// LENS · tool-result · persistent-history
// reads: nothing but the fact that this batch already paused once, for the library's own ask
// law: may omit, never deny; past tense, anchored to the call; names no destination.
/**
 * The result a call reads when it needed a person — its check-in consent gate
 * tripped, or the tool itself asked to pause — in a batch that had ALREADY
 * paused once, to ask the person for argument values: a resumed batch has no
 * second pause to give (at most one human question per resume). The call did
 * not finish; nothing about it is decided for the person.
 */
export function secondPauseRefusal(toolName: string, why: 'check-in' | 'tool-pause'): string {
  const need =
    why === 'check-in'
      ? 'its check-in consent gate needed a person’s approval for those arguments'
      : 'the tool asked to pause for a person';
  return (
    `${toolName} was not run to completion on that call: ${need}, and this batch had already ` +
    'paused once — to ask the person for argument values — so there was no second pause to ' +
    'ask with.'
  );
}

// LENS · tool-result · persistent-history
// reads: the call's `call-window` decision (`time/bind.ts` · `callWindowOf`: the window it asked
//        for against the tool's DECLARED facts — `direction`, `retention`, `maxRange`, a `day`-only form,
//        a sent wall time the zone skips, a person's window no declared form can read) and those facts'
//        own spellings
// law: may omit, never deny; past tense, anchored to the call; prints no window value (it may be the
//      person's) — only the tool's declared facts and an argument name; says what the model may do and
//      promises no outcome.
/**
 * The result a call reads when it was refused BEFORE DISPATCH on its window
 * (the time layer, step T5b — time design § 7.2): the window breaks one of the
 * tool's declared facts, spans days for a tool that reads one day per call, a
 * sent wall time is one the zone's clocks skip, or no form the tool declares
 * can read the person's window, exactly or wider (`no-form-holds` — the tool's
 * own default never stands in for it). Splitting a window into several calls
 * is the model's choice, never the library's.
 *
 * @example
 * ```ts
 * timeRefusal('search_logs', 'time-future', { direction: 'past' });
 * // 'search_logs was not run on that call: the window it asked for had not happened yet, and the
 * //  tool declares that its source holds only the past.'
 * ```
 */
export function timeRefusal(
  toolName: string,
  refusal: TimeRefusal,
  facts: PeriodFacts,
  argument?: string,
): string {
  return `${toolName} was not run on that call: ${refusalReason(refusal, facts, argument)}.`;
}

/**
 * Why a window was refused before dispatch, in the tool's declared facts and
 * an argument name only — never the window's value. ONE text per code: the
 * refused call's result ({@link timeRefusal}) and the served line's
 * conclusion (`refusedSentence`) both say it.
 */
export function refusalReason(refusal: TimeRefusal, facts: PeriodFacts, argument?: string): string {
  switch (refusal) {
    case 'time-future':
      return (
        'the window it asked for had not happened yet, and the tool declares that its source ' +
        'holds only the past'
      );
    case 'time-past':
      return (
        'the window it asked for had already ended, and the tool declares that its source ' +
        'holds only the future'
      );
    case 'beyond-retention':
      return (
        'the window it asked for was wholly older than the oldest data the tool declares its ' +
        `source keeps (${facts.retention ?? 'its retention'})`
      );
    case 'over-max-range':
      return (
        'the window it asked for was wider than the tool declares it reads at once ' +
        `(maxRange ${facts.maxRange ?? 'undeclared'}); narrower windows, one call each, may be ` +
        'proposed instead'
      );
    case 'multi-day':
      return (
        'the window it asked for spanned more than one calendar day, and the tool reads one day ' +
        'per call; one call per day may be proposed instead'
      );
    case 'dst-gap':
      return (
        `the wall time sent for ${argument ?? 'its period'} does not exist in the tool's zone — ` +
        'the clocks skip it at a daylight-saving change'
      );
    case 'no-form-holds':
      return (
        'no period form the tool declares can read the window it asked for, exactly or by ' +
        'reading a wider one' +
        (facts.maxRange !== undefined
          ? `, within the most the tool declares it reads at once (maxRange ${facts.maxRange})`
          : '')
      );
  }
}

// LENS · tool-result · persistent-history
// reads: the tool's name and the NAMES of the arguments whose answers the refused call carried
//        (`kept.ts` keeps their values)
// law: past tense, anchored to the call it was composed on, so a later call of the turn re-reading it
// (after the kept answer was used) still reads a true sentence; says what the model may do and promises
// no outcome (a call proposed again may still be denied, refused, paused or asked); prints no value.
/**
 * The clause a refusal by the one-question law gains when the refused call
 * carried the person's answers: they were KEPT for the tool's next call that
 * leaves those arguments out (`kept.ts`), so the model may propose the call
 * again without them. Empty when the call carried none.
 *
 * @example
 * ```ts
 * keptAnswersNote('purge_logs', ['window']);
 * // " The person's answer for window was kept for the next purge_logs call that leaves it out,
 * //   so the call may be proposed again without window."
 * ```
 */
export function keptAnswersNote(toolName: string, argumentNames: readonly string[]): string {
  if (argumentNames.length === 0) return '';
  if (argumentNames.length === 1) {
    const [name] = argumentNames;
    return (
      ` The person's answer for ${name} was kept for the next ${toolName} call that leaves ` +
      `it out, so the call may be proposed again without ${name}.`
    );
  }
  const names = `${argumentNames.slice(0, -1).join(', ')} and ${argumentNames.at(-1)}`;
  return (
    ` The person's answers for ${names} were kept for the next ${toolName} call that leaves ` +
    'them out, so the call may be proposed again without them.'
  );
}
