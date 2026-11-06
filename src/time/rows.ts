/**
 * time/rows — the time layer's rows on the one honesty ledger
 * (`AgentState.findingsLedger`), and the checkpoint door's test for each.
 *
 * Pattern: one owner of each row's shape (the `coverage/period.ts` ·
 *          `periodRowIsWellFormed` precedent): the module that defines a row
 *          also answers "is this a row I would have filed?", so the
 *          checkpoint door (`core/runCheckpoint.ts` · `ledgerRowIsWellFormed`)
 *          refuses exactly what the library never files.
 * Role:    L0 leaf (the time layer). Imports `instant.ts`, `zone.ts`,
 *          `range.ts`, `reader.ts` (the parts check), `resolveRecord.ts` (the
 *          candidate and choice checks), `convert.ts` (the refusal codes) and
 *          `clock.ts`' and `bind.ts`' types only — the rows are plain records
 *          the agent loop files (`agent/stages/timeLayer.ts`, the inputs
 *          layer). Their BUILDERS live in `rowsBuild.ts` — never re-exported
 *          here: they reach the resolver, which only an armed agent loads,
 *          while this module is on the checkpoint door's synchronous path.
 * Emits:   N/A — the rows fire no event of their own (the `conflict` row's
 *          precedent: no event field ships without a reader in the same
 *          release). The lens reads the rows.
 *
 * Eight kinds, each filed only while `.time()` is armed:
 *
 * | Kind | Filed | Carries |
 * |------|-------|---------|
 * | `clock` | once per turn, by seed | the turn's {@link ClockRow} and, when the run passed one, the `control` window |
 * | `clock-on-resume` | first thing in the resumed leg's ToolCalls stage — either pause shape: the pausable resume door, or the stage re-run an `interrupt()` pause makes — when a resume passed a `time` that differs from the kept clock | what was passed and what was kept — the kept clock still rules |
 * | `call` | once per dispatched call, just before the tool runs | `dispatchedAt`: the wall clock at dispatch (a look-back is evaluated by the TOOL at dispatch, which after a pause is later than `now`); `drift` when a look-back was sent more than the tool's step after `now` — `redrawn` into an absolute form, or `shifted` (§ 7.4, `drift.ts`) |
 * | `call-window` | by the inputs layer, once per call to a tool that declares period forms, before it dispatches | which window the call carries: filled from the turn's one window (exactly, or wider — with what the read adds), bound to one (by quote or value), the model's own (beside the person's when it differs), unread, not filled and why, or refused before dispatch and why |
 * | `time-reading` | by seed, once per MENTION the armed reader (`.time({ reader })`) found in the person's message — or ONE row with `mentions: 0` when it found none, so a retry knows the message was read | the quote, the parts, every candidate `resolve.ts` made of them, how the reading settled (`choice` — never settled by the library: every reading is a PROPOSAL, `open` with `confirm`, its candidates `said: []`), the reader's id, version, kind and locale, and the tz database version; a refused mention keeps only why |
 * | `time-answer` | by the batch ask, once per mention the person settled in the time ask — the only door by which a window of words becomes the person's | the mention, the window and its zone, and `how`: `confirmed` (they picked a reading the library offered — the click) or `edited` (they wrote their own) |
 * | `time-derived` | by the Route decider, once per judged answer that stands, when the evidence gate found values no tool result carried that the library itself spelled from this turn's time readings (§ 9.5, step T7 — `forms.ts` · `timeFormsOf`'s `derived` list) | the values, normalized and clipped as the gate reports them — the lineage `derived-from-reading`: never invented, never the person's |
 * | `source-clock` | by ToolCalls, once per call and zone, when the call minted a dataset whose declared time axis names a `zone` (§ 9.6, step T8) | the tool, the call and the zone its rows' wall times are in — read by the limits block's `Clocks` lines and `check.ts` · `clocksDiffer` |
 *
 * Readers that switch over every row kind must skip one they do not know.
 */

import { isTimeReplyEvidence, type TimeReplyEvidence } from './replyRecord.js';
import { instantOf } from './instant.js';
import { isTimeRange, type TimeRange } from './range.js';
import { isZoneName, type ZoneName } from './zone.js';
import { isTimeParts, type TimeParts } from './reader.js';
import { TIME_REFUSALS, type TimeRefusal } from './periodForm.js';
import { candidateIsWellFormed, choiceIsWellFormed } from './resolveRecord.js';
import type {
  CallRow,
  CallWindowRow,
  ClockRow,
  SourceClockRow,
  TimeAnswerRow,
  TimeDerivedRow,
  TimeReadingRow,
  TimeReplyRow,
  TimeRow,
} from './rows/types.js';
export type {
  ControlWindow,
  ClockRow,
  ClockOnResumeRow,
  CallRow,
  CallDrift,
  TimeReaderStamp,
  TimeReadingRow,
  TimeAnswerRow,
  TimeReplyRow,
  PersonWindow,
  CallWindowRow,
  TimeDerivedRow,
  SourceClockRow,
  TimeRow,
} from './rows/types.js';

