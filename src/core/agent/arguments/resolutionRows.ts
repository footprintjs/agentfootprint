import type { InputValue } from '../../../tools/inputRequest.js';
import type { CallWindow } from '../../../time/bind.js';
import { carriesArgumentView, shownArgsOf } from '../../toolShownArgs.js';
import type { SourceCheck } from './checks.js';
import type { KeptAnswer } from './kept.js';
import type { BatchCall, CheckedArgument, SourcesArm, ToolOf } from './resolve.js';
import type { DeclaredSource } from './sources.js';
import {
  HIDDEN_VALUE,
  answeredRowOf,
  argumentRowOf,
  askedRowOf,
  sourcedRowOf,
  windowRowOf,
  type ArgumentRow,
} from './rows.js';

interface RowPorts {
  declaredDefault(toolOf: ToolOf, toolName: string, argument: string): InputValue | undefined;
  keptValue(
    toolOf: ToolOf,
    kept: readonly KeptAnswer[] | undefined,
    toolName: string,
    argument: string,
  ): InputValue | undefined;
  isFreeAsk(toolOf: ToolOf, toolName: string, argument: string): boolean;
  claimFor(
    sources: SourcesArm | undefined,
    toolCallId: string,
    argument: string,
  ): DeclaredSource | undefined;
}

/** The rule a checked argument carries — defined on every path but a free argument's. */
function ruleOf(c: CheckedArgument): 'ask' | 'assume' {
  return c.rule ?? 'assume';
}

/**
 * The row for a value the declared-sources check judged: the verdict, the
 * value (or, on an ask, the model's proposal) — each in the tool's OWN
 * argument view — and the quote, which reads `'REDACTED'` unless no tool in
 * reach can hide arguments (`quoteShown`, `quotesMayShow`).
 */
function sourcedRow(
  c: CheckedArgument & { readonly check: SourceCheck },
  toolOf: ToolOf,
  sources: SourcesArm | undefined,
  stamp: { readonly turn: number; readonly iteration: number },
  context: Readonly<Record<string, unknown>>,
  ports: RowPorts,
): ArgumentRow {
  const tool = toolOf(c.toolName);
  // A name nothing answers has no view to ask — shown as hidden, never raw.
  const shown = tool === undefined ? HIDDEN_VALUE : shownArgsOf(tool, context)[c.argument];
  const quoteShown = c.quoteShown === true;
  const quote = ports.claimFor(sources, c.toolCallId, c.argument)?.quote;
  const { check } = c;
  const asked = c.asked === 'unverified';
  return sourcedRowOf(
    {
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      argument: c.argument,
      ...(c.rule !== undefined && { rule: c.rule }),
      ...(c.period === true && { period: true as const }),
      ...(asked ? { asked: 'unverified' as const } : { source: check.source }),
      ...(!asked && { shownValue: shown }),
      // The model's own value: on an ask (it will not run) and on a default it sent (V1).
      ...((asked || check.source === 'default') && { shownProposed: shown }),
      claimed: check.claimed,
      ...(check.matched !== undefined && { matched: check.matched }),
      ...(quote !== undefined && { shownQuoteText: quoteShown ? quote : HIDDEN_VALUE }),
      ...(check.reading === true && { reading: true as const }),
      ...(check.earlier === true && { earlier: true as const }),
      ...(check.result !== undefined && { result: check.result }),
      ...(check.setAside !== undefined && { setAside: check.setAside }),
      ...(check.argumentsFrom !== undefined && { argumentsFrom: check.argumentsFrom }),
      ...(check.appSource !== undefined && { appSource: check.appSource }),
      ...(check.coincides !== undefined && { coincides: check.coincides }),
      ...(check.failed !== undefined && { failed: check.failed }),
    },
    stamp,
  );
}

