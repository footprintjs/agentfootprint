/**
 * core/time/bind — which of the person's windows a tool call carries (time
 * design § 5.6, § 7.3): fill from one mention, bind by quote, and record a
 * differing model window and run it.
 *
 * Pattern: Walker over recorded rows. The turn's WINDOWS are read from what
 *          the record already holds — this turn's `time-answer` rows (a
 *          mention the person settled in the time ask), a `model` reader's
 *          `time-reading` rows (a reading, never the person's) and the
 *          `clock` row's `control` window — never from words. A `rule`
 *          reading settles nothing: it is a proposal the person confirms
 *          (the owner's decision "Always confirm", time design TQ29). One call's decision
 *          ({@link callWindowOf}) is a pure function of its arguments, the
 *          tool's forms and those windows.
 * Role:    core/ leaf (the time layer). Imports `convert.ts`, `range.ts`,
 *          `rows.ts`, `resolve.ts`' types and `zone.ts` only. Asked by the
 *          inputs layer (`arguments/resolve.ts`), which files the argument
 *          rows and the `call-window` row the decision implies.
 * Emits:   N/A.
 *
 * ## The laws
 *
 * - **Fill only when the turn has exactly one window.** A message holding two
 *   mentions ("this morning vs yesterday morning") fills nothing: which one a
 *   call means is the model's to say, through the quote. A mention whose
 *   reading is still open (the person has not chosen) is counted and fills
 *   nothing; a refused mention (its quote was not in the message) is not the
 *   person's words and is not counted. A `control` window (`time.window`, set
 *   in a UI) counts as one more mention with no quote.
 * - **Fill only what the model left out — exactly, else wider, never
 *   narrower.** Every argument of every form must be missing; the window goes
 *   into the first form that holds it exactly (`convert.ts` · `convertExact`),
 *   else the first that holds MORE (`convertWidened`: a whole day, the
 *   covering look-back — recorded with what it adds). No such form → nothing
 *   is filled and the tool's own rule applies, as before.
 * - **Refuse before dispatch what the tool cannot honestly read (step
 *   T5b).** A window — the person's to fill, or the model's sent — outside
 *   the tool's declared `direction`, wholly beyond its `retention` or wider
 *   than its `maxRange`; a range across days for a tool whose every form is a
 *   `day`; a sent wall time the zone skips. A window only partly beyond
 *   `retention` runs, marked.
 * - **A present window is never written over.** Bound by quote (the model's
 *   declared `user` quote names a recorded mention) or by value (the sent
 *   value, read back, IS a window of this turn); otherwise it runs as sent and
 *   is recorded `model-chosen` beside the person's window — a drill-down, a
 *   comparison and a baseline call are normal work.
 */

import {
  convertExact,
  convertWidened,
  formArguments,
  lookbackAsBounds,
  partlyBeyondRetention,
  periodFactProblem,
  readBack,
  sameRange,
  spansDaysForDayOnly,
  wallGapArgument,
  widestMsOf,
  type Conversion,
  type PeriodFacts,
  type PeriodForm,
  type TimeRefusal,
  type WidenedConversion,
} from './convert.js';
import type { InstantText } from './instant.js';
import type { TimeRange } from './range.js';
import type { ZoneName } from './zone.js';

// ─── The turn's windows (`windows.ts`) ───────────────────────────────────

// The record half lives in `windows.ts` (split by FILE so the synchronous doors
// never load this module's conversions); every public name is re-exported here.
export {
  pendingQuotesOf,
  readerWindowsOf,
  turnWindowsOf,
  type ReaderWindows,
  type TurnWindow,
  type TurnWindows,
  type WindowSource,
} from './windows.js';
import type { TurnWindow, TurnWindows } from './windows.js';

// ─── One call ────────────────────────────────────────────────────────────

/** What the inputs layer knows about one call to a tool that declares period forms. */
export interface CallToBind {
  readonly args: Readonly<Record<string, unknown>>;
  readonly forms: readonly PeriodForm[];
  /** The argument is missing from the call (`arguments/declare.ts` · `isMissing`). */
  readonly isMissing: (argument: string) => boolean;
  /**
   * Under declared sources: the quotes the model declared (`source: 'user'`)
   * for this call's period arguments. Absent when the arm is off.
   */
  readonly quotes?: readonly string[];
  /**
   * The tool's declared facts (`direction`, `retention`, `maxRange`,
   * `filtersToAsked`) — a call whose window breaks one is refused before
   * dispatch (step T5b). Absent: nothing is checked.
   */
  readonly facts?: PeriodFacts;
}

/** The clock and zones a decision reads. */
export interface BindContext {
  readonly now: InstantText;
  readonly zone: ZoneName;
  readonly appZone?: ZoneName;
  readonly granularityMs: number;
}

