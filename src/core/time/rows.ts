/**
 * core/time/rows — the time layer's rows on the one honesty ledger
 * (`AgentState.findingsLedger`), and the checkpoint door's test for each.
 *
 * Pattern: one owner of each row's shape (the `coverage/period.ts` ·
 *          `periodRowIsWellFormed` precedent): the module that defines a row
 *          also answers "is this a row I would have filed?", so the
 *          checkpoint door (`core/runCheckpoint.ts` · `ledgerRowIsWellFormed`)
 *          refuses exactly what the library never files.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `zone.ts`,
 *          `range.ts`, `clock.ts`, `reader.ts`, `resolve.ts`, `convert.ts` (the refusal codes) and `bind.ts`' types only — the
 *          rows are plain records the agent loop files (`stages/seed.ts`,
 *          `stages/toolCalls.ts`).
 * Emits:   N/A — the rows fire no event of their own (the `conflict` row's
 *          precedent: no event field ships without a reader in the same
 *          release). The lens reads the rows.
 *
 * Five kinds, each filed only while `.time()` is armed:
 *
 * | Kind | Filed | Carries |
 * |------|-------|---------|
 * | `clock` | once per turn, by seed | the turn's {@link TimeClock} and, when the run passed one, the `control` window |
 * | `clock-on-resume` | first thing in the resumed leg's ToolCalls stage — either pause shape: the pausable resume door, or the stage re-run an `interrupt()` pause makes — when a resume passed a `time` that differs from the kept clock | what was passed and what was kept — the kept clock still rules |
 * | `call` | once per dispatched call, just before the tool runs | `dispatchedAt`: the wall clock at dispatch (a look-back is evaluated by the TOOL at dispatch, which after a pause is later than `now`); `drift` when a look-back was sent more than the tool's step after `now` — `redrawn` into an absolute form, or `shifted` (§ 7.4, `drift.ts`) |
 * | `call-window` | by the inputs layer, once per call to a tool that declares period forms, before it dispatches | which window the call carries: filled from the turn's one window (exactly, or wider — with what the read adds), bound to one (by quote or value), the model's own (beside the person's when it differs), unread, not filled and why, or refused before dispatch and why |
 * | `time-reading` | by seed, once per MENTION the armed reader (`.time({ reader })`) found in the person's message — or ONE row with `mentions: 0` when it found none, so a retry knows the message was read | the quote, the parts, every candidate `resolve.ts` made of them, how the reading settled (`choice`), the reader's id, version, kind and locale, and the tz database version; a refused mention keeps only why |
 *
 * Readers that switch over every row kind must skip one they do not know.
 */

import { instantOf, type InstantText } from './instant.js';
import { isTimeRange, type TimeRange } from './range.js';
import { isZoneName, type ZoneName } from './zone.js';
import { clockChange, type ClockChange, type ReadRunTime, type TimeClock } from './clock.js';
import { isTimeParts, type CheckedMention, type MentionRefusal, type TimeParts } from './reader.js';
import type { CallWindow, TurnWindow, WindowSource } from './bind.js';
import { TIME_REFUSALS, type TimeRefusal } from './convert.js';
import {
  candidateIsWellFormed,
  chooseReading,
  choiceIsWellFormed,
  resolveMention,
  type ReadingChoice,
  type TimeCandidate,
  type TimePolicy,
} from './resolve.js';

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

/** The person's window a `call-window` row names — its range, who gave it, and its mention. */
export interface PersonWindow extends TimeRange {
  readonly source: WindowSource;
  /** The `time-reading` row's mention index — absent on a `control` window. */
  readonly mention?: number;
}

