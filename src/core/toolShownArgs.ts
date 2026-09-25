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
 * (`lib/trace-toolpack/innerRunRecords.ts` · `INNER_RUN_RECORDS`) is the
 * precedent.
 *
 * WHAT IT IS NOT. Not the arguments the tool RECEIVED — the tool ran with the
 * real values. It is the form the RECORD may show: the dispatch path compares it
 * with the model's proposal (`changedArgKeys` below) and stamps the NAMES of
 * the keys that differ on `stream.tool_end` (`events/payloads.ts` ·
 * `ToolEndPayload`), never their values.
 */
import type { RedactionPolicy } from 'footprintjs';
import { RedactionRule } from 'footprintjs/advanced';

import type { ToolArgs } from './agent/middleware/runChain.js';

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
