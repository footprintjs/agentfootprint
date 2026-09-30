/**
 * core/time/bind — which of the person's windows a tool call carries (time
 * design § 5.6, § 7.3): fill from one mention, bind by quote, and record a
 * differing model window and run it.
 *
 * Pattern: Walker over recorded rows. The turn's WINDOWS are read from what
 *          the record already holds — the `time-reading` rows of this turn
 *          (a mention that resolved to one window) and the `clock` row's
 *          `control` window — never from words. One call's decision
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
 * - **Fill only what the model left out, and only exactly.** Every argument
 *   of every form must be missing; the window goes into the first form that
 *   holds it exactly (`convert.ts` · `convertExact`). No exact form → nothing
 *   is filled and the tool's own rule applies, as before.
 * - **A present window is never written over.** Bound by quote (the model's
 *   declared `user` quote names a recorded mention) or by value (the sent
 *   value, read back, IS a window of this turn); otherwise it runs as sent and
 *   is recorded `model-chosen` beside the person's window — a drill-down, a
 *   comparison and a baseline call are normal work.
 */

import {
  convertExact,
  formArguments,
  lookbackAsBounds,
  readBack,
  sameRange,
  type Conversion,
  type PeriodForm,
} from './convert.js';
import type { DurationText } from './duration.js';
import type { InstantText } from './instant.js';
import type { TimeRange } from './range.js';
import type { TimeCandidate } from './resolve.js';
import type { ClockRow, TimeReadingRow } from './rows.js';
import type { ZoneName } from './zone.js';

// ─── The turn's windows ──────────────────────────────────────────────────

/** Who a window is: the person's words (a `rule` reader), a `model` reader's unconfirmed reading, or a UI control. */
export type WindowSource = 'said' | 'derived-from-reading' | 'control';

/** One window of the turn — a mention that resolved to one window, or the `control` window. */
export interface TurnWindow {
  readonly source: WindowSource;
  /** The `time-reading` row's mention index — absent on the `control` window. */
  readonly mention?: number;
  /** The person's words it was read from — absent on the `control` window. */
  readonly quote?: string;
  readonly range: TimeRange;
  /** The look-back it was said as, when it was one. */
  readonly lookback?: DurationText;
  /** The zone the person meant, else the clock's. */
  readonly zone: ZoneName;
}

/** The turn's windows, and how many mentions the turn holds in all (resolved or not). */
export interface TurnWindows {
  readonly windows: readonly TurnWindow[];
  /** Every mention with a quote, plus the `control` window — the "exactly one" count. */
  readonly mentions: number;
}

/** The one window a reading settled on, if it settled on one (a `model` reading waits only for confirmation). */
function settledCandidate(row: TimeReadingRow): TimeCandidate | undefined {
  const choice = row.choice;
  const candidates = row.candidates ?? [];
  if (choice === undefined) return undefined;
  if (choice.by === 'only' || choice.by === 'policy') return candidates[choice.candidate];
  if (choice.by === 'open' && choice.open.length === 1 && choice.open[0] === 'confirm') {
    return candidates[choice.remaining[0] as number];
  }
  return undefined;
}

/**
 * This turn's windows, read from the record: each `time-reading` row whose
 * mention settled on one window (a `rule` reader's is `said`; a `model`
 * reader's, which waits only for the person's confirmation, is
 * `derived-from-reading`) and the clock's `control` window.
 */
export function turnWindowsOf(
  readings: readonly TimeReadingRow[],
  clock: ClockRow | undefined,
): TurnWindows {
  const windows: TurnWindow[] = [];
  let mentions = 0;
  for (const row of readings) {
    if (row.mentions === 0 || row.refused !== undefined || row.quote === undefined) continue;
    mentions++;
    const candidate = settledCandidate(row);
    if (candidate === undefined) continue;
    windows.push({
      source: row.reader.kind === 'model' ? 'derived-from-reading' : 'said',
      ...(row.mention !== undefined && { mention: row.mention }),
      quote: row.quote,
      range: candidate.range,
      ...(candidate.window.kind === 'lookback' && { lookback: candidate.window.duration }),
      zone: candidate.zone,
    });
  }
  if (clock?.window !== undefined) {
    mentions++;
    windows.push({
      source: 'control',
      range: { from: clock.window.from, to: clock.window.to },
      zone: clock.zone,
    });
  }
  return { windows, mentions };
}

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
      readonly conversion: Conversion;
    }
  /** The sent window IS one of the turn's windows — named by the model's quote (`quote`) or equal in value (`value`). */
  | {
      readonly how: 'bound';
      readonly form: number;
      readonly asked: TimeRange;
      readonly window: TurnWindow;
      readonly by: 'quote' | 'value';
    }
  /** The sent window differs from the person's: it runs as sent (§ 7.3, the v1 law). `person` when one window is the person's. */
  | {
      readonly how: 'model-chosen';
      readonly form: number;
      readonly asked: TimeRange;
      readonly person?: TurnWindow;
    }
  /** The sent window, and no window of the person's to compare it with. */
  | { readonly how: 'model'; readonly form: number; readonly asked: TimeRange }
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
  if (!anyPresent) {
    if (turn.mentions === 0) return { how: 'not-filled', why: 'no-window' };
    if (turn.mentions > 1) return { how: 'not-filled', why: 'several-mentions' };
    const window = turn.windows[0];
    if (window === undefined) return { how: 'not-filled', why: 'open-reading' };
    const conversion = convertExact(
      { range: window.range, ...(window.lookback !== undefined && { lookback: window.lookback }) },
      call.forms,
      { now: ctx.now, zone: window.zone, appZone: ctx.appZone, granularityMs: ctx.granularityMs },
    );
    if (conversion === undefined) return { how: 'not-filled', why: 'no-exact-form' };
    return { how: 'filled', window, conversion };
  }
  // A present window: the first form whose arguments read back as a range.
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
  if (asked === undefined) return { how: 'unread' };
  if (turn.windows.length === 0) return { how: 'model', form, asked };
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
    return isWindow(asked, quoted, ctx.now)
      ? { how: 'bound', form, asked, window: quoted, by: 'quote' }
      : { how: 'model-chosen', form, asked, person: quoted };
  }
  const equal = turn.windows.find((w) => isWindow(asked as TimeRange, w, ctx.now));
  if (equal !== undefined) return { how: 'bound', form, asked, window: equal, by: 'value' };
  return {
    how: 'model-chosen',
    form,
    asked,
    ...(turn.windows.length === 1 && { person: turn.windows[0] as TurnWindow }),
  };
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
    default:
      return undefined;
  }
}
