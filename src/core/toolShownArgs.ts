/**
 * The arguments a tool lets the record SHOW — its own redaction, applied to
 * the call's arguments the way it is already applied to its result.
 *
 * Role:    Support. A leaf. It decides nothing about what the MODEL reads; it
 *          answers one question for the dispatch path — "what may an event say
 *          this call ran with?" — for a tool that declared a redaction policy.
 * Reads:   the tool (a symbol-keyed function, when present) and the arguments.
 * Emits:   N/A.
 *
 * WHY IT EXISTS. `flowchartAsTool({ redact })` and `runbookAsTool({ redact })`
 * serve their RESULT as footprintjs's redacted view — "what a tool may show is
 * one rule" (`test/core/flowchartAsTool.redact.test.ts`). The call's
 * ARGUMENTS had no such door: a key the policy names (`apiKey`) left the
 * process verbatim on any exporter that carried the call's arguments. The
 * policy lives in the tool's closure, so the tool itself carries the function
 * that applies it, under a registry symbol — invisible to the model, to
 * `Tool`'s shape and to `toJSON`, found here. The `INNER_RUN_RECORDS` symbol
 * (`core/innerRunRecords.ts` · `INNER_RUN_RECORDS`) is the
 * precedent.
 *
 * WHAT IT IS NOT. Not the arguments the tool RECEIVED — the tool ran with the
 * real values. It is the form the RECORD may show: the dispatch path compares it
 * with the model's proposal (`changedArgKeys` below) and stamps the NAMES of
 * the keys that differ on `stream.tool_end` (`events/payloads.ts` ·
 * `ToolEndPayload`), never their values. A check-in shows a person this form
 * too, and names the arguments it hides (`hiddenArgNames` below →
 * `CheckInRequest.hiddenArgs`), so an approval given on a hidden value is
 * given knowingly and recorded as such.
 */
import type { RedactionPolicy } from 'footprintjs';
import { RedactionRule } from 'footprintjs/advanced';

import type { ToolArgs } from '../tools/runChain.js';
import { frozenProjectionOf, frozenView } from '../lib/frozenCopy.js';

/** The registry symbol a tool carries its arguments view under. */
export const SHOWN_ARGS: unique symbol = Symbol.for('agentfootprint.tool.shownArgs');

/** Arguments in → the form the record may show. Returns the SAME object when
 *  nothing in it is hidden, so an unaffected call allocates nothing. */
export type ShownArgs = (args: ToolArgs) => ToolArgs;

/** A tool that carries its arguments view. */
export interface ShowsArgs {
  readonly [SHOWN_ARGS]: ShownArgs;
}

/**
 * The arguments view a redaction policy implies — footprintjs's own rule
 * (`RedactionRule` · `retainRecord`: keys, patterns and fields, the one
 * owner), with the placeholder the tool's served result carries
 * (`'REDACTED'`, the redacted mirror's), so a hidden key reads the same in
 * the arguments as in the result. A fresh rule per call: `RedactionRule`
 * remembers marked keys for a run, and two calls are not one run.
 */
export function argsRedactedBy(policy: RedactionPolicy): ShownArgs {
  return (args) => new RedactionRule(policy).retainRecord(args, 'REDACTED');
}

/**
 * Whether `tool` carries an arguments view — its author declared that some
 * argument's value must not reach the record (`flowchartAsTool({ redact })`,
 * `runbookAsTool({ redact })`, or the symbol set by hand).
 */
export function carriesArgumentView(tool: unknown): boolean {
  return (
    tool !== null &&
    typeof tool === 'object' &&
    typeof (tool as Partial<ShowsArgs>)[SHOWN_ARGS] === 'function'
  );
}

/**
 * What an event may say `tool` was called with: its own view when it carries
 * one, else the arguments themselves (same reference). Never throws — a view
 * that fails hides everything rather than show what it could not judge.
 */
export function shownArgsOf(tool: unknown, args: ToolArgs): ToolArgs {
  if (tool === null || typeof tool !== 'object') return args;
  const view = (tool as Partial<ShowsArgs>)[SHOWN_ARGS];
  if (typeof view !== 'function') return args;
  try {
    return view(args);
  } catch {
    return Object.fromEntries(Object.keys(args).map((key) => [key, 'REDACTED']));
  }
}