/**
 * Which window one call to a tool that declares period forms carries (time
 * design § 7.3) — one row per such call, filed by the inputs layer beside the
 * call's `argument` rows, before the call dispatches.
 *
 * | `how` | Means |
 * |-------|-------|
 * | `filled` | the model left the period out; the turn's one window (`person`) went into form `form` exactly (`rounded`: an epoch-seconds bound or a look-back's length moved outward) |
 * | `bound` | the sent window IS the person's window `person` — named by the model's quote (`by: 'quote'`) or equal in value (`by: 'value'`) |
 * | `model-chosen` | the sent window (`asked`) differs from the person's (`person`, when one window is theirs): it ran as sent (the v1 law) |
 * | `model` | the sent window, and no window of the person's this turn |
 * | `unread` | a period argument was sent and no form reads the call back as a range |
 * | `not-filled` | the period was left out and nothing was filled (`why`) — the tool's own rule applied |
 * | `refused` | refused before dispatch (`refused`: a fact the window breaks, `multi-day`, `dst-gap` with its `argument`) — the call did not run |
 *
 * `asked` is the half-open range the call asks for: the person's on a fill,
 * the sent value read back otherwise — what `ctx.time.asked` hands the tool.
 * A WIDENED fill (no form holds the window exactly — § 7.2) carries `sent`,
 * the range the tool reads, and either `differs.extra` (the parts read but
 * not asked — `period-differs-from-asked`) or `trimmedByTool` (the tool
 * declares `filtersToAsked`). `partlyBeyondRetention` marks a window that
 * starts before the source's oldest data and ends after it: it dispatched.
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

/** Every time-layer row kind. */
export type TimeRow = ClockRow | ClockOnResumeRow | CallRow | TimeReadingRow | CallWindowRow;

// ─── Building ────────────────────────────────────────────────────────────

/** The clock stamp for one turn. */
export function clockRow(
  clock: TimeClock,
  at: { readonly turn: number; readonly iteration: number },
  window?: TimeRange,
): ClockRow {
  return {
    kind: 'clock',
    turn: at.turn,
    iteration: at.iteration,
    now: clock.now,
    nowSource: clock.nowSource,
    zone: clock.zone,
    zoneSource: clock.zoneSource,
    ...(window !== undefined && {
      window: { from: window.from, to: window.to, source: 'control' as const },
    }),
  };
}

/**
 * The row for one dispatched call. `nowMs` is the wall clock — the second of
 * the layer's two recorded wall-clock reads (the first is a default `now`).
 */
export function callRow(
  call: { readonly toolCallId: string; readonly toolName: string },
  at: { readonly turn: number; readonly iteration: number },
  nowMs: number,
  drift?: CallDrift,
): CallRow {
  return {
    kind: 'call',
    turn: at.turn,
    iteration: at.iteration,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    dispatchedAt: new Date(nowMs).toISOString(),
    ...(drift !== undefined && { drift }),
  };
}

/**
 * The row for a resume whose passed `time` differs from the turn's kept clock
 * (`clock.ts` · `clockChange`), or `undefined` when nothing differs. The kept
 * clock is the turn's `clock` row; it is never replaced.
 */
export function clockOnResumeRow(
  passed: ReadRunTime,
  kept: ClockRow,
  at: { readonly turn: number; readonly iteration: number },
): ClockOnResumeRow | undefined {
  const change = clockChange(passed, {
    now: kept.now,
    zone: kept.zone,
    ...(kept.window !== undefined && { window: { from: kept.window.from, to: kept.window.to } }),
  });
  if (change === undefined) return undefined;
  return {
    kind: 'clock-on-resume',
    turn: at.turn,
    iteration: at.iteration,
    passed: change.passed,
    kept: change.kept,
  };
}

/**
 * The `time-reading` rows for one checked reading (`reader.ts` ·
 * `checkReading`): one per mention, resolved against the turn's clock and
 * settled under the policy — or one `mentions: 0` row.
 */
export function timeReadingRows(input: {
  readonly mentions: readonly CheckedMention[];
  readonly clock: TimeClock;
  readonly policy: TimePolicy;
  readonly reader: TimeReaderStamp;
  readonly tzdata: string;
  readonly at: { readonly turn: number; readonly iteration: number };
}): TimeReadingRow[] {
  const { mentions, clock, policy, reader, tzdata, at } = input;
  const base = {
    kind: 'time-reading' as const,
    turn: at.turn,
    iteration: at.iteration,
    reader: { id: reader.id, version: reader.version, kind: reader.kind, locale: reader.locale },
    tzdata,
    mentions: mentions.length,
  };
  if (mentions.length === 0) return [base];
  return mentions.map((m, mention) => {
    if ('refused' in m) return { ...base, mention, refused: m.refused };
    const resolution = resolveMention(m.parses, clock, { id: reader.id, kind: reader.kind });
    return {
      ...base,
      mention,
      quote: m.quote,
      parses: m.parses,
      ...(m.problem !== undefined && { problem: m.problem }),
      candidates: resolution.candidates,
      choice: chooseReading(resolution, policy, reader.kind, m.problem),
    };
  });
}

