/**
 * core/time/check — the result checks (time design § 9.2, § 9.4, § 9.6, step T8).
 *
 * Pattern: one pure check per judged call, over what the record already holds
 *          — the call's `call-window` row (what the call asked, and the
 *          person's window beside it), its `call` row (the clock at
 *          dispatch), the periods its result declared, and the tool's facts —
 *          and one pure read over the turn's wall-clock sources. None reads
 *          words; none reads a period's offset as a clock.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `range.ts`,
 *          `convert.ts` and the row types of `rows.ts`. Asked by the results
 *          layer (`results/subflow.ts` · `checkPeriods`), which files the
 *          answer on the call's `period` row (`coverage/period.ts` ·
 *          `PeriodRow`), and by the limits block (`coverage/period.ts` ·
 *          `periodCheckLine`, `clockLines`).
 * Emits:   N/A.
 *
 * ## Differs from asked — ONE check for narrower, wider and shifted (§ 9.2)
 *
 * The range the call asked for is compared with the range it READ, and two
 * lists come back: `missing` (asked but not read — a narrower read, or the
 * front of a shifted one) and `extra` (read but not asked — a wider read, or
 * the tail of a shifted one). What was read, first found wins:
 *
 * | Source | The read |
 * |--------|----------|
 * | `declared` | the result's own `period.queried` — inclusive at both ends, read back as `[from, to + step)`, `step` the tool's `granularity` (else 1 ms; § 3.3). Several declared: each is a read |
 * | `sent` | a widened fill the tool does not trim — the `call-window` row's `sent` |
 * | `shifted` | a look-back that ran as sent after the clock moved past the tool's step — the asked range moved by the `call` row's `drift.byMs` |
 * | `asked` | nothing says otherwise — the read IS the asked range (a fill, a binding, a redrawn look-back, a widened fill the tool trims) |
 *
 * Against what: the call's `asked` range — EXCEPT for a window the model
 * chose (`how: 'model-chosen'`), which is compared with the person's window
 * (§ 9.3: claims about the person's window are then "not sure"). A call with
 * neither — refused, not filled, unread — is not compared.
 *
 * Two differences are not differences: a piece no longer than one
 * millisecond (a closed end read as open — `[now − L, now]` against
 * `[now − L, now)`), and § 7.4's first row — a call that SENT a look-back
 * (`drift.ts` · `sentLookback`), with no drift recorded (the dispatch was
 * within the step), whose declared read has the asked length and moved LATER
 * by no more than the tool's step (one minute when none): the tool evaluated
 * the look-back on its own clock, a little after `now`, and that read IS the
 * asked range. Nothing else moves: a read moved EARLIER, a read of a window
 * sent as bounds, or a look-back with a recorded drift is compared as read —
 * its `missing` stands, and the answer is "not sure" (§ 9.2).
 *
 * ## Retention (§ 9.4)
 *
 * `beyondRetention` — the call was refused before dispatch because the window
 * was wholly older than the source keeps, or its read lies wholly before
 * `now − retention`. `partlyBeyondRetention` — the read starts before that
 * edge and ends after it (the result's `held` decides `partly-held`).
 *
 * ## Clocks (§ 9.6)
 *
 * A dataset whose declared time axis names a `zone` holds wall times in that
 * zone — a wall-clock source. {@link clocksDiffer} names the sources and zones
 * when two sources of one answer declare different zones: a label only, every
 * comparison is done on instants. A period's offset (`Z`, `-07:00`) is a
 * spelling of an instant, never a clock, and is never read here.
 *
 * @example
 * ```ts
 * periodTimeCheck({
 *   window: { how: 'filled', asked: { from: '2026-10-02T15:40:00Z', to: '2026-10-09T15:40:00Z' } },
 *   declared: [{ from: '2026-10-07T15:40:00Z', to: '2026-10-09T15:39:59.999Z' }], // clamped to 2 days
 *   now: '2026-10-09T15:40:00Z',
 * })?.differs?.missing; // [{ from: '2026-10-02T15:40:00Z', to: '2026-10-07T15:40:00Z' }]
 * ```
 */

import { instantOf, spellInstant, type InstantText } from './instant.js';
import { fromInclusive, stepMsOf, type InclusiveSpan, type TimeRange } from './range.js';
import { durationMs } from './duration.js';
import { FACT_UNITS, granularityMsOf, type PeriodFacts, type PeriodForm } from './convert.js';
import { sentLookback } from './drift.js';
import type { CallDrift, CallWindowRow } from './rows.js';

// ─── The shapes ──────────────────────────────────────────────────────────

