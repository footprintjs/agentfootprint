import type { InputField, InputValue } from '../../../../tools/inputRequest.js';
import type { PeriodSpelling } from '../../../../tools/declare.js';
import type { InstantText } from '../../../../time/instant.js';
import type { TimeAskMessages } from '../../../../time/ask.js';
import type { TimePolicy } from '../../../../time/resolve.js';
import type {
  CallWindowRow,
  TimeAnswerRow,
  TimeReadingRow,
  TimeReplyRow,
} from '../../../../time/rows.js';
import type { ZoneName } from '../../../../time/zone.js';
import type { AskWaiting } from '../pendingPrivateAsk.js';
import type { PartialWindowState } from '../partialWindow.js';
import type { ArgumentFill } from '../resolve.js';
import type { ArgumentRow } from '../rows.js';

// ─── The fields ─────────────────────────────────────────────────────────

/** One (tool, argument) an ask field's answer binds to, and the calls that need it. */
export interface AskMember {
  readonly toolName: string;
  readonly argument: string;
  /** Set on the argument `Tool.period` names. */
  readonly period?: true;
  /** The member's declared spelling, when its field is a shared period. */
  readonly spelling?: PeriodSpelling;
  /** Every call of the batch that needs this argument asked, in batch order. */
  readonly toolCallIds: readonly string[];
  /**
   * Under declared sources: the person's own words a READING was made of
   * (the first call's that carried one) — shown with the field, never the
   * model's value.
   */
  readonly quoted?: string;
}

/** One field of the batch's ask. */
export interface AskField {
  /** The typed ask's type — `integer` asks as `number`; the re-check judges the integer. */
  readonly type: InputField['type'];
  /** The first member's question — the field's `description`. */
  readonly question: string;
  /** The first member's choices' values — the field's `enum`. Absent: a free field. */
  readonly choices?: readonly InputValue[];
  /** The first member's spelling, when the field is a period shared across spellings. */
  readonly spelling?: PeriodSpelling;
  /** The (tool, argument) pairs the answer binds to; more than one only for a shared period. */
  readonly members: readonly AskMember[];
  /**
   * Set on the ONE field that asks which window the person's own words meant
   * (the lazy word-driven ask, time design § 5.2, § 6.3): its members are the
   * period arguments of every call that left its period out while the turn's
   * one mention was still open; the answer is a window (or, first, the zone
   * the person meant by an abbreviation), converted into each call's form.
   */
  readonly window?: WindowAskField;
}

/** One call's values from a bound window — and whether they read a WIDER window (no form held it exactly). */
export interface WindowFill {
  readonly values: Readonly<Record<string, unknown>>;
  readonly wider?: 'reads-more' | 'tool-trims';
}

/** The time half of a window field — the typed ask's `format`, its labels, and the mention asked about. */
export interface WindowAskField {
  /** New native pauses require the writer runtime/configuration. Absent means legacy fill. */
  readonly role?: 'confirm-meaning';
  /** These calls keep their selected arguments; other members retain the ordinary window-fill role. */
  readonly confirmOnlyIds?: readonly string[];
  readonly reply?: { readonly version: 1; readonly description: string };
  /** Updated proposals stay in the existing governed ask carrier. */
  readonly reading?: TimeReadingRow;
  /** The pending proposal supersedes the original reading; raw data stays in this carrier. */
  readonly corrected?: true;
  readonly format: 'time-range' | 'zone';
  /** One label per choice (`time-range` with choices only), in the reader's locale. */
  readonly labels?: readonly string[];
  /** Per choice, the zone the candidate was read in — a wall or date form is written in it. */
  readonly zones?: readonly ZoneName[];
  /** The mention's index on its `time-reading` row. */
  readonly mention: number;
}

/** Per field (same positions as the fields): how often asked, and how it settled. */
export interface AskProgress {
  /** Meaning was accepted, but these missing-window calls could not read it. */
  readonly refused?: Readonly<Record<string, string>>;
  /** How many declarations this field has been put in. */
  readonly rounds: number;
  /** The bound answer, raw, in the field's own spelling. */
  readonly answer?: InputValue;
  /** The last answer did not fit the property's schema and the field is to be asked again. */
  readonly invalid?: true;
  /** Asked `MAX_ASK_ROUNDS` times without an answer that fits — its calls are refused. */
  readonly exhausted?: true;
  /** What the last answer that did not fit failed — the property schema's own expectation, never the answer. */
  readonly expected?: string;
  /**
   * A window field only: the bound window converted into each call's form, by
   * call id — the values the call runs with (raw working state, never a row).
   */
  readonly fills?: Readonly<Record<string, WindowFill>>;
  /** A window field only: the zone was answered and a follow-up question about the same words is to be asked. */
  readonly next?: true;
}