const personOf = (w: TurnWindow): PersonWindow => ({
  from: w.range.from,
  to: w.range.to,
  source: w.source,
  ...(w.mention !== undefined && { mention: w.mention }),
});

/** The `call-window` row for one call's decision (`bind.ts` · `callWindowOf`). */
export function callWindowRow(
  call: { readonly toolCallId: string; readonly toolName: string },
  decision: CallWindow,
  at: { readonly turn: number; readonly iteration: number },
): CallWindowRow {
  const base = {
    kind: 'call-window' as const,
    turn: at.turn,
    iteration: at.iteration,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    how: decision.how,
  };
  const partly =
    'partlyBeyondRetention' in decision && decision.partlyBeyondRetention === true
      ? { partlyBeyondRetention: true as const }
      : {};
  switch (decision.how) {
    case 'filled': {
      const c = decision.conversion;
      const widened = 'sent' in c ? c : undefined;
      return {
        ...base,
        form: c.form,
        asked: { from: decision.window.range.from, to: decision.window.range.to },
        person: personOf(decision.window),
        ...(c.rounded === true && { rounded: true as const }),
        ...(widened !== undefined && { sent: widened.sent }),
        ...(widened !== undefined &&
          (decision.trimmedByTool === true
            ? { trimmedByTool: true as const }
            : { differs: { extra: widened.extra } })),
        ...partly,
      };
    }
    case 'bound':
      return {
        ...base,
        form: decision.form,
        asked: decision.asked,
        person: personOf(decision.window),
        by: decision.by,
        ...partly,
      };
    case 'model-chosen':
      return {
        ...base,
        form: decision.form,
        asked: decision.asked,
        ...(decision.person !== undefined && { person: personOf(decision.person) }),
        ...partly,
      };
    case 'model':
      return { ...base, form: decision.form, asked: decision.asked, ...partly };
    case 'unread':
      return base;
    case 'not-filled':
      return { ...base, why: decision.why };
    case 'refused':
      return {
        ...base,
        refused: decision.refused,
        ...(decision.form !== undefined && { form: decision.form }),
        ...(decision.asked !== undefined && { asked: decision.asked }),
        ...(decision.person !== undefined && { person: personOf(decision.person) }),
        ...(decision.argument !== undefined && { argument: decision.argument }),
      };
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────

/** This turn's `call-window` row for one call, if the inputs layer filed one — `ctx.time` reads it. */
export function callWindowOfCall(
  ledger: readonly unknown[] | undefined,
  toolCallId: string,
  turn: number,
): CallWindowRow | undefined {
  if (ledger === undefined) return undefined;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const r = ledger[i] as Partial<CallWindowRow> | null;
    if (
      r !== null &&
      typeof r === 'object' &&
      r.kind === 'call-window' &&
      r.toolCallId === toolCallId &&
      r.turn === turn
    ) {
      return r as CallWindowRow;
    }
  }
  return undefined;
}

/** The `time-reading` rows filed for `turn` — read back on a resume or a retry, never re-read. */
export function readingsOf(
  ledger: readonly unknown[] | undefined,
  turn: number,
): readonly TimeReadingRow[] {
  if (ledger === undefined) return [];
  return ledger.filter((row): row is TimeReadingRow => {
    const r = row as { readonly kind?: unknown; readonly turn?: unknown } | null;
    return r !== null && typeof r === 'object' && r.kind === 'time-reading' && r.turn === turn;
  });
}

/**
 * The clock of the LATEST turn on the ledger — the last `clock` row — or
 * `undefined` when none was filed (an agent without `.time()`, or a turn
 * paused by a runtime that had none). A continued conversation carries one
 * row per turn; the last one is this turn's, because each turn's seed files
 * exactly one (last in seed, before any stage of the turn can read it).
 */
export function clockOf(ledger: readonly unknown[] | undefined): ClockRow | undefined {
  if (ledger === undefined) return undefined;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const row = ledger[i] as { readonly kind?: unknown } | null;
    if (row !== null && typeof row === 'object' && row.kind === 'clock') return row as ClockRow;
  }
  return undefined;
}

