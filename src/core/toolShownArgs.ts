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
 * of `args`; empty when the tool carries no view or the view hides nothing.
 * The ONE answer to "which values can a person or a record not see here" —
 * the check-in request (`CheckInRequest.hiddenArgs`), the decision's record
 * and the private-answer marks all ask it.
 *
 * Read from the VIEW, never from the shown text: a value the view replaced,
 * removed or rebuilt (a nested field hidden inside it) is hidden. A value the
 * view handed back unchanged is asked once more: the view is run on a copy in
 * which each such value is a stand-in string, and a key whose stand-in did not
 * come back is hidden too. Why: a hidden value that already equals the
 * placeholder reads unchanged, and the text alone cannot tell it from an
 * argument whose real value is the string `'REDACTED'`.
 *
 * Example — a view hiding `to`:
 *   hiddenArgNames(tool, { to: 'acct-9', memo: 'REDACTED' })  → ['to']
 *   hiddenArgNames(tool, { to: 'REDACTED', memo: 'rent' })    → ['to']
 *
 * Names only, plain strings: no value of `args` is copied into the answer.
 */
export function hiddenArgNames(tool: unknown, args: ToolArgs): readonly string[] {
  if (!carriesArgumentView(tool)) return [];
  const keys = Object.keys(args);
  const shown = shownArgsOf(tool, args);
  const passed = (key: string) => hasOwn(shown, key) && shown[key] === args[key];
  const unchanged = keys.filter(passed);
  if (unchanged.length === 0) return keys;
  const standIn = (key: string) => `\u0000agentfootprint.shownArgs.standIn:${key}`;
  const probe = shownArgsOf(tool, {
    ...args,
    ...Object.fromEntries(unchanged.map((key) => [key, standIn(key)])),
  });
  return keys.filter((key) => !passed(key) || !hasOwn(probe, key) || probe[key] !== standIn(key));
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