/** The ask now out, waiting for the person's answer. */

/**
 * The batch ask's working state (`AgentState.argumentAsk`), written by the
 * dispatch stage only. It holds the RAW answers bound so far, because the calls
 * must run with them — the same class as `argumentResolutions`: never a row, an
 * event or a lens view.
 */
export interface ArgumentAskState {
  /** Durable ownership of partial-origin calls, separate from ordinary argument progress. */
  readonly partial?: PartialWindowState;
  /** The batch this ask belongs to — the iteration its calls were emitted in. */
  readonly iteration: number;
  readonly fields: readonly AskField[];
  readonly progress: readonly AskProgress[];
  /** Present exactly while a question is out; absent once every field settled. */
  readonly waiting?: AskWaiting;
}

/** One call's `ask` arguments, as the layer's Resolve stage named them. */
export interface CallAsk {
  readonly toolCallId: string;
  readonly ask: readonly string[];
  /** Under declared sources: the person's words a reading was made of, per argument. */
  readonly quoted?: readonly { readonly argument: string; readonly quote: string }[];
  /** Under `.time({ reader })`: the call left its period out while the turn's one mention was open. */
  readonly window?: true;
}

/**
 * The lazy word-driven ask's plan (time design § 5.2): the question the open
 * mention needs (`time/readingAsk.ts` · `timeAskOf`) and its mention index.
 * Handed by the stage glue only when the turn's one mention is open.
 */
export interface WindowAskPlan {
  readonly question: string;
  readonly reply?: { readonly version: 1; readonly description: string };
  readonly format: 'time-range' | 'zone';
  readonly choices?: readonly string[];
  readonly labels?: readonly string[];
  readonly zones?: readonly ZoneName[];
  readonly mention: number;
  /** The turn's clock — a choice outside a member tool's declared facts is not offered (§ 6.3). */
  readonly now: InstantText;
  /** The turn's clock zone — a choice with no zone of its own is converted in it. */
  readonly zone?: ZoneName;
  /** The app's `.time({ zone })`, for a form that declares `wallZone: 'app'`. */
  readonly appZone?: ZoneName;
}

/** A JSON object — the shape the host hook must return. */
export type AskContextObject = Readonly<Record<string, unknown>>;

/** Under `.time()`: the turn's clock and the app's zone — what a period answer is judged against. */
export interface AskTime {
  readonly now: InstantText;
  readonly appZone?: ZoneName;
  /** The turn's clock zone — a window answered with no zone of its own is written in it. */
  readonly zone?: ZoneName;
  /**
   * The turn's clock zone is UNKNOWN (`zoneSource: 'unknown'`, G15): `zone` is
   * only the UTC spelling, and a zone answer is the person's own zone — the
   * mention is re-read in it.
   */
  readonly zoneUnknown?: true;
  /**
   * Under `.time({ reader })`: the open mention's row, the policy and the
   * whole catalog — what a zone answer re-reads the mention with.
   */
  readonly reading?: {
    readonly row: TimeReadingRow;
    readonly policy: TimePolicy;
    readonly messages: TimeAskMessages;
  };
}

/** What binding one answer did: the new state and the rows it files. */
export interface BoundAnswer {
  readonly state: ArgumentAskState;
  /**
   * `answered` rows for bound fields; `asked: 'invalid-answer'` rows for fields
   * asked again or exhausted; and, for a bound WINDOW field, the `time-answer`
   * row that settles its mention for the rest of the turn (`time/rows.ts`)
   * and one `call-window` row per call it filled — `filled` from the person's
   * answered window, exactly or wider (`sent`, `differs.extra`).
   */
  readonly rows: readonly (ArgumentRow | TimeAnswerRow | CallWindowRow | TimeReplyRow)[];
}

/** What the settled ask hands the batch, per call: the answered fills and the exhausted arguments. */
export interface SettledCall {
  readonly fills: readonly ArgumentFill[];
  /** The arguments whose answers never fit — the call is refused — with what they failed. */
  readonly exhausted: readonly { readonly argument: string; readonly expected?: string }[];
}