/** The decision for one call — see {@link callWindowOf}. */
export type CallWindow =
  /** The model left every period argument out and the turn's one window went into `form` exactly. */
  | {
      readonly how: 'filled';
      readonly window: TurnWindow;
      /** Exact, or — when no form holds the window exactly — WIDENED (it carries `sent` and `extra`). */
      readonly conversion: Conversion | WidenedConversion;
      /** Widened, and the tool declares `filtersToAsked`: it trims its rows to the asked window. */
      readonly trimmedByTool?: true;
      readonly partlyBeyondRetention?: true;
    }
  /** The sent window IS one of the turn's windows — named by the model's quote (`quote`) or equal in value (`value`). */
  | {
      readonly how: 'bound';
      readonly form: number;
      readonly asked: TimeRange;
      readonly window: TurnWindow;
      readonly by: 'quote' | 'value';
      readonly partlyBeyondRetention?: true;
    }
  /** The sent window differs from the person's: it runs as sent (§ 7.3, the v1 law). `person` when one window is the person's. */
  | {
      readonly how: 'model-chosen';
      readonly form: number;
      readonly asked: TimeRange;
      readonly person?: TurnWindow;
      readonly partlyBeyondRetention?: true;
    }
  /** The sent window, and no window of the person's to compare it with. */
  | {
      readonly how: 'model';
      readonly form: number;
      readonly asked: TimeRange;
      readonly partlyBeyondRetention?: true;
    }
  /**
   * Refused before dispatch (step T5b): the window breaks one of the tool's
   * facts, spans days for a tool that reads one, or a sent wall time is one
   * the zone skips (`argument` names it). `asked` and `person` when known.
   */
  | {
      readonly how: 'refused';
      readonly refused: TimeRefusal;
      readonly form?: number;
      readonly asked?: TimeRange;
      readonly person?: TurnWindow;
      readonly argument?: string;
    }
  /** A period argument was sent, and no form reads the call's arguments back as a range. */
  | { readonly how: 'unread' }
  /** The model left the period out and nothing was filled — why. */
  | {
      readonly how: 'not-filled';
      readonly why: 'no-window' | 'several-mentions' | 'open-reading' | 'no-exact-form';
    };

