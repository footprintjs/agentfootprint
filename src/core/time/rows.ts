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
 *          `range.ts` and `clock.ts` only — the rows are plain records the
 *          agent loop files (`stages/seed.ts`, `stages/toolCalls.ts`).
 * Emits:   N/A — the rows fire no event of their own (the `conflict` row's
 *          precedent: no event field ships without a reader in the same
 *          release). The lens reads the rows.
 *
 * Three kinds, each filed only while `.time()` is armed:
 *
 * | Kind | Filed | Carries |
 * |------|-------|---------|
 * | `clock` | once per turn, by seed | the turn's {@link TimeClock} and, when the run passed one, the `control` window |
 * | `clock-on-resume` | first thing in the resumed leg's ToolCalls stage — either pause shape: the pausable resume door, or the stage re-run an `interrupt()` pause makes — when a resume passed a `time` that differs from the kept clock | what was passed and what was kept — the kept clock still rules |
 * | `call` | once per dispatched call, just before the tool runs | `dispatchedAt`: the wall clock at dispatch (a look-back is evaluated by the TOOL at dispatch, which after a pause is later than `now`) |
 *
 * Readers that switch over every row kind must skip one they do not know.
 */

import { instantOf, type InstantText } from './instant.js';
import { isTimeRange, type TimeRange } from './range.js';
import { isZoneName, type ZoneName } from './zone.js';
import { clockChange, type ClockChange, type ReadRunTime, type TimeClock } from './clock.js';

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
}

/** Every time-layer row kind. */
export type TimeRow = ClockRow | ClockOnResumeRow | CallRow;

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
): CallRow {
  return {
    kind: 'call',
    turn: at.turn,
    iteration: at.iteration,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    dispatchedAt: new Date(nowMs).toISOString(),
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

// ─── Reading ─────────────────────────────────────────────────────────────

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

/**
 * The checkpoint door's test for a time-layer row — `true` only for a row of
 * one of the three kinds with every field this module files, well formed.
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
        isInstant(row.dispatchedAt)
      );
    default:
      return false;
  }
}

/** Whether a ledger row is one of the time layer's kinds (the router's question). */
export function isTimeRowKind(kind: unknown): kind is TimeRow['kind'] {
  return kind === 'clock' || kind === 'clock-on-resume' || kind === 'call';
}

/** The zone the answer's lines are rendered in — the clock's (no reader is armed yet, so the run's). */
export function presentationZoneOf(ledger: readonly unknown[] | undefined): ZoneName | undefined {
  return clockOf(ledger)?.zone;
}
