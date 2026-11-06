import { timeAskOf } from '../../../../time/readingAsk.js';
import type { InputValue } from '../../../../tools/inputRequest.js';
import { convertForTool, granularityMsOf, toolFacts } from '../../../../time/convert.js';
import type { CallWindow } from '../../../../time/bind.js';
import { offeredLookback, windowToConvert, type TurnWindow } from '../../../../time/windows.js';
import { instantOf } from '../../../../time/instant.js';
import { parseRange, spellRange, type TimeRange } from '../../../../time/range.js';
import { chooseReading, resolveMention, withZoneAnswered } from '../../../../time/resolve.js';
import type { TimeReadingRow, TimeAnswerRow } from '../../../../time/rows.js';
import { fixedOffsetZone, isZoneName, offsetAt, type ZoneName } from '../../../../time/zone.js';
import { validatePropertyValue } from '../../../../tools/toolArgsValidation.js';
import { isRefused, periodFactsOf, periodFormsOf, rulesOf } from '../../../../tools/declare.js';
import type { BatchCall, ToolOf } from '../resolve.js';
import { WINDOW_FORM_EXPECTATION, WINDOW_ZONE_EXPECTATION } from './constants.js';
import { allowedChoices, narrowed, readingsOutside, refusalExpectation } from './fields.js';
import type { AskField, AskTime, WindowAskField, WindowFill } from './types.js';
import { propertyOf } from './validation.js';

// ─── The window answer (the lazy word-driven ask, time design § 5.2) ────────

/** What an answer to a window field did: bound (the values per call), a follow-up question, or a misfit. */
export type WindowBinding =
  | {
      readonly fills: Readonly<Record<string, WindowFill>>;
      readonly refused?: Readonly<Record<string, string>>;
      /** Per filled call, the decision its `call-window` row records. */
      readonly filled: Readonly<Record<string, WindowFilled>>;
      /** The window the person settled: the range, its zone, and whether it was the offered reading. */
      readonly answered: {
        readonly range: TimeRange;
        readonly zone: ZoneName;
        readonly how: TimeAnswerRow['how'];
        readonly corrected?: TimeAnswerRow['corrected'];
      };
    }
  | { readonly followUp: AskField }
  | { readonly expected: string }
  /** The zone answer left readings none of which a member tool's facts allow: its calls are refused. */
  | { readonly outside: string };

/**
 * Bind one answer to a window field: a `zone` answer re-reads the mention in
 * that zone and asks the follow-up question with the readings as choices —
 * each still a PROPOSAL to confirm (the owner's decision "Always confirm");
 * a `time-range` answer (a choice, or free entry the door already judged) is
 * converted into every member call's forms — exactly, else wider (the fill's
 * own rule) — after each tool's declared facts. A choice the ask offered is
 * `confirmed` (the person's click on the pre-filled reading); any other window
 * is `edited` — both are the person's answer.
 */