export function timeReplyRow(
  evidence: TimeReplyEvidence,
  at: { readonly turn: number; readonly iteration: number },
  mention: number,
): TimeReplyRow {
  return { kind: 'time-reply', ...at, mention, ...evidence };
}

/** The most values one `time-derived` row carries (the gate's report bound). */
export const MAX_DERIVED_VALUES = 12;

/** The longest value a `time-derived` row carries (the gate's clip). */
export const MAX_DERIVED_VALUE_CHARS = 64;

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

/** The `time-answer` row for one window the person settled in the time ask. */
export function timeAnswerRow(
  answer: {
    readonly mention: number;
    readonly range: TimeRange;
    readonly zone: ZoneName;
    readonly how: 'confirmed' | 'edited';
  },
  at: { readonly turn: number; readonly iteration: number },
): TimeAnswerRow {
  return {
    kind: 'time-answer',
    turn: at.turn,
    iteration: at.iteration,
    mention: answer.mention,
    from: answer.range.from,
    to: answer.range.to,
    zone: answer.zone,
    how: answer.how,
  };
}

/** The `time-derived` row for one judged answer — `values` cut to {@link MAX_DERIVED_VALUES}. */
export function timeDerivedRow(
  values: readonly string[],
  at: { readonly turn: number; readonly iteration: number },
): TimeDerivedRow {
  return {
    kind: 'time-derived',
    turn: at.turn,
    iteration: at.iteration,
    values: values.slice(0, MAX_DERIVED_VALUES),
  };
}

/** The `source-clock` row for one call's dataset whose declared axis names `zone`. */
export function sourceClockRow(
  call: { readonly toolCallId: string; readonly toolName: string },
  at: { readonly turn: number; readonly iteration: number },
  zone: ZoneName,
): SourceClockRow {
  return {
    kind: 'source-clock',
    turn: at.turn,
    iteration: at.iteration,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    zone,
  };
}

/** This turn's `call` row for one call — the last filed (a resumed leg files its own). */
export function callRowOfCall(
  ledger: readonly unknown[] | undefined,
  toolCallId: string,
  turn: number,
): CallRow | undefined {
  if (ledger === undefined) return undefined;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const r = ledger[i] as Partial<CallRow> | null;
    if (
      r !== null &&
      typeof r === 'object' &&
      r.kind === 'call' &&
      r.toolCallId === toolCallId &&
      r.turn === turn
    ) {
      return r as CallRow;
    }
  }
  return undefined;
}

/** The `source-clock` rows filed for `turn`, in the order filed. */
export function sourceClocksOf(
  ledger: readonly unknown[] | undefined,
  turn: number | undefined,
): readonly SourceClockRow[] {
  if (ledger === undefined) return [];
  return ledger.filter((row): row is SourceClockRow => {
    const r = row as { readonly kind?: unknown; readonly turn?: unknown } | null;
    return (
      r !== null &&
      typeof r === 'object' &&
      r.kind === 'source-clock' &&
      (turn === undefined || r.turn === turn)
    );
  });
}