/** One checked argument's row, on the unarmed paths (and a missing value's under the arm). */
function plainRow(
  c: CheckedArgument,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  kept: readonly KeptAnswer[] | undefined,
  decision: CallWindow | undefined,
  context: Readonly<Record<string, unknown>>,
  ports: RowPorts,
): ArgumentRow | undefined {
  const tool = toolOf(c.toolName);
  const who = { ...c, rule: ruleOf(c) };
  if (c.asked !== undefined) return askedRowOf(who, stamp);
  if (c.filled === true && c.window !== undefined) {
    const value = windowValue(decision, c.argument);
    if (value === undefined) return undefined;
    const shown = shownArgsOf(tool, { ...context, [c.argument]: value });
    return windowRowOf(
      {
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        argument: c.argument,
        rule: ruleOf(c),
        ...(c.period === true && { period: true as const }),
        // A name nothing answers has no view to ask — shown as hidden, never raw.
        shownValue: tool === undefined ? HIDDEN_VALUE : shown[c.argument],
        window: c.window,
      },
      stamp,
    );
  }
  if (c.filled === true && c.source === 'answered') {
    const answer = ports.keptValue(toolOf, kept, c.toolName, c.argument);
    if (answer === undefined) return undefined;
    const shown = shownArgsOf(tool, { ...context, [c.argument]: answer });
    return answeredRowOf(
      {
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        argument: c.argument,
        rule: 'ask',
        ...(c.period === true && { period: true as const }),
        // A name nothing answers has no view to ask — shown as hidden, never raw.
        shownValue: tool === undefined ? HIDDEN_VALUE : shown[c.argument],
        ...(ports.isFreeAsk(toolOf, c.toolName, c.argument) && { free: true as const }),
      },
      stamp,
    );
  }
  if (c.filled === true) {
    const assumed = ports.declaredDefault(toolOf, c.toolName, c.argument);
    if (assumed === undefined) return undefined;
    const shown = shownArgsOf(tool, { ...context, [c.argument]: assumed });
    return argumentRowOf({ ...who, source: 'default', shownValue: shown[c.argument] }, stamp);
  }
  const shown = shownArgsOf(tool, context)[c.argument];
  return argumentRowOf(
    {
      ...who,
      // A present value: the declared default the model sent itself, or the model's own
      // (`answered` is only ever a FILL, handled above).
      source: c.source === 'default' ? 'default' : 'model',
      shownValue: shown,
      ...(c.source === 'default' && { shownProposed: shown }),
    },
    stamp,
  );
}

/** The value a window fill writes into `argument`, raw — `undefined` when the decision fills none. */
function windowValue(decision: CallWindow | undefined, argument: string): unknown {
  return decision?.how === 'filled' ? decision.conversion.values[argument] : undefined;
}

/**
 * `row` with the call's dropped `from` entries counted — the call's FIRST row
 * carries the count when no basis row does (`sources.ts` · `CallSources`),
 * written before `failed`, in `ArgumentRow`'s own field order.
 */
function withMalformed(row: ArgumentRow, malformed: number): ArgumentRow {
  const { failed, ...rest } = row;
  return { ...rest, malformed, ...(failed !== undefined && { failed }) };
}

/**
 * One row per checked argument, its value in the tool's OWN argument view
 * (`shownArgsOf`) — a fill is shown as the call will run with it, a model's
 * value as the model sent it; an argument to ASK has no value yet, so its row
 * carries none (under declared sources, the model's proposal rides as
 * `proposed`); a kept answer files `answered` (`free` for a free-text field),
 * exactly as the answer did when the person gave it. Under declared sources a
 * present value's row carries the check's verdict (`claimed`, `matched`,
 * `quote`, `failed`, …), and the call's first row carries the count of its
 * dropped `from` entries when no basis row does. The raw value never reaches
 * a row.
 */
export function composeResolutionRows(
  checked: readonly CheckedArgument[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  kept: readonly KeptAnswer[] | undefined,
  sources: SourcesArm | undefined,
  decisions: ReadonlyMap<string, CallWindow> | undefined,
  ports: RowPorts,
): ArgumentRow[] {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const contexts = new Map<string, Readonly<Record<string, unknown>>>();
  const rows: ArgumentRow[] = [];
  const counted = new Set<string>();
  for (const c of checked) {
    const call = byId.get(c.toolCallId);
    if (call === undefined) continue;
    let context = contexts.get(call.id);
    if (context === undefined) {
      context = fullRowContext(call, checked, toolOf, kept, decisions?.get(call.id), ports);
      contexts.set(call.id, context);
    }
    const row =
      c.check !== undefined
        ? sourcedRow({ ...c, check: c.check }, toolOf, sources, stamp, context, ports)
        : plainRow(c, toolOf, stamp, kept, decisions?.get(c.toolCallId), context, ports);
    if (row === undefined) continue;
    const malformed = sources?.declared.get(c.toolCallId)?.malformed;
    if (malformed !== undefined && malformed > 0 && !counted.has(c.toolCallId)) {
      counted.add(c.toolCallId);
      rows.push(withMalformed(row, malformed));
      continue;
    }
    rows.push(row);
  }
  return rows;
}

/** Only real private views need sibling fills; an ordinary call keeps its exact argument reference. */
function fullRowContext(
  call: BatchCall,
  checked: readonly CheckedArgument[],
  toolOf: ToolOf,
  kept: readonly KeptAnswer[] | undefined,
  decision: CallWindow | undefined,
  ports: RowPorts,
): Readonly<Record<string, unknown>> {
  if (!carriesArgumentView(toolOf(call.name))) return call.args;
  const filled: Record<string, unknown> = { ...call.args };
  for (const item of checked) {
    if (item.toolCallId !== call.id || item.filled !== true || item.asked !== undefined) continue;
    const value =
      item.source === 'answered'
        ? ports.keptValue(toolOf, kept, item.toolName, item.argument)
        : ports.declaredDefault(toolOf, item.toolName, item.argument);
    if (value !== undefined) filled[item.argument] = value;
  }
  if (decision?.how === 'filled') Object.assign(filled, decision.conversion.values);
  return filled;
}
