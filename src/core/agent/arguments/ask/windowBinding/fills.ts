/** Walker: convert one answered window into each member call's declared forms. */
import type { InputValue } from '../../../../../tools/inputRequest.js';
import { convertForTool, granularityMsOf, toolFacts } from '../../../../../time/convert.js';
import { offeredLookback, windowToConvert, type TurnWindow } from '../../../../../time/windows.js';
import type { TimeRange } from '../../../../../time/range.js';
import type { ZoneName } from '../../../../../time/zone.js';
import { validatePropertyValue } from '../../../../../tools/toolArgsValidation.js';
import { isRefused, periodFactsOf, periodFormsOf, rulesOf } from '../../../../../tools/declare.js';
import type { BatchCall, ToolOf } from '../../resolve.js';
import { WINDOW_FORM_EXPECTATION } from '../constants.js';
import { refusalExpectation } from '../fields.js';
import type { AskField, AskTime, WindowAskField, WindowFill } from '../types.js';
import { propertyOf } from '../validation.js';
import type { WindowFilled } from './types.js';

/**
 * The window written into every member call's forms — the one owner's answer
 * per tool (`time/convert.ts` · `convertForTool`: exactly, else wider,
 * after the tool's facts) — or what it failed. Each fill also carries the
 * decision its `call-window` row records (`filled`, the person's ANSWERED
 * window, with the wider read's `sent` and `extra`).
 */
export function windowFills(
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
  // served line and a later call's fill convert (`time/windows.ts` · `windowToConvert`), so the value
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
