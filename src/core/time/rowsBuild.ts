/**
 * core/time/rowsBuild — the builders of the time layer's rows (`rows.ts` owns
 * the shapes, the readers and the checkpoint door's checks).
 *
 * Pattern: one builder per row kind, each returning the plain record the
 *          ledger's one writer files.
 * Role:    core/ leaf (the time layer). Split from `rows.ts` because
 *          `timeReadingRows` runs the resolver (`resolve.ts`), which only an
 *          armed agent loads — its callers (`agent/stages/timeLayer.ts`, the
 *          inputs layer's `arguments/resolve.ts`) are reached through
 *          `import()` — while `rows.ts` sits on the checkpoint door's
 *          synchronous path (the optional-family law of docs-next's site
 *          budget). Import a builder from HERE — `rows.ts` does not re-export
 *          them, or a bundler would place them on its synchronous path.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * clockRow(clock, { turn: 1, iteration: 1 }); // { kind: 'clock', turn: 1, … }
 * ```
 */

import type { TimeRange } from './range.js';
import { clockChange, type ReadRunTime, type TimeClock } from './clock.js';
import type { CheckedMention } from './reader.js';
import type { CallWindow, TurnWindow } from './bind.js';
import { chooseReading, resolveMention, type TimePolicy } from './resolve.js';
import type {
  CallDrift,
  CallRow,
  CallWindowRow,
  ClockOnResumeRow,
  ClockRow,
  PersonWindow,
  TimeReaderStamp,
  TimeReadingRow,
} from './rows.js';

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
 * `checkReading`): one per mention, resolved against the turn's clock — or
 * one `mentions: 0` row. The one owner of the law "a reading only PROPOSES"
 * (the owner's decision "Always confirm", time design TQ29): whatever the
 * reader's kind, no reading is settled by the library and none is the
 * person's words — its candidates carry `said: []` and its choice stays
 * `open` with `confirm` (the policy may still remove readings), so the time
 * ask offers it, pre-filled with its window and zone, and only the person's
 * answer settles it (`rows.ts` · `TimeAnswerRow`).
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
    const resolution = resolveMention(
      m.parses,
      clock,
      { id: reader.id, kind: reader.kind },
      true,
      policy,
    );
    return {
      ...base,
      mention,
      quote: m.quote,
      parses: m.parses,
      ...(m.problem !== undefined && { problem: m.problem }),
      candidates: resolution.candidates,
      choice: chooseReading(resolution, policy, reader.kind, m.problem, true),
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
