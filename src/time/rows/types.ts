import type { TimeReplyEvidence } from '../replyRecord.js';
import type { InstantText } from '../instant.js';
import type { TimeRange } from '../range.js';
import type { ZoneName } from '../zone.js';
import type { ClockChange, TimeClock } from '../clock.js';
import type { MentionRefusal, TimeParts } from '../reader.js';
import type { CallWindow, WindowSource } from '../bind.js';
import type { TimeRefusal } from '../periodForm.js';
import type { ReadingChoice, TimeCandidate } from '../resolveRecord.js';

/** A window set in a UI, as the clock row records it. */
export interface ControlWindow extends TimeRange {
  readonly source: 'control';
}

/** The turn's clock stamp — one per turn (time design § 4). */
export interface ClockRow extends TimeClock {
  readonly kind: 'clock';
  /** `AgentState.turnNumber` when the row was filed — the conversation turn. */
  readonly turn: number;
  /** The iteration seed filed it at (1). */
  readonly iteration: number;
  /** The run's `time.window`, when it passed one. */
  readonly window?: ControlWindow;
}

/** A resume passed a `time` that differs from the frozen clock: recorded, not applied (TQ21). */
export interface ClockOnResumeRow {
  readonly kind: 'clock-on-resume';
  readonly turn: number;
  /** The iteration the paused batch ran in. */
  readonly iteration: number;
  /** What the resume passed, as read (values as written, a `Date` spelled in UTC). */
  readonly passed: ClockChange['passed'];
  /** The frozen clock's values the passed ones would have replaced. */
  readonly kept: ClockChange['kept'];
}

/** One dispatched call's wall-clock moment (time design § 4, § 7.4). */
export interface CallRow {
  readonly kind: 'call';
  readonly turn: number;
  readonly iteration: number;
  readonly toolCallId: string;
  readonly toolName: string;
  /** The wall clock when the library handed the call to the tool — UTC, millisecond precision. */
  readonly dispatchedAt: InstantText;
  /**
   * The clock at dispatch (§ 7.4, step T5b) — present only when the call sent
   * a LOOK-BACK and `dispatchedAt − now` (`byMs`, signed) is more than the
   * tool's step. `redrawn`: the library's own look-back fill was re-sent as
   * the asked range in absolute form `form`; `shifted`: the look-back ran as
   * sent (the model's value, or no absolute form), so the tool read a window
   * shifted by `byMs` — `period-shifted`.
   */
  readonly drift?: CallDrift;
}

/** A look-back call's dispatch drift (§ 7.4) — see {@link CallRow.drift}. */
export type CallDrift =
  | { readonly byMs: number; readonly outcome: 'redrawn'; readonly form: number }
  | { readonly byMs: number; readonly outcome: 'shifted' };

/** The reader a reading came from, as recorded. */
export interface TimeReaderStamp {
  readonly id: string;
  readonly version: string;
  readonly kind: 'rule' | 'model';
  readonly locale: string;
}

/**
 * One mention the armed reader found in the person's message (time design
 * § 5.2) — or, with `mentions: 0` and no mention fields, the record that the
 * message was read and held none. Read back, never re-read: a resume and a
 * retry of the same turn find these rows and do not call the reader.
 */
export interface TimeReadingRow {
  readonly kind: 'time-reading';
  readonly turn: number;
  readonly iteration: number;
  readonly reader: TimeReaderStamp;
  /** The tz database the candidates were resolved with (`process.versions.tz`), else `'unknown'`. */
  readonly tzdata: string;
  /** How many mentions the reading held. */
  readonly mentions: number;
  /** This row's mention, 0-based — absent on the `mentions: 0` row. */
  readonly mention?: number;
  /** A verbatim substring of the person's message. */
  readonly quote?: string;
  readonly parses?: readonly TimeParts[];
  readonly problem?: 'unreadable';
  /** Why the mention was refused — its quote was not in the message, or its parts were malformed. It keeps no text. */
  readonly refused?: MentionRefusal;
  /** Every window `resolve.ts` made of the parts. */
  readonly candidates?: readonly TimeCandidate[];
  /** How the reading settled under the policy — `open` waits for the person. */
  readonly choice?: ReadingChoice;
}

/**
 * The window the person settled for one mention in the time ask — the ONLY
 * door by which a window of words becomes the person's (the owner's decision
 * "Always confirm", time design TQ29). Filed by the batch ask when a window
 * answer binds (`arguments/ask.ts` · `bindAnswer`); read back by
 * `bind.ts` · `turnWindowsOf`, so the rest of the turn uses it as an
 * `answered` window and the served sentence names it with its source.
 */
export interface TimeAnswerRow extends TimeRange {
  readonly kind: 'time-answer';
  readonly turn: number;
  readonly iteration: number;
  /** The `time-reading` row's mention the answer settles. */
  readonly mention: number;
  /** The zone the window was answered in — the reading's, or the turn's clock for free entry. */
  readonly zone: ZoneName;
  /**
   * `confirmed`: the person picked a reading the library offered (the
   * pre-filled choice — their click); `edited`: they wrote a window of their
   * own. Both are the person's answer.
   */
  readonly how: 'confirmed' | 'edited';
}

