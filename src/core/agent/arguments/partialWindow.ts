/**
 * Partial model bounds retain their own scope while a separate native ask
 * settles the person's words. Pure admission/classification only: conversions
 * and final whole-window binding remain owned by time/convert and resolve.
 * Loaded with the armed argument ask, never by a plain agent's graph.
 */
import { formArguments, readBack, sameRange, type PeriodForm } from '../../../time/convert.js';
import { isMissing, isRefused, periodFormsOf, rulesOf } from '../../../tools/declare.js';
import type { ArgumentAskState, AskField, AskProgress, AskTime, AskWaiting } from './ask.js';
import type { BatchCall, ToolOf } from './resolve.js';

export interface PartialOrigin {
  readonly call: BatchCall;
  readonly form: number;
  readonly declaration: PeriodForm;
  readonly arguments: readonly string[];
}

export interface PartialWindowState {
  readonly version: 1;
  readonly phase: 'complete-arguments' | 'confirm-meaning';
  readonly owner: string;
  readonly turn: number;
  readonly iteration: number;
  readonly mention: number;
  readonly origins: readonly PartialOrigin[];
  /** Private consistency copy, not authentication of a host-owned checkpoint. */
  readonly snapshot?: {
    readonly fields: readonly AskField[];
    readonly progress: readonly AskProgress[];
    readonly waiting: AskWaiting;
  };
}

/** Missing zone alone, malformed full forms and readable alternatives are not partial bounds. */
export function partialOriginOf(
  call: BatchCall,
  toolOf: ToolOf,
  time: Pick<AskTime, 'now' | 'appZone'>,
): PartialOrigin | 'ambiguous' | undefined {
  if (call.argumentsFailure !== undefined) return undefined;
  const rules = rulesOf(toolOf(call.name));
  if (rules === undefined || isRefused(rules)) return undefined;
  const forms = periodFormsOf(rules.period);
  if (forms.some((form) => readBack(call.args, form, time) !== undefined)) return undefined;
  const partial = forms.flatMap((form, index) => {
    if (form.kind !== 'bounds') return [];
    const left = isMissing(call.args, form.from.argument);
    const right = isMissing(call.args, form.to.argument);
    return left !== right
      ? [
          {
            call: structuredClone(call),
            form: index,
            declaration: structuredClone(form),
            arguments: [form.from.argument, form.to.argument],
          },
        ]
      : [];
  });
  return partial.length > 1 ? 'ambiguous' : partial[0];
}

/** Multiple readable forms must denote one interval; canonical binding must not pick a conflicting first. */
export function hasOneMaterializedWindow(
  call: BatchCall,
  toolOf: ToolOf,
  time: Pick<AskTime, 'now' | 'appZone'>,
): boolean {
  const rules = rulesOf(toolOf(call.name));
  if (rules === undefined || isRefused(rules)) return false;
  const ranges = periodFormsOf(rules.period).flatMap((form) => {
    if (formArguments(form).some((a) => a.role !== 'zone' && isMissing(call.args, a.argument)))
      return [];
    const range = readBack(call.args, form, time);
    return range === undefined ? [] : [range];
  });
  return ranges.length > 0 && ranges.every((range) => sameRange(range, ranges[0]));
}

/** Exact detached JSON ownership, not token/semantic equality of values. */
function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null)
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left),
    b = Object.keys(right);
  return (
    a.length === b.length &&
    a.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameData((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

/** Capture only working data; never include the partial carrier in its own snapshot. */
export function snapshotPartialState(state: ArgumentAskState): ArgumentAskState {
  if (state.partial === undefined || state.waiting === undefined) return state;
  const snapshot = structuredClone({
    fields: state.fields,
    progress: state.progress,
    waiting: state.waiting,
  });
  return { ...state, partial: { ...state.partial, snapshot } };
}

/** A saved new pause must retain exactly the raw working state its writer stored. */
export function validPartialSnapshot(state: ArgumentAskState): boolean {
  return (
    state.partial?.snapshot !== undefined &&
    sameData(state.partial.snapshot, {
      fields: state.fields,
      progress: state.progress,
      waiting: state.waiting,
    })
  );
}

/** Reconstruct targets independently; a coherent edit to both copies cannot change membership. */
export function validPartialFields(
  state: ArgumentAskState,
  ordinary: readonly AskField[],
  meaning: AskField | undefined,
): boolean {
  if (!sameData(state.fields.slice(0, ordinary.length), ordinary)) return false;
  if (state.partial?.phase === 'complete-arguments') return state.fields.length === ordinary.length;
  const field = state.fields[ordinary.length];
  return (
    state.fields.length === ordinary.length + 1 &&
    meaning !== undefined &&
    field?.window?.role === 'confirm-meaning' &&
    field.window.mention === meaning.window?.mention &&
    sameData(field.window.confirmOnlyIds, meaning.window?.confirmOnlyIds) &&
    sameData(field.members, meaning.members)
  );
}

/** A new carrier is usable only for its original batch, turn, writer identity and declared form. */
export function validPartialState(
  value: unknown,
  expected: Omit<PartialWindowState, 'phase' | 'version'>,
): value is PartialWindowState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as PartialWindowState;
  return (
    state.version === 1 &&
    (state.phase === 'complete-arguments' || state.phase === 'confirm-meaning') &&
    state.owner === expected.owner &&
    state.turn === expected.turn &&
    state.iteration === expected.iteration &&
    state.mention === expected.mention &&
    expected.origins.length > 0 &&
    sameData(state.origins, expected.origins)
  );
}