// The record half — the row's shapes, the checkpoint door's tests and the two
// clock reads — lives in `checkRecord.ts`, split by FILE so the synchronous
// doors (`coverage/period.ts` · `periodRowIsWellFormed`) never load this
// module's conversions; every public name is re-exported here.
export {
  clocksDiffer,
  distinctSources,
  isPeriodDiffers,
  isShifted,
  type ClocksDiffer,
  type PeriodDiffers,
  type ReadSource,
  type SourceClock,
} from './checkRecord.js';
import type { PeriodDiffers, ReadSource } from './checkRecord.js';

/** The time layer's result checks on one call — each key present only when it holds. */
export interface PeriodTimeCheck {
  readonly differs?: PeriodDiffers;
  /** `period-shifted` (§ 7.4): the look-back ran as sent, `byMs` after the turn's `now`. */
  readonly shifted?: { readonly byMs: number };
  /** `period-beyond-retention` (§ 9.4). */
  readonly beyondRetention?: true;
  /** `partly-beyond-retention` (§ 9.4). */
  readonly partlyBeyondRetention?: true;
}

/** What one call's check reads — every field off a row or a declaration. */
export interface PeriodCheckInput {
  /** The call's `call-window` row — absent when the tool declares no forms. */
  readonly window?: Pick<
    CallWindowRow,
    | 'how'
    | 'form'
    | 'asked'
    | 'person'
    | 'sent'
    | 'trimmedByTool'
    | 'partlyBeyondRetention'
    | 'refused'
  >;
  /** The call's `call` row's `drift`. */
  readonly drift?: CallDrift;
  /** The `queried` span of every period the call's result declared (inclusive ends). */
  readonly declared?: readonly InclusiveSpan[];
  readonly facts?: PeriodFacts;
  /** The tool's period forms — with the window's `form`, whether the call sent a look-back (§ 7.4). */
  readonly forms?: readonly PeriodForm[];
  /** The turn's clock `now`. */
  readonly now: InstantText;
}

// ─── Ranges as milliseconds ──────────────────────────────────────────────

type Span = readonly [number, number];

const msAt = (text: unknown): number | undefined => instantOf(text, 'lenient')?.ms;

function spanOf(range: TimeRange): Span | undefined {
  const from = msAt(range.from);
  const to = msAt(range.to);
  return from === undefined || to === undefined || !(from < to) ? undefined : [from, to];
}

function rangeOf([from, to]: Span): TimeRange {
  // Both are finite millisecond instants read from a range — each spells.
  return {
    from: spellInstant({ ms: from, nanos: 0 }, 0) as InstantText,
    to: spellInstant({ ms: to, nanos: 0 }, 0) as InstantText,
  };
}

/** The parts of `a` covered by none of `bs`, in time order. */
function minus(a: Span, bs: readonly Span[]): Span[] {
  let pieces: Span[] = [a];
  for (const [bFrom, bTo] of bs) {
    const next: Span[] = [];
    for (const [from, to] of pieces) {
      if (bTo <= from || bFrom >= to) {
        next.push([from, to]);
        continue;
      }
      if (bFrom > from) next.push([from, bFrom]);
      if (bTo < to) next.push([bTo, to]);
    }
    pieces = next;
  }
  return pieces;
}

/** A piece no longer than one millisecond is a closed end read as open — not a difference. */
const WIDTH_OF_AN_INSTANT_MS = 1;

const kept = (pieces: readonly Span[]): TimeRange[] =>
  pieces.filter(([from, to]) => to - from > WIDTH_OF_AN_INSTANT_MS).map(rangeOf);

/** The parts of `asked` not read, and the parts read not asked. */
export function rangeDifference(
  asked: TimeRange,
  read: readonly TimeRange[],
): { readonly missing: TimeRange[]; readonly extra: TimeRange[] } | undefined {
  const a = spanOf(asked);
  const reads = read.map(spanOf);
  if (a === undefined || reads.some((r) => r === undefined)) return undefined;
  const spans = reads as Span[];
  const missing = kept(minus(a, spans));
  const extraSpans: Span[] = [];
  for (const r of spans) extraSpans.push(...minus(r, [a, ...extraSpans]));
  return { missing, extra: kept(extraSpans.sort((x, y) => x[0] - y[0])) };
}

/**
 * § 7.4's first row: a look-back sent within the step, whose ONE declared
 * read has the asked length and starts no earlier than the asked range and no
 * more than the tool's step later — the tool's own clock ran a little past
 * `now`. Only forward: dispatch drift never moves a read earlier, so an
 * earlier read is a read that missed the newest part of what was asked.
 */
function lookbackWithinStep(input: PeriodCheckInput, read: ReadOf): boolean {
  const window = input.window;
  if (read.source !== 'declared' || read.read.length !== 1) return false;
  if (window?.asked === undefined || input.drift !== undefined) return false;
  if (!sentLookback(window, input.forms ?? [])) return false;
  const a = spanOf(window.asked);
  const r = spanOf(read.read[0] as TimeRange);
  if (a === undefined || r === undefined) return false;
  const lengthGap = Math.abs(r[1] - r[0] - (a[1] - a[0]));
  const moved = r[0] - a[0];
  return lengthGap <= WIDTH_OF_AN_INSTANT_MS && moved >= 0 && moved <= granularityMsOf(input.facts);
}