const normalQuote = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Whether a declared quote names a recorded mention: one holds the other, whitespace and case aside. */
function quoteNames(declared: string, mention: string): boolean {
  const a = normalQuote(declared);
  const b = normalQuote(mention);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

/** Whether a sent range is a window: the same instants, or a look-back sent as `[now − L, now)`. */
function isWindow(sent: TimeRange, window: TurnWindow, now: InstantText): boolean {
  if (sameRange(sent, window.range)) return true;
  if (window.lookback === undefined) return false;
  const bounds = lookbackAsBounds(now, window.lookback);
  return bounds !== undefined && sameRange(sent, bounds);
}

/**
 * Which window one call carries (the module laws). Pure: the same call, forms
 * and windows always give the same decision.
 */
export function callWindowOf(call: CallToBind, turn: TurnWindows, ctx: BindContext): CallWindow {
  const periodArguments = [
    ...new Set(call.forms.flatMap((f) => formArguments(f).map((a) => a.argument))),
  ];
  const anyPresent = periodArguments.some((a) => !call.isMissing(a));
  return anyPresent ? presentWindow(call, turn, ctx) : fillWindow(call, turn, ctx);
}

/** A present window's facts: refused when it breaks one, else marked when partly beyond retention. */
function judged(
  decision: Extract<CallWindow, { how: 'bound' | 'model-chosen' | 'model' }>,
  facts: PeriodFacts | undefined,
  now: InstantText,
): CallWindow {
  if (facts === undefined) return decision;
  const problem = periodFactProblem(decision.asked, facts, now);
  if (problem !== undefined) {
    const person =
      decision.how === 'bound'
        ? decision.window
        : decision.how === 'model-chosen'
        ? decision.person
        : undefined;
    return {
      how: 'refused',
      refused: problem,
      form: decision.form,
      asked: decision.asked,
      ...(person !== undefined && { person }),
    };
  }
  return partlyBeyondRetention(decision.asked, facts, now)
    ? { ...decision, partlyBeyondRetention: true }
    : decision;
}

/** The model left every period argument out: fill from the turn's one window, exactly, else widened (§ 7.2). */
function fillWindow(call: CallToBind, turn: TurnWindows, ctx: BindContext): CallWindow {
  if (turn.mentions === 0) return { how: 'not-filled', why: 'no-window' };
  if (turn.mentions > 1) return { how: 'not-filled', why: 'several-mentions' };
  const window = turn.windows[0];
  const facts = call.facts;
  if (window === undefined) {
    // An open reading: when the tool's facts rule out EVERY reading left, nothing is asked —
    // the call is refused with the first reading's reason (§ 6.3).
    const left = turn.open?.[0] ?? [];
    const problems =
      facts === undefined ? [] : left.map((range) => periodFactProblem(range, facts, ctx.now));
    const first = problems[0];
    if (left.length > 0 && first !== undefined && problems.every((p) => p !== undefined)) {
      return { how: 'refused', refused: first };
    }
    return { how: 'not-filled', why: 'open-reading' };
  }
  const problem = facts === undefined ? undefined : periodFactProblem(window.range, facts, ctx.now);
  if (problem !== undefined) {
    return { how: 'refused', refused: problem, asked: window.range, person: window };
  }
  const toConvert = {
    range: window.range,
    ...(window.lookback !== undefined && { lookback: window.lookback }),
  };
  const convertCtx = {
    now: ctx.now,
    zone: window.zone,
    appZone: ctx.appZone,
    granularityMs: ctx.granularityMs,
  };
  const partly =
    facts !== undefined && partlyBeyondRetention(window.range, facts, ctx.now)
      ? { partlyBeyondRetention: true as const }
      : {};
  const exact = convertExact(toConvert, call.forms, convertCtx);
  if (exact !== undefined) return { how: 'filled', window, conversion: exact, ...partly };
  const widened = convertWidened(toConvert, call.forms, convertCtx, widestMsOf(facts));
  if (widened !== undefined) {
    return {
      how: 'filled',
      window,
      conversion: widened,
      ...(facts?.filtersToAsked === true && { trimmedByTool: true as const }),
      ...partly,
    };
  }
  if (spansDaysForDayOnly(toConvert, call.forms, convertCtx)) {
    return { how: 'refused', refused: 'multi-day', asked: window.range, person: window };
  }
  return { how: 'not-filled', why: 'no-exact-form' };
}

/** A present window: bound, the model's own, unread — or refused on a skipped wall time or a fact. */
function presentWindow(call: CallToBind, turn: TurnWindows, ctx: BindContext): CallWindow {
  // The first form whose arguments read back as a range.
  let form = -1;
  let asked: TimeRange | undefined;
  for (let i = 0; i < call.forms.length && asked === undefined; i++) {
    const f = call.forms[i] as PeriodForm;
    if (formArguments(f).some((a) => a.role !== 'zone' && call.isMissing(a.argument))) continue;
    asked = readBack(call.args, f, {
      now: ctx.now,
      ...(ctx.appZone !== undefined && { appZone: ctx.appZone }),
    });
    if (asked !== undefined) form = i;
  }
  if (asked === undefined) return unreadWindow(call, ctx);
  if (turn.windows.length === 0) return judged({ how: 'model', form, asked }, call.facts, ctx.now);
  // The windows the declared quote names; when it names several, the one the value matches wins.
  const named =
    call.quotes === undefined
      ? []
      : turn.windows.filter(
          (w) =>
            w.quote !== undefined && call.quotes?.some((q) => quoteNames(q, w.quote as string)),
        );
  const quoted = named.find((w) => isWindow(asked as TimeRange, w, ctx.now)) ?? named[0];
  if (quoted !== undefined) {
    return judged(
      isWindow(asked, quoted, ctx.now)
        ? { how: 'bound', form, asked, window: quoted, by: 'quote' }
        : { how: 'model-chosen', form, asked, person: quoted },
      call.facts,
      ctx.now,
    );
  }
  const equal = turn.windows.find((w) => isWindow(asked as TimeRange, w, ctx.now));
  if (equal !== undefined) {
    return judged({ how: 'bound', form, asked, window: equal, by: 'value' }, call.facts, ctx.now);
  }
  return judged(
    {
      how: 'model-chosen',
      form,
      asked,
      ...(turn.windows.length === 1 && { person: turn.windows[0] as TurnWindow }),
    },
    call.facts,
    ctx.now,
  );
}

/** No form reads the call back: a sent wall time the zone skips is refused (§ 7.2); anything else runs `unread`. */
function unreadWindow(call: CallToBind, ctx: BindContext): CallWindow {
  for (let i = 0; i < call.forms.length; i++) {
    const f = call.forms[i] as PeriodForm;
    if (formArguments(f).some((a) => a.role !== 'zone' && call.isMissing(a.argument))) continue;
    const argument = wallGapArgument(call.args, f, {
      ...(ctx.appZone !== undefined && { appZone: ctx.appZone }),
    });
    if (argument !== undefined) return { how: 'refused', refused: 'dst-gap', form: i, argument };
  }
  return { how: 'unread' };
}

/** The range a decision says the call asks for — the person's on a fill, the sent one otherwise. */
export function askedRangeOf(decision: CallWindow): TimeRange | undefined {
  switch (decision.how) {
    case 'filled':
      return decision.window.range;
    case 'bound':
    case 'model-chosen':
    case 'model':
      return decision.asked;
    case 'refused':
      return decision.asked;
    default:
      return undefined;
  }
}