/** The `time-answer` rows filed for `turn`, in the order filed. */
export function answersOf(
  ledger: readonly unknown[] | undefined,
  turn: number,
): readonly TimeAnswerRow[] {
  if (ledger === undefined) return [];
  return ledger.filter((row): row is TimeAnswerRow => {
    const r = row as { readonly kind?: unknown; readonly turn?: unknown } | null;
    return r !== null && typeof r === 'object' && r.kind === 'time-answer' && r.turn === turn;
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

/** Whether a mention's parses name no zone anywhere — the whole mention's or a range side's. */
const namesNoZone = (parses: readonly TimeParts[] | undefined): boolean =>
  (parses ?? []).every(
    (p) =>
      p.zoneToken === undefined &&
      p.rangeOf?.[0].zoneToken === undefined &&
      p.rangeOf?.[1].zoneToken === undefined,
  );

/**
 * The zone the person ANSWERED for themselves while the run's zone was
 * unknown (G15), latest first — or `undefined`. It is a `time-answer` filed in
 * a turn whose clock was `zoneSource: 'unknown'`, for a mention that named no
 * zone of its own (so the zone asked was the person's, not a token's
 * meaning), or a later turn's clock that already carries it
 * (`zoneSource: 'answered'`). Seed stamps it as the next turn's zone
 * (`stages/timeLayer.ts` · `stampClock`); the turn the answer was given in
 * keeps its clock, frozen, as every clock is.
 *
 * @example
 * ```ts
 * answeredZoneOf([clockUnknownTurn1, readingOfYesterday, answerInLosAngeles]); // 'America/Los_Angeles'
 * ```
 */
export function answeredZoneOf(ledger: readonly unknown[] | undefined): ZoneName | undefined {
  if (ledger === undefined) return undefined;
  const rows = ledger as readonly ({ readonly kind?: unknown } | null)[];
  const clockOfTurn = (turn: number): ClockRow | undefined =>
    rows.find(
      (r): r is ClockRow =>
        r !== null && typeof r === 'object' && r.kind === 'clock' && (r as ClockRow).turn === turn,
    );
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === null || typeof row !== 'object') continue;
    if (row.kind === 'clock' && (row as ClockRow).zoneSource === 'answered') {
      return (row as ClockRow).zone;
    }
    if (row.kind !== 'time-answer') continue;
    const answer = row as TimeAnswerRow;
    if (clockOfTurn(answer.turn)?.zoneSource !== 'unknown') continue;
    const reading = readingsOf(ledger, answer.turn).find((r) => r.mention === answer.mention);
    if (reading !== undefined && namesNoZone(reading.parses)) return answer.zone;
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
    (source === 'said' ||
      source === 'derived-from-reading' ||
      source === 'answered' ||
      source === 'control') &&
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
        // A skipped wall time names its argument and has no range. Every other refusal has a
        // range — except an OPEN reading the tool can read in no reading (`bind.ts` ·
        // `openReadingWindow`): no window was chosen, so it carries none, and no form or person.
        (row.refused === 'dst-gap'
          ? typeof row.argument === 'string' && formOk && row.asked === undefined
          : row.argument === undefined &&
            (row.asked === undefined
              ? row.form === undefined && row.person === undefined
              : askedOk))
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

/** A `time-answer` row: its mention, a range, a zone, `how` — and no other key. */
function isAnswerRow(row: Readonly<Record<string, unknown>>): boolean {
  const { kind: _k, turn: _t, iteration: _i, mention, zone, how, ...range } = row;
  void _k;
  void _t;
  void _i;
  return (
    isCount(mention) &&
    isZoneName(zone) &&
    (how === 'confirmed' || how === 'edited') &&
    isTimeRange(range)
  );
}

/** A `time-derived` row: one to `MAX_DERIVED_VALUES` non-empty values — and no other key. */
function isDerivedRow(row: Readonly<Record<string, unknown>>): boolean {
  const values = row.values;
  return (
    Object.keys(row).length === 4 &&
    Array.isArray(values) &&
    values.length >= 1 &&
    values.length <= MAX_DERIVED_VALUES &&
    values.every((v) => nonEmpty(v) && (v as string).length <= MAX_DERIVED_VALUE_CHARS)
  );
}

/**
 * The checkpoint door's test for a time-layer row — `true` only for a row of
 * one of the eight kinds with every field this module files, well formed.
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
        (row.zoneSource === 'run' ||
          row.zoneSource === 'builder' ||
          row.zoneSource === 'answered' ||
          row.zoneSource === 'unknown') &&
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
    case 'time-reply':
      return (
        Object.keys(row).length === 6 &&
        isCount(row.mention) &&
        isTimeReplyEvidence({ decision: row.decision, rule: row.rule })
      );
    case 'time-answer':
      return isAnswerRow(row);
    case 'time-derived':
      return isDerivedRow(row);
    case 'source-clock':
      return (
        typeof row.toolCallId === 'string' &&
        typeof row.toolName === 'string' &&
        isZoneName(row.zone)
      );
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
    kind === 'call-window' ||
    kind === 'time-answer' ||
    kind === 'time-reply' ||
    kind === 'time-derived' ||
    kind === 'source-clock'
  );
}

/** The zone the answer's lines are rendered in — the clock's (no reader is armed yet, so the run's). */
export function presentationZoneOf(ledger: readonly unknown[] | undefined): ZoneName | undefined {
  return clockOf(ledger)?.zone;
}
