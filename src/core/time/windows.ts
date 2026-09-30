/**
 * core/time/windows — the turn's windows, read from the record (time design
 * § 5.6): the window the person settled in the time ask (`answered`), a
 * `model` reader's one reading waiting for confirmation
 * (`derived-from-reading`) and the clock's `control` window; the quotes still
 * waiting on the person; and what the served sentence names
 * (`readerWindowsOf`).
 *
 * Pattern: Walker over recorded rows — never over words, never the resolver.
 * Role:    the record half of `bind.ts`, split out BY FILE for the synchronous
 *          doors: the Tools mount's `inputMapper` (`agent/buildAgentChart.ts` ·
 *          `timeWindowsArg`) and the evidence gate's lineage read it before
 *          any `import()` can run, and a bundler places a whole file on the
 *          synchronous graph — so this file imports only the leaves and the
 *          row readers, never `convert.ts` or `resolve.ts` (the optional-family
 *          law, `test/lib/trace-toolpack/browserGraph.test.ts`). `bind.ts`
 *          re-exports every public name.
 * Emits:   N/A (pure).
 *
 * @example
 * ```ts
 * readerWindowsOf(ledger);
 * // { now: '2026-10-09T15:40:00Z', windows: [{ source: 'answered', quote: 'yesterday', … }] }
 * ```
 */

import type { DurationText } from './duration.js';
import type { InstantText } from './instant.js';
import { sameRange, type TimeRange } from './range.js';
import type { TimeCandidate } from './resolveRecord.js';
import type { TimeRefusal } from './periodForm.js';
import {
  answersOf,
  clockOf,
  readingsOf,
  type CallWindowRow,
  type ClockRow,
  type TimeAnswerRow,
  type TimeReadingRow,
} from './rows.js';
import type { ZoneName } from './zone.js';

// ─── The turn's windows ──────────────────────────────────────────────────

/**
 * Who a window is: the window the person settled in the time ask
 * (`answered`), a `model` reader's unconfirmed reading (`derived-from-reading`),
 * or a UI control. `said` — a `rule` reading filed as the person's words — is
 * no longer filed (the owner's decision "Always confirm", time design TQ29);
 * it stays in the union so a record an earlier version filed still reads.
 */
export type WindowSource = 'said' | 'derived-from-reading' | 'answered' | 'control';

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
  /** On an `answered` window: whether the person picked the offered reading (`confirmed`) or wrote their own (`edited`). */
  readonly answer?: TimeAnswerRow['how'];
}

/** The turn's windows, and how many mentions the turn holds in all (resolved or not). */
export interface TurnWindows {
  readonly windows: readonly TurnWindow[];
  /** Every mention with a quote, plus the `control` window — the "exactly one" count. */
  readonly mentions: number;
  /**
   * Per mention still OPEN (the person has not chosen), the ranges of the
   * readings left — what a tool's facts can already rule out (§ 6.3: every
   * reading outside a tool's `direction` → nothing is asked, the call is
   * refused). Absent when no mention is open with candidates.
   */
  readonly open?: readonly (readonly TimeRange[])[];
}

/**
 * The one window a `model` reading offers, when it waits only for the
 * person's confirmation — a reading, filled as `derived-from-reading`. A
 * `rule` reading settles on nothing: it is a PROPOSAL the time ask offers,
 * and only the person's answer settles it (the owner's decision "Always
 * confirm", time design TQ29).
 */
function readingCandidate(row: TimeReadingRow): TimeCandidate | undefined {
  const choice = row.choice;
  if (row.reader.kind !== 'model' || choice?.by !== 'open') return undefined;
  if (choice.open.length !== 1 || choice.open[0] !== 'confirm') return undefined;
  return row.candidates?.[choice.remaining[0] as number];
}

/**
 * This turn's windows, read from the record: per mention, the window the
 * person settled in the time ask (`answered`, its latest `time-answer` row),
 * else a `model` reader's one window waiting for confirmation
 * (`derived-from-reading`); and the clock's `control` window. A `rule`
 * reading the person has not answered is counted and is OPEN.
 */
