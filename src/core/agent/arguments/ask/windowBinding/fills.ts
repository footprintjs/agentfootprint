/** Walker: convert one answered window into each member call's declared forms. */
import type { InputValue } from '../../../../../tools/inputRequest.js';
import { convertForTool, granularityMsOf, toolFacts } from '../../../../../time/convert.js';
import { windowToConvert, type TurnWindow } from '../../../../../time/windows.js';
import { validatePropertyValue } from '../../../../../tools/toolArgsValidation.js';
import { isRefused, periodFactsOf, periodFormsOf, rulesOf } from '../../../../../tools/declare.js';
import type { BatchAddress } from '../../batchAddress.js';
import { memberAddresses, windowAddressKey } from '../../askAddresses.js';
import { widerOf, type BatchCall, type ToolOf } from '../../resolve.js';
import { WINDOW_FORM_EXPECTATION } from '../constants.js';
import { refusalExpectation } from '../fields.js';
import type { AskField, AskTime, WindowFill } from '../types.js';
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
  answered: TurnWindow,
  byAddress: ReadonlyMap<BatchAddress, BatchCall>,
  toolOf: ToolOf,
  time: AskTime,
):
  | {
      readonly fills: Readonly<Record<string, WindowFill>>;
      readonly filled: Readonly<Record<string, WindowFilled>>;
    }
  | { readonly expected: string } {
  const fills: Record<string, WindowFill> = Object.create(null);
  const filled: Record<string, WindowFilled> = Object.create(null);
  for (const member of field.members) {
    const rules = rulesOf(toolOf(member.toolName));
    if (rules === undefined || isRefused(rules)) return { expected: WINDOW_FORM_EXPECTATION };
    const forms = periodFormsOf(rules.period);
    const facts = periodFactsOf(rules.period);
    const read = convertForTool(windowToConvert(answered), forms, facts, {
      now: time.now,
      zone: answered.zone,
      ...(time.appZone !== undefined && { appZone: time.appZone }),
      granularityMs: granularityMsOf(facts),
    });
    // Refused before any form was chosen: the reason names the TOOL's facts (`toolFacts` — the
    // widest any form reads), as every other door that judges a window before a form does.
    if ('refused' in read) {
      return { expected: refusalExpectation(read.refused, toolFacts(forms, facts)) };
    }
    const conversion = read.conversion;
    const wider = widerOf(conversion, facts.filtersToAsked === true);
    for (const address of memberAddresses(member)) {
      const key = windowAddressKey(field, address);
      if (Object.hasOwn(fills, key) || !byAddress.has(address)) continue;
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
      fills[key] = { values: conversion.values, ...(wider !== undefined && { wider }) };
      filled[key] = {
        toolName: member.toolName,
        decision: {
          how: 'filled',
          window: answered,
          conversion,
          ...((wider === 'tool-trims' || wider === 'source-clock-trims') && {
            trimmedByTool: true as const,
          }),
          ...(read.partlyBeyondRetention === true && { partlyBeyondRetention: true as const }),
        },
      };
    }
  }
  return { fills, filled };
}
