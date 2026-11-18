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
import { frozenView } from '../lib/frozenCopy.js';
import { isJsonFaithful } from '../lib/jsonFaithful.js';
import {
  ARGUMENT_PLACEHOLDER,
  argumentNames,
  copyArgumentDisplay,
  maskArguments,
  readArgumentRecord,
} from '../lib/argumentDisplay.js';

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
  return (args) => new RedactionRule(policy).retainRecord(args, ARGUMENT_PLACEHOLDER);
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

interface ArgumentView {
  readonly shown: ToolArgs;
  readonly hiddenArgs: readonly string[];
  readonly uncertain?: true;
}

function viewOf(tool: unknown): ShownArgs | undefined {
  if (!carriesArgumentView(tool)) return undefined;
  return (tool as ShowsArgs)[SHOWN_ARGS];
}

function readView(view: ShownArgs, args: ToolArgs, previous?: ToolArgs): ToolArgs | undefined {
  try {
    return readArgumentRecord(previous ?? view(args));
  } catch {
    return undefined;
  }
}

/** What an argument view lets the record show. A failed view masks every name. */
export function shownArgsOf(tool: unknown, args: ToolArgs): ToolArgs {
  const view = viewOf(tool);
  if (view === undefined) return args;
  // Preserve unchanged value identity for callers measuring which arguments the view changed.
  if (readArgumentRecord(args) === undefined) return maskArguments(argumentNames(args));
  const input = frozenView(args);
  const output = input === undefined ? undefined : readView(view, input);
  const copy = copyArgumentDisplay(output);
  if (input === undefined || output === undefined || copy === undefined)
    return maskArguments(argumentNames(args));
  if (!isJsonFaithful(args)) return copy;
  const fields = Object.entries(output);
  if (
    fields.length === Object.keys(input).length &&
    fields.every(([name, value]) => Object.hasOwn(input, name) && Object.is(value, input[name]))
  )
    return args;
  return Object.fromEntries(
    fields.map(([name, value]) => [
      name,
      Object.hasOwn(input, name) && Object.is(value, input[name]) ? args[name] : copy[name],
    ]),
  );
}

function allHidden(args: ToolArgs): ArgumentView {
  const hiddenArgs = Object.freeze([...argumentNames(args)]);
  return { shown: maskArguments(hiddenArgs), hiddenArgs, uncertain: true };
}

/**
 * Read the view once over the frozen call. A missing, replaced or rebuilt key is
 * hidden. An unchanged string is checked using another string with all siblings
 * intact. If the probe cannot establish that the value is visible, mask it too.
 * This reading assumes a view is a function of its input. An unchanged
 * non-string cannot be distinguished from an equal custom placeholder.
 */
export function argumentViewOf(
  tool: unknown,
  args: ToolArgs,
  input = frozenView(args),
  previous?: ToolArgs,
): ArgumentView | undefined {
  const view = viewOf(tool);
  if (view === undefined) return input === undefined ? undefined : { shown: input, hiddenArgs: [] };
  if (input === undefined || readArgumentRecord(args) === undefined) return allHidden(args);
  const output = readView(view, input, previous);
  const copy = copyArgumentDisplay(output);
  if (output === undefined || copy === undefined) return allHidden(args);

  const hiddenArgs: string[] = [];
  const uncertain: string[] = [];
  for (const key of argumentNames(input)) {
    const value = input[key];
    if (!Object.hasOwn(output, key) || !Object.is(output[key], value)) {
      hiddenArgs.push(key);
    } else if (typeof value === 'string') {
      const candidate = `\u0000agentfootprint.shownArgs.standIn:${key}`;
      const standIn = candidate === value ? `${candidate}\u0000` : candidate;
      const probe = readView(view, Object.freeze({ ...input, [key]: standIn }));
      if (probe?.[key] !== standIn) {
        hiddenArgs.push(key);
        uncertain.push(key);
      }
    }
  }
  const shown =
    uncertain.length === 0 ? copy : Object.freeze({ ...copy, ...maskArguments(uncertain) });
  return { shown, hiddenArgs: Object.freeze(hiddenArgs) };
}

/** Names only, for private-answer marks and the resume check. */
export function hiddenArgNames(tool: unknown, args: ToolArgs, shown?: ToolArgs): readonly string[] {
  if (!carriesArgumentView(tool)) return [];
  // A caller supplying the view's output compared it against this same input.
  return (
    argumentViewOf(tool, args, shown === undefined ? frozenView(args) : args, shown)?.hiddenArgs ??
    []
  );
}

/** Browser view fields. A proposal that can change before check-in is withheld conservatively. */
export function shownFieldsOf(
  tool: unknown,
  args: ToolArgs,
  protectProposal = false,
): { readonly shownArgs?: ToolArgs; readonly hiddenArgs?: readonly string[] } {
  if (!carriesArgumentView(tool)) return {};
  const view = protectProposal ? allHidden(args) : argumentViewOf(tool, args);
  return view === undefined || (!view.uncertain && view.hiddenArgs.length === 0)
    ? {}
    : { shownArgs: view.shown, hiddenArgs: view.hiddenArgs };
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