export function bindWindowAnswer(
  field: AskField,
  answer: InputValue,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  time: AskTime | undefined,
  answerKind?: TimeAnswerRow['how'],
): WindowBinding {
  const window = field.window as WindowAskField;
  if (window.role !== undefined && window.role !== 'confirm-meaning')
    throw new TypeError('argumentAsk: unknown window role');
  if (time === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  if (window.format === 'zone') {
    const reading = time.reading;
    if (reading === undefined || typeof answer !== 'string' || time.zone === undefined) {
      return { expected: WINDOW_ZONE_EXPECTATION };
    }
    const row = window.reading ?? reading.row;
    // The re-read stays a PROPOSAL: the zone was the person's, the window is still words. Under
    // an unknown clock zone (G15) the answer is the person's own zone: the words are read in it.
    const resolution = resolveMention(
      withZoneAnswered(row.parses ?? [], answer, reading.policy),
      { now: time.now, zone: time.zoneUnknown === true && isZoneName(answer) ? answer : time.zone },
      row.reader,
      true,
      reading.policy,
    );
    const choice = chooseReading(resolution, reading.policy, row.reader.kind, undefined, true);
    if (choice.by === 'open')
      return windowQuestion(
        field,
        { ...row, candidates: resolution.candidates, choice },
        toolOf,
        time,
      );

    return { expected: WINDOW_ZONE_EXPECTATION };
  }
  const range = typeof answer === 'string' ? parseRange(answer) : undefined;
  if (range === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  const at = answerKind === 'edited' ? -1 : field.choices?.indexOf(answer) ?? -1;
  const zone =
    at >= 0 ? window.zones?.[at] ?? time.zone : editedZone(range, window.zones, time.zone);
  if (zone === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  if (window.role === 'confirm-meaning') {
    const fills: Record<string, WindowFill> = {};
    const filled: Record<string, WindowFilled> = {};
    const refused: Record<string, string> = {};
    const confirmed = new Set(window.confirmOnlyIds);
    for (const id of new Set(field.members.flatMap((m) => m.toolCallIds))) {
      if (confirmed.has(id)) continue;
      const members = field.members
        .filter((m) => m.toolCallIds.includes(id))
        .map((m) => ({ ...m, toolCallIds: [id] }));
      const one = windowFills(
        { ...field, members },
        range,
        zone,
        byId,
        toolOf,
        time,
        answerKind !== 'edited',
      );
      if ('expected' in one) refused[id] = one.expected;
      else {
        Object.assign(fills, one.fills);
        Object.assign(filled, one.filled);
      }
    }
    return {
      fills,
      filled,
      refused,
      answered: { range, zone, how: at >= 0 ? 'confirmed' : 'edited' },
    };
  }
  const bound = windowFills(field, range, zone, byId, toolOf, time, answerKind !== 'edited');
  if (!('fills' in bound)) return bound;
  return {
    fills: bound.fills,
    filled: bound.filled,
    answered: { range, zone, how: at >= 0 ? 'confirmed' : 'edited' },
  };
}

/**
 * The zone a window the person TYPED is recorded in: the first of the
 * offered readings' zones — then the app's — whose offsets at both ends are
 * the ones typed; else the fixed-offset zone the typed offsets spell
 * (`Etc/GMT-1` for `+01:00`, `zone.ts` · `fixedOffsetZone`); else the app's.
 * A London day typed with `+01:00` under an app in Los Angeles is recorded
 * in Europe/London (the zone the mention named), never in the app's zone.
 */
function editedZone(
  range: TimeRange,
  offered: readonly ZoneName[] | undefined,
  appZone: ZoneName | undefined,
): ZoneName | undefined {
  const from = instantOf(range.from, 'lenient');
  const to = instantOf(range.to, 'lenient');
  if (from === undefined || to === undefined) return appZone;
  const shows = (zone: ZoneName): boolean =>
    offsetAt(zone, from.ms) === from.offsetMinutes && offsetAt(zone, to.ms) === to.offsetMinutes;
  const zones = [...(offered ?? []), ...(appZone !== undefined ? [appZone] : [])];
  const match = zones.find(shows);
  if (match !== undefined) return match;
  const fixed =
    from.offsetMinutes === to.offsetMinutes ? fixedOffsetZone(from.offsetMinutes) : undefined;
  return fixed ?? appZone;
}

/** One member call a bound window filled: its tool, and the fill decision its `call-window` row records. */
export interface WindowFilled {
  readonly toolName: string;
  readonly decision: Extract<CallWindow, { how: 'filled' }>;
}

/**
 * The window written into every member call's forms — the one owner's answer
 * per tool (`time/convert.ts` · `convertForTool`: exactly, else wider,
 * after the tool's facts) — or what it failed. Each fill also carries the
 * decision its `call-window` row records (`filled`, the person's ANSWERED
 * window, with the wider read's `sent` and `extra`).
 */
function windowFills(
  field: AskField,
  range: TimeRange,
  zone: ZoneName,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  time: AskTime,
  keepLookback = true,
):
  | {
      readonly fills: Readonly<Record<string, WindowFill>>;
      readonly filled: Readonly<Record<string, WindowFilled>>;
    }
  | { readonly expected: string } {
  const fills: Record<string, WindowFill> = {};
  const filled: Record<string, WindowFilled> = {};
  // The offered look-back, picked as offered, stays a look-back from now — the same window the
  // served line and a later call's fill convert (`windows.ts` · `windowToConvert`), so the value
  // this call is handed and the value the model is told are one spelling.
  const lookback = keepLookback
    ? offeredLookback(field.window?.reading ?? time.reading?.row, range)
    : undefined;
  const answered: TurnWindow = {
    source: 'answered',
    mention: (field.window as WindowAskField).mention,
    range,
    ...(lookback !== undefined && { lookback }),
    zone,
  };
  for (const member of field.members) {
    const rules = rulesOf(toolOf(member.toolName));
    if (rules === undefined || isRefused(rules)) return { expected: WINDOW_FORM_EXPECTATION };
    const forms = periodFormsOf(rules.period);
    const facts = periodFactsOf(rules.period);
    const read = convertForTool(windowToConvert(answered), forms, facts, {
      now: time.now,
      zone,
      ...(time.appZone !== undefined && { appZone: time.appZone }),
      granularityMs: granularityMsOf(facts),
    });
    // Refused before any form was chosen: the reason names the TOOL's facts (`toolFacts` — the
    // widest any form reads), as every other door that judges a window before a form does.
    if ('refused' in read) {
      return { expected: refusalExpectation(read.refused, toolFacts(forms, facts)) };
    }
    const conversion = read.conversion;
    const wider =
      'sent' in conversion
        ? facts.filtersToAsked === true
          ? ('tool-trims' as const)
          : ('reads-more' as const)
        : undefined;
    for (const id of member.toolCallIds) {
      if (fills[id] !== undefined || !byId.has(id)) continue;
      for (const [argument, value] of Object.entries(conversion.values)) {
        if (typeof value === 'object') continue;
        const verdict = validatePropertyValue(
          value as InputValue,
          propertyOf(toolOf, { ...member, argument }),
        );
        if (!verdict.ok) {
          const expected = verdict.issues[0]?.expected;
          return { expected: expected ?? WINDOW_FORM_EXPECTATION };
        }
      }
      fills[id] = { values: conversion.values, ...(wider !== undefined && { wider }) };
      filled[id] = {
        toolName: member.toolName,
        decision: {
          how: 'filled',
          window: answered,
          conversion,
          ...(wider === 'tool-trims' && { trimmedByTool: true as const }),
          ...(read.partlyBeyondRetention === true && { partlyBeyondRetention: true as const }),
        },
      };
    }
  }
  return { fills, filled };
}

/** One question projection, shared by native zone answers and the correction facade. */
export function windowQuestion(
  field: AskField,
  row: TimeReadingRow,
  toolOf: ToolOf,
  time: AskTime,
): WindowBinding {
  const window = field.window!;
  const ask = time.reading === undefined ? undefined : timeAskOf(row, time.reading.messages);
  if (ask === undefined || (ask.field.format !== 'time-range' && ask.field.format !== 'zone'))
    return { expected: WINDOW_ZONE_EXPECTATION };
  const choices = ask.field.enum;
  const zones = choices?.map(
    (value) => row.candidates?.find((c) => spellRange(c.range) === value)?.zone ?? time.zone!,
  );
  const { choices: _choices, ...base } = field;
  void _choices;
  const { labels: _labels, zones: _zones, reading: _reading, ...windowBase } = window;
  void [_labels, _zones, _reading];
  const followUp: AskField = {
    ...base,
    question: ask.question,
    ...(choices !== undefined && { choices }),
    window: {
      ...windowBase,
      format: ask.field.format,
      ...(ask.field.labels !== undefined && { labels: ask.field.labels }),
      ...(zones !== undefined && { zones }),
      ...(window.reply !== undefined && { reading: row }),
    },
  };
  if (window.role === 'confirm-meaning' || ask.field.format === 'zone') return { followUp };
  const kept = allowedChoices(choices ?? [], zones, field.members, toolOf, time);
  if (kept === undefined && field.members.length > 0) {
    const outside = readingsOutside(choices ?? [], zones ?? [], field.members, toolOf, time);
    if (outside !== undefined) return { outside };
  }
  return { followUp: narrowed(followUp, kept) };
}