/**
 * The names of the arguments `tool`'s view hides in this call, in the order
 * of `args`; empty when the tool carries no view. The library's READING of
 * the view, asked for a check-in (`CheckInRequest.hiddenArgs`, bound into the
 * request id), for the arguments a page is shown (`stream.tool_start` ·
 * `hiddenArgs`) and for the private-answer marks. `stream.tool_end`'s
 * `changedArgKeys` answers another question (what differs from the proposal).
 *
 * A name is listed when the view's output for it differs from the input
 * (replaced, removed, or rebuilt — a nested field hidden inside it), or when
 * the library could not decide. A string the view handed back unchanged is
 * asked once more, ON ITS OWN: the view runs on the arguments with that one
 * value swapped for a stand-in string, every other value real; the name is
 * listed when the stand-in does not come back, or the view throws. Why: a
 * hidden value that already equals the placeholder reads unchanged, and the
 * text alone cannot tell it from a real `'REDACTED'`; one key at a time, so a
 * view whose choice for `to` depends on `memo` still sees the real `memo`.
 * A value that is not a string and came back unchanged is shown as it is, so
 * it is not listed (a view that checks a number's type is not misread).
 *
 * Example — a view hiding `to`:
 *   hiddenArgNames(tool, { to: 'acct-9', memo: 'REDACTED' })  → ['to']
 *   hiddenArgNames(tool, { to: 'REDACTED', memo: 'rent' })    → ['to']
 *
 * What the reading cannot see: a view that is not a function of its input
 * alone (a clock, a counter, outside state) may answer the probe differently
 * from the call; and a placeholder that is not a string (a number, an object)
 * equal to the real value reads as shown.
 *
 * @param shown the view's output for `args` when the caller already has it
 *   (`shownArgsOf`, not a copy of it), so the view is not run again for it.
 *
 * Names only, plain strings: no value of `args` is copied into the answer.
 */
export function hiddenArgNames(
  tool: unknown,
  args: ToolArgs,
  shown: ToolArgs = shownArgsOf(tool, args),
): readonly string[] {
  if (!carriesArgumentView(tool)) return [];
  // A view that hands back no record shows nothing a person can read.
  if (typeof shown !== 'object' || shown === null) return Object.keys(args);
  const view = (tool as ShowsArgs)[SHOWN_ARGS];
  const hidden = (key: string): boolean => {
    if (!hasOwn(shown, key) || shown[key] !== args[key]) return true;
    if (typeof args[key] !== 'string') return false;
    const standIn = `\u0000agentfootprint.shownArgs.standIn:${key}`;
    try {
      const probe = view({ ...args, [key]: standIn });
      return !hasOwn(probe, key) || probe[key] !== standIn;
    } catch {
      return true; // could not decide: listed
    }
  };
  return Object.keys(args).filter(hidden);
}

/**
 * The fields `stream.tool_start` carries for a tool whose view hides
 * something: the view's output (frozen) and the hidden names — what a page
 * shown to a person streams in place of the real arguments (the AG-UI
 * adapter). Empty for a tool without a view, or a call the view hides nothing
 * of, so those events keep their bytes. `args` should be the call's frozen
 * copy: the view is the tool author's code and must not reach what runs.
 *
 * Example — a view hiding `to`:
 *   shownFieldsOf(tool, { to: 'acct-9', amount: 5 })
 *     → { shownArgs: { to: 'REDACTED', amount: 5 }, hiddenArgs: ['to'] }
 */
export function shownFieldsOf(
  tool: unknown,
  args: ToolArgs,
): { readonly shownArgs?: ToolArgs; readonly hiddenArgs?: readonly string[] } {
  if (!carriesArgumentView(tool)) return {};
  const shown = shownArgsOf(tool, args);
  const hiddenArgs = hiddenArgNames(tool, args, shown);
  if (hiddenArgs.length === 0) return {};
  return {
    shownArgs: frozenView(shown) ?? frozenProjectionOf(shown),
    hiddenArgs: Object.freeze([...hiddenArgs]),
  };
}

const hasOwn = (record: ToolArgs, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/**
 * The names of the keys whose value differs between the proposal and the
 * arguments as shown: set, rewritten, removed, or hidden by the tool's view.
 * Compared by reference, key by key — a link that spreads `...args` keeps the
 * untouched keys' references, so only what it changed is named; a rebuilt
 * nested value counts as changed (it may name more, never fewer). Plain
 * strings, so the list is detached from both objects by construction.
 */
export function changedArgKeys(proposal: ToolArgs, shown: ToolArgs): readonly string[] {
  if (proposal === shown) return [];
  const keys = new Set([...Object.keys(proposal), ...Object.keys(shown)]);
  return [...keys].filter(
    (key) =>
      !Object.prototype.hasOwnProperty.call(proposal, key) ||
      !Object.prototype.hasOwnProperty.call(shown, key) ||
      proposal[key] !== shown[key],
  );
}