// ─── The checkpoint door ─────────────────────────────────────────────────

const isInstant = (value: unknown): boolean => instantOf(value, 'strict') !== undefined;
const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isKept(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const k = value as Record<string, unknown>;
  return (
    isInstant(k.now) && isZoneName(k.zone) && (k.window === undefined || isTimeRange(k.window))
  );
}

function isPassed(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  const keys = Object.keys(p);
  return (
    keys.length > 0 &&
    keys.every((k) => k === 'now' || k === 'zone' || k === 'window') &&
    (p.now === undefined || isInstant(p.now)) &&
    (p.zone === undefined || isZoneName(p.zone)) &&
    (p.window === undefined || isTimeRange(p.window))
  );
}

function isControlWindow(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { source, ...range } = value as Record<string, unknown>;
  return source === 'control' && isTimeRange(range);
}

const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value.length > 0;

function isReaderStamp(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).length === 4 &&
    nonEmpty(r.id) &&
    nonEmpty(r.version) &&
    nonEmpty(r.locale) &&
    (r.kind === 'rule' || r.kind === 'model')
  );
}

const MENTION_FIELDS = ['mention', 'quote', 'parses', 'problem', 'refused', 'candidates', 'choice'];

function isReadingRow(row: Readonly<Record<string, unknown>>): boolean {
  if (!isReaderStamp(row.reader) || !nonEmpty(row.tzdata) || !isCount(row.mentions)) return false;
  const mentions = row.mentions as number;
  if (mentions === 0) return MENTION_FIELDS.every((k) => row[k] === undefined);
  if (!isCount(row.mention) || (row.mention as number) >= mentions) return false;
  if (row.refused !== undefined) {
    return (
      (row.refused === 'quote-not-in-text' || row.refused === 'malformed') &&
      ['quote', 'parses', 'problem', 'candidates', 'choice'].every((k) => row[k] === undefined)
    );
  }
  const parses = row.parses;
  const candidates = row.candidates;
  return (
    nonEmpty(row.quote) &&
    Array.isArray(parses) &&
    parses.every((p) => isTimeParts(p)) &&
    (row.problem === undefined || (row.problem === 'unreadable' && parses.length === 0)) &&
    Array.isArray(candidates) &&
    candidates.every(candidateIsWellFormed) &&
    choiceIsWellFormed(row.choice, candidates.length)
  );
}

const HOWS = ['filled', 'bound', 'model-chosen', 'model', 'unread', 'not-filled', 'refused'];
const WHYS = ['no-window', 'several-mentions', 'open-reading', 'no-exact-form'];

function isPersonWindow(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { source, mention, ...range } = value as Record<string, unknown>;
  return (
    (source === 'said' || source === 'derived-from-reading' || source === 'control') &&
    (mention === undefined || isCount(mention)) &&
    (source === 'control') === (mention === undefined) &&
    isTimeRange(range)
  );
}

function isRangeList(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(isTimeRange);
}

/** A widened fill's fields: `sent` with exactly one of `differs` / `trimmedByTool`, or none of the three. */
function widenedOk(row: Readonly<Record<string, unknown>>): boolean {
  if (row.sent === undefined) return row.differs === undefined && row.trimmedByTool === undefined;
  if (!isTimeRange(row.sent)) return false;
  if (row.trimmedByTool !== undefined)
    return row.trimmedByTool === true && row.differs === undefined;
  const differs = row.differs;
  if (differs === null || typeof differs !== 'object' || Array.isArray(differs)) return false;
  const d = differs as Record<string, unknown>;
  return Object.keys(d).length === 1 && isRangeList(d.extra);
}