export function turnWindowsOf(
  readings: readonly TimeReadingRow[],
  clock: ClockRow | undefined,
  answers: readonly TimeAnswerRow[] = [],
): TurnWindows {
  const windows: TurnWindow[] = [];
  const open: TimeRange[][] = [];
  let mentions = 0;
  const answered = new Map(answers.map((a) => [a.mention, a]));
  for (const row of readings) {
    if (row.mentions === 0 || row.refused !== undefined || row.quote === undefined) continue;
    mentions++;
    const answer = row.mention === undefined ? undefined : answered.get(row.mention);
    if (answer !== undefined) {
      const range = { from: answer.from, to: answer.to };
      // The person picked a look-back the library offered: it stays a look-back from now.
      const offered = row.candidates?.find(
        (c) => c.window.kind === 'lookback' && sameRange(c.range, range),
      )?.window;
      windows.push({
        source: 'answered',
        mention: answer.mention,
        quote: row.quote,
        range,
        ...(offered?.kind === 'lookback' && { lookback: offered.duration }),
        zone: answer.zone,
        answer: answer.how,
      });
      continue;
    }
    const candidate = readingCandidate(row);
    if (candidate === undefined) {
      const choice = row.choice;
      const left =
        choice?.by === 'open'
          ? choice.remaining.flatMap((i) => {
              const c = row.candidates?.[i];
              return c === undefined ? [] : [c.range];
            })
          : [];
      if (left.length > 0) open.push(left);
      continue;
    }
    windows.push({
      source: 'derived-from-reading',
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
  return { windows, mentions, ...(open.length > 0 && { open }) };
}

/** The windows of the person's words this turn, with the turn's clock — what the served sentence names. */
export interface ReaderWindows {
  readonly now: InstantText;
  /** Each settled mention's window (`answered`, or a `model` reading's), in mention order — never the `control` window. */
  readonly windows: readonly TurnWindow[];
  /**
   * The quote of each mention the library holds only as a PROPOSAL — a `rule`
   * reading the person has not answered yet (its choice still `open`: a zone
   * to name, readings to confirm) — in mention order. The served sentence
   * names them as not confirmed, so a model that would write its own window
   * leaves the period out and the time ask confirms it (step T6b bench,
   * `bench/time/`). Absent when none is pending.
   */
  readonly pending?: readonly string[];
  /**
   * A mention is pending AND a call of this turn already ran on a window the
   * model wrote into it (a `call-window` row `how: 'model'` — § 7.3: it runs
   * as sent, unconfirmed). The served line then names that limit for the
   * answer instead of the move that would have asked the person. Absent
   * otherwise.
   */
  readonly ranUnconfirmed?: true;
  /**
   * The person's windows a tool REFUSED this turn, before dispatch (a
   * `call-window` row `how: 'refused'`): the quote, the tool and the reason
   * code — a window of the person's the call carried (`person.mention`), or
   * the turn's one open reading, refused in every reading (a row with no
   * range). The served line turns each into the conclusion an answer states,
   * so a refused window is never asked for again as though a call could read
   * it. A window the model wrote is not the person's and is not named. Absent
   * when none was refused.
   */
  readonly refused?: readonly RefusedWindow[];
}

/** One window of the person's a tool refused before dispatch — what the served line concludes. */
export interface RefusedWindow {
  readonly quote: string;
  readonly toolName: string;
  readonly refused: TimeRefusal;
  /** On a `dst-gap`: the argument whose wall time the zone skips. */
  readonly argument?: string;
}

/** Whether a call of `turn` ran on a window the model wrote (`call-window` `how: 'model'`). */
function ranOnSentWindow(ledger: readonly unknown[] | undefined, turn: number): boolean {
  return (ledger ?? []).some((row) => {
    const r = row as { readonly kind?: unknown; readonly turn?: unknown; readonly how?: unknown };
    return (
      r !== null &&
      typeof r === 'object' &&
      r.kind === 'call-window' &&
      r.turn === turn &&
      r.how === 'model'
    );
  });
}

/**
 * The person's windows the tools refused this turn (`ReaderWindows.refused`):
 * each `call-window` row `how: 'refused'` whose window was the person's — its
 * `person.mention`'s quote — or, with no range at all, the turn's one open
 * reading (`openQuote`), refused in every reading. Once per (quote, tool).
 */
function refusedWindowsOf(
  ledger: readonly unknown[] | undefined,
  turn: number,
  readings: readonly TimeReadingRow[],
  openQuote: string | undefined,
): RefusedWindow[] {
  const quoteOf = new Map(
    readings.flatMap((r) =>
      r.quote !== undefined && r.refused === undefined ? [[r.mention ?? 0, r.quote] as const] : [],
    ),
  );
  const out: RefusedWindow[] = [];
  for (const row of ledger ?? []) {
    const r = row as Partial<CallWindowRow> | null;
    if (r === null || typeof r !== 'object' || r.kind !== 'call-window' || r.turn !== turn)
      continue;
    if (r.how !== 'refused' || r.refused === undefined || typeof r.toolName !== 'string') continue;
    const quote =
      r.person !== undefined
        ? r.person.mention === undefined
          ? undefined
          : quoteOf.get(r.person.mention)
        : r.asked === undefined && r.form === undefined
        ? openQuote
        : undefined;
    if (quote === undefined) continue;
    if (out.some((w) => w.quote === quote && w.toolName === r.toolName)) continue;
    out.push({
      quote,
      toolName: r.toolName,
      refused: r.refused,
      ...(r.argument !== undefined && { argument: r.argument }),
    });
  }
  return out;
}

/**
 * The quotes of this turn's mentions still waiting on the person: a reading
 * with a quote whose choice is `open`, not answered in the time ask, and not a
 * `model` reading's one window (that one is served as a reading). Unreadable
 * and refused mentions offer nothing to confirm and are not named.
 */
export function pendingQuotesOf(
  readings: readonly TimeReadingRow[],
  answers: readonly TimeAnswerRow[] = [],
): readonly string[] {
  const answered = new Set(answers.map((a) => a.mention));
  const quotes: string[] = [];
  for (const row of readings) {
    if (row.mentions === 0 || row.refused !== undefined || row.quote === undefined) continue;
    if (row.choice?.by !== 'open') continue;
    if (row.mention !== undefined && answered.has(row.mention)) continue;
    if (readingCandidate(row) !== undefined) continue;
    quotes.push(row.quote);
  }
  return quotes;
}

/**
 * The latest turn's windows of the person's words, read off the ledger (its
 * last `clock` row and that turn's `time-reading` and `time-answer` rows) —
 * `undefined` when the turn has no clock, no settled mention and none
 * pending. A `rule` reading is named as a window only once the person
 * answered it in the time ask; before that its quote is `pending`. The
 * `control` window is not a reading and is not named (TQ13).
 */
export function readerWindowsOf(ledger: readonly unknown[] | undefined): ReaderWindows | undefined {
  const clock = clockOf(ledger);
  if (clock === undefined) return undefined;
  const turn = clock.turn;
  const readings = readingsOf(ledger, turn);
  const answers = answersOf(ledger, turn);
  const { windows } = turnWindowsOf(readings, undefined, answers);
  const pending = pendingQuotesOf(readings, answers);
  if (windows.length === 0 && pending.length === 0) return undefined;
  const refused = refusedWindowsOf(
    ledger,
    turn,
    readings,
    pending.length === 1 ? pending[0] : undefined,
  );
  return {
    now: clock.now,
    windows,
    ...(pending.length > 0 && { pending }),
    ...(pending.length > 0 && ranOnSentWindow(ledger, turn) && { ranUnconfirmed: true as const }),
    ...(refused.length > 0 && { refused }),
  };
}