/** One request-bound correction decision, without the raw reply. */
export interface TimeReplyRow extends TimeReplyEvidence {
  readonly kind: 'time-reply';
  readonly turn: number;
  readonly iteration: number;
  readonly mention: number;
}
/** The person's window a `call-window` row names — its range, who gave it, and its mention. */
export interface PersonWindow extends TimeRange {
  readonly source: WindowSource;
  /** The `time-reading` row's mention index — absent on a `control` window. */
  readonly mention?: number;
}

/**
 * Which window one call to a tool that declares period forms carries (time
 * design § 7.3) — one row per such call (two when the time ask filled it, below), filed by the inputs layer beside the
 * call's `argument` rows, before the call dispatches.
 *
 * | `how` | Means |
 * |-------|-------|
 * | `filled` | the model left the period out; the turn's one window (`person`) went into form `form` exactly (`rounded`: an epoch-seconds bound or a look-back's length moved outward) |
 * | `bound` | the sent window IS the person's window `person` — named by the model's quote (`by: 'quote'`) or equal in value (`by: 'value'`) |
 * | `model-chosen` | the sent window (`asked`) differs from the person's (`person`, when one window is theirs): it ran as sent (the v1 law) |
 * | `model` | the sent window, and no window of the person's this turn |
 * | `unread` | a period argument was sent and no form reads the call back as a range |
 * | `not-filled` | the period was left out and nothing was filled (`why`) — the tool's own rule applied (`no-exact-form` is no longer filed: a window no form holds is refused, `no-form-holds`; the word is kept so an older record reads) |
 * | `refused` | refused before dispatch (`refused`: a fact the window breaks, `multi-day`, `no-form-holds`, `dst-gap` with its `argument`; no range at all when an open reading was refused in every reading) — the call did not run |
 *
 * `asked` is the half-open range the call asks for: the person's on a fill,
 * the sent value read back otherwise — what `ctx.time.asked` hands the tool.
 * A WIDENED fill (no form holds the window exactly — § 7.2) carries `sent`,
 * the range the tool reads, and either `differs.extra` (the parts read but
 * not asked — `period-differs-from-asked`) or `trimmedByTool` (the tool
 * declares `filtersToAsked`). `partlyBeyondRetention` marks a window that
 * starts before the source's oldest data and ends after it: it dispatched.
 *
 * A call the time ask filled (the person confirmed or gave the window when
 * asked what their words meant) has TWO rows: `not-filled` / `open-reading`
 * before the ask, then `filled` with `person.source: 'answered'` when the
 * answer is bound (`arguments/ask.ts` · `bindAnswer`). The LATEST row of a
 * call is the window it runs with (`callWindowOfCall`).
 */
export interface CallWindowRow {
  readonly kind: 'call-window';
  readonly turn: number;
  readonly iteration: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly how: CallWindow['how'];
  /** The index of the tool's form the call used (filled into, or read back from). */
  readonly form?: number;
  readonly asked?: TimeRange;
  readonly person?: PersonWindow;
  readonly by?: 'quote' | 'value';
  readonly rounded?: true;
  readonly why?: 'no-window' | 'several-mentions' | 'open-reading' | 'no-exact-form';
  /** A widened fill: the range the tool reads with the sent values. */
  readonly sent?: TimeRange;
  /** A widened fill the tool does not trim: the parts read but not asked. */
  readonly differs?: { readonly extra: readonly TimeRange[] };
  /** A widened fill to a tool that declares `filtersToAsked`. */
  readonly trimmedByTool?: true;
  readonly partlyBeyondRetention?: true;
  /** Why the call was refused before dispatch. */
  readonly refused?: TimeRefusal;
  /** On a `dst-gap` refusal: the argument whose wall time the zone skips. */
  readonly argument?: string;
}

/**
 * The answer's values the library itself spelled from a time reading of this
 * turn (§ 9.5, step T7) — an implied year, an offset, the end-of-grain
 * minute, a value of the served time line. The lineage `derived-from-reading`:
 * the answer's standing reads it as "not sure" at most, never "known", and the
 * gate never calls these invented.
 */
export interface TimeDerivedRow {
  readonly kind: 'time-derived';
  readonly turn: number;
  readonly iteration: number;
  /** The values as the gate reports them — normalized, clipped, at most `MAX_DERIVED_VALUES`. */
  readonly values: readonly string[];
}

/**
 * A wall-clock source (§ 9.6, step T8): the call minted a dataset whose
 * declared time axis (`axis.ts` · `DatasetTimeAxis`, its `zone`) says its rows are
 * wall times in `zone`. One row per call and zone. A period's offset is never
 * read as a clock — only a declared axis zone files this row.
 */
export interface SourceClockRow {
  readonly kind: 'source-clock';
  readonly turn: number;
  readonly iteration: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly zone: ZoneName;
}

/** Every time-layer row kind. */
export type TimeRow =
  | ClockRow
  | ClockOnResumeRow
  | CallRow
  | TimeReadingRow
  | CallWindowRow
  | TimeAnswerRow
  | TimeReplyRow
  | TimeDerivedRow
  | SourceClockRow;