function isCallWindowRow(row: Readonly<Record<string, unknown>>): boolean {
  if (typeof row.toolCallId !== 'string' || typeof row.toolName !== 'string') return false;
  if (!HOWS.includes(row.how as string)) return false;
  const has = (k: string): boolean => row[k] !== undefined;
  const only = (...keys: string[]): boolean =>
    [
      'form',
      'asked',
      'person',
      'by',
      'rounded',
      'why',
      'sent',
      'differs',
      'trimmedByTool',
      'partlyBeyondRetention',
      'refused',
      'argument',
    ].every((k) => keys.includes(k) || !has(k));
  const formOk = isCount(row.form);
  const askedOk = isTimeRange(row.asked);
  const partlyOk = row.partlyBeyondRetention === undefined || row.partlyBeyondRetention === true;
  switch (row.how) {
    case 'filled':
      return (
        only(
          'form',
          'asked',
          'person',
          'rounded',
          'sent',
          'differs',
          'trimmedByTool',
          'partlyBeyondRetention',
        ) &&
        formOk &&
        askedOk &&
        isPersonWindow(row.person) &&
        (row.rounded === undefined || row.rounded === true) &&
        widenedOk(row) &&
        partlyOk
      );
    case 'bound':
      return (
        only('form', 'asked', 'person', 'by', 'partlyBeyondRetention') &&
        formOk &&
        askedOk &&
        isPersonWindow(row.person) &&
        (row.by === 'quote' || row.by === 'value') &&
        partlyOk
      );
    case 'model-chosen':
      return (
        only('form', 'asked', 'person', 'partlyBeyondRetention') &&
        formOk &&
        askedOk &&
        (row.person === undefined || isPersonWindow(row.person)) &&
        partlyOk
      );
    case 'model':
      return only('form', 'asked', 'partlyBeyondRetention') && formOk && askedOk && partlyOk;
    case 'unread':
      return only();
    case 'refused':
      return (
        only('form', 'asked', 'person', 'refused', 'argument') &&
        TIME_REFUSALS.includes(row.refused as TimeRefusal) &&
        (row.form === undefined || formOk) &&
        (row.asked === undefined || askedOk) &&
        (row.person === undefined || isPersonWindow(row.person)) &&
        // A skipped wall time names its argument and has no range; every other refusal has a range.
        (row.refused === 'dst-gap'
          ? typeof row.argument === 'string' && formOk && row.asked === undefined
          : row.argument === undefined && askedOk)
      );
    default:
      return only('why') && WHYS.includes(row.why as string);
  }
}

function isCallDrift(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  if (typeof d.byMs !== 'number' || !Number.isSafeInteger(d.byMs) || d.byMs === 0) return false;
  if (d.outcome === 'redrawn') return Object.keys(d).length === 3 && isCount(d.form);
  return d.outcome === 'shifted' && Object.keys(d).length === 2;
}

/**
 * The checkpoint door's test for a time-layer row — `true` only for a row of
 * one of the five kinds with every field this module files, well formed.
 * Any other kind answers `false` (the caller routes by kind first).
 */
export function timeRowIsWellFormed(row: Readonly<Record<string, unknown>>): boolean {
  if (!isCount(row.turn) || !isCount(row.iteration)) return false;
  switch (row.kind) {
    case 'clock':
      return (
        isInstant(row.now) &&
        (row.nowSource === 'app' || row.nowSource === 'default') &&
        isZoneName(row.zone) &&
        (row.zoneSource === 'run' || row.zoneSource === 'builder') &&
        (row.window === undefined || isControlWindow(row.window))
      );
    case 'clock-on-resume':
      return isPassed(row.passed) && isKept(row.kept);
    case 'call':
      return (
        typeof row.toolCallId === 'string' &&
        typeof row.toolName === 'string' &&
        isInstant(row.dispatchedAt) &&
        (row.drift === undefined || isCallDrift(row.drift))
      );
    case 'time-reading':
      return isReadingRow(row);
    case 'call-window':
      return isCallWindowRow(row);
    default:
      return false;
  }
}

/** Whether a ledger row is one of the time layer's kinds (the router's question). */
export function isTimeRowKind(kind: unknown): kind is TimeRow['kind'] {
  return (
    kind === 'clock' ||
    kind === 'clock-on-resume' ||
    kind === 'call' ||
    kind === 'time-reading' ||
    kind === 'call-window'
  );
}

/** The zone the answer's lines are rendered in — the clock's (no reader is armed yet, so the run's). */
export function presentationZoneOf(ledger: readonly unknown[] | undefined): ZoneName | undefined {
  return clockOf(ledger)?.zone;
}