// ─── The check ───────────────────────────────────────────────────────────

/** What one call read, where that came from, and the step a declared end was read back with. */
interface ReadOf {
  readonly read: TimeRange[];
  readonly source: ReadSource;
  readonly stepMs?: number;
}

/** What the call read, first found wins (the module table) — `undefined` when nothing says. */
function readOf(input: PeriodCheckInput): ReadOf | undefined {
  const declared = input.declared ?? [];
  if (declared.length > 0) {
    const stepMs = stepMsOf(input.facts?.granularity, FACT_UNITS);
    try {
      return { read: declared.map((q) => fromInclusive(q, stepMs)), source: 'declared', stepMs };
    } catch {
      return undefined; // a declaration the rule set refused never reaches here; nothing to compare
    }
  }
  const window = input.window;
  if (window === undefined || window.how === 'refused') return undefined;
  if (window.sent !== undefined && window.trimmedByTool !== true) {
    return { read: [window.sent], source: 'sent' };
  }
  if (window.asked === undefined) return undefined;
  const asked = spanOf(window.asked);
  if (input.drift?.outcome === 'shifted' && asked !== undefined) {
    const by = input.drift.byMs;
    return { read: [rangeOf([asked[0] + by, asked[1] + by])], source: 'shifted' };
  }
  return { read: [window.asked], source: 'asked' };
}

/** The range a call is judged against: the person's window for a model-chosen one, else what it asked. */
function referenceOf(
  window: PeriodCheckInput['window'],
): { readonly against: 'asked' | 'person'; readonly asked: TimeRange } | undefined {
  if (window === undefined || window.how === 'refused') return undefined;
  if (window.how === 'model-chosen' && window.person !== undefined) {
    return { against: 'person', asked: { from: window.person.from, to: window.person.to } };
  }
  return window.asked === undefined ? undefined : { against: 'asked', asked: window.asked };
}

function differsOf(input: PeriodCheckInput): PeriodDiffers | undefined {
  const reference = referenceOf(input.window);
  const found = readOf(input);
  if (reference === undefined || found === undefined) return undefined;
  // Within the step the look-back IS the asked range (§ 7.4) — then judged like one.
  const read: ReadOf =
    lookbackWithinStep(input, found) && input.window?.asked !== undefined
      ? { read: [input.window.asked], source: 'asked' }
      : found;
  const difference = rangeDifference(reference.asked, read.read);
  if (difference === undefined) return undefined;
  if (difference.missing.length === 0 && difference.extra.length === 0) return undefined;
  return {
    against: reference.against,
    asked: reference.asked,
    read: read.read,
    source: read.source,
    ...(read.stepMs !== undefined && { stepMs: read.stepMs }),
    missing: difference.missing,
    extra: difference.extra,
  };
}

/** Where the read lies against `now − retention`: wholly before it, across it, or neither. */
function retentionOf(input: PeriodCheckInput): 'beyond' | 'partly' | undefined {
  if (input.window?.how === 'refused') {
    return input.window.refused === 'beyond-retention' ? 'beyond' : undefined;
  }
  const retention =
    input.facts?.retention === undefined
      ? undefined
      : durationMs(input.facts.retention, FACT_UNITS);
  const now = msAt(input.now);
  const read = readOf(input);
  if (retention === undefined || now === undefined || read === undefined) {
    return input.window?.partlyBeyondRetention === true ? 'partly' : undefined;
  }
  const oldest = now - retention;
  const spans = read.read.map(spanOf).filter((s): s is Span => s !== undefined);
  if (spans.length > 0 && spans.every(([, to]) => to <= oldest)) return 'beyond';
  if (spans.some(([from, to]) => from < oldest && to > oldest)) return 'partly';
  return input.window?.partlyBeyondRetention === true ? 'partly' : undefined;
}

/**
 * The time layer's result checks on one call (§ 9.2, § 7.4, § 9.4) —
 * `undefined` when none holds, so an unremarkable call's row gains nothing.
 */
export function periodTimeCheck(input: PeriodCheckInput): PeriodTimeCheck | undefined {
  const differs = differsOf(input);
  const shifted = input.drift?.outcome === 'shifted' ? { byMs: input.drift.byMs } : undefined;
  const retention = retentionOf(input);
  if (differs === undefined && shifted === undefined && retention === undefined) return undefined;
  return {
    ...(differs !== undefined && { differs }),
    ...(shifted !== undefined && { shifted }),
    ...(retention === 'beyond' && { beyondRetention: true as const }),
    ...(retention === 'partly' && { partlyBeyondRetention: true as const }),
  };
}
