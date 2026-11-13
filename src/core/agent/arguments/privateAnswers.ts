import {
  canStorePrivateFields,
  markPrivateFields,
  privateFieldsInForce,
} from '../../../redaction/runRedaction.js';
import type { PrivateFieldRoot, PrivateRecordFields } from '../../../redaction/privateFields.js';
import { carriesArgumentView, hiddenArgNames } from '../../toolShownArgs.js';
import { frozenView } from '../../../lib/frozenCopy.js';
import type { Tool } from '../../../tools/tools.js';
import type { ToolArgs } from '../../../tools/runChain.js';
import type { ArgumentAskState } from './ask.js';
import type { ArgumentResolution, BatchCall, ToolOf } from './resolve.js';

type Selection = { readonly root: PrivateFieldRoot; readonly path: string };
interface KeptIdentity {
  readonly turn: number;
  readonly toolName: string;
  readonly argument: string;
}
export interface KeptToolContext {
  readonly toolName: string;
  readonly tool: Tool | undefined;
  /** The actual filled arguments; privacy views may depend on public siblings. */
  readonly args: ToolArgs;
  /** Admitted privacy from this call's resolved working state, even without its tool. */
  readonly privateArguments?: ReadonlySet<string>;
}
type Calls = readonly Pick<BatchCall, 'id' | 'name' | 'args'>[];
type SettledFills = ReadonlyMap<string, { readonly fills?: ArgumentResolution['fills'] }>;
const whole = (root: PrivateFieldRoot): Selection[] => [{ root, path: '' }];

class PrivateArgumentRecordError extends Error {
  readonly code = 'ERR_PRIVATE_ARGUMENT_RECORD';
  constructor() {
    super('A private argument question requires native private-field recording support.');
    this.name = 'PrivateArgumentRecordError';
  }
}

/** No mapper means no scope/capability read and no new obligation. */
export function requirePrivateQuestionSupport(scope: object, tools: readonly unknown[]): void {
  if (!tools.some(carriesArgumentView)) return;
  if (!canStorePrivateFields(scope)) throw new PrivateArgumentRecordError();
}

/** Only privacy-bearing runs inspect extra raw working values at their writer seam. */
export function privateAnswersInPlay(scope: object, tools: readonly unknown[]): boolean {
  return tools.some(carriesArgumentView) || privateFieldsInForce(scope) !== undefined;
}

function own(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}
function identity(value: unknown): KeptIdentity | undefined {
  const turn = own(value, 'turn'),
    toolName = own(value, 'toolName'),
    argument = own(value, 'argument');
  return typeof turn === 'number' &&
    Number.isSafeInteger(turn) &&
    turn >= 0 &&
    typeof toolName === 'string' &&
    typeof argument === 'string'
    ? { turn, toolName, argument }
    : undefined;
}
const logicalKey = (value: KeptIdentity) =>
  JSON.stringify([value.turn, value.toolName, value.argument]);

/** Prior admitted index facts become names/turns, never a scan for private values. */
function keptFacts(prior: PrivateRecordFields | undefined, before: unknown) {
  const hidden = new Set<string>();
  if (prior?.keys.includes('argumentAnswersKept')) return { hidden, unknown: true };
  for (const path of prior?.fields.argumentAnswersKept ?? []) {
    const index = /^(0|[1-9][0-9]*)\.value$/.exec(path)?.[1];
    const row =
      index === undefined || !Array.isArray(before) ? undefined : identity(own(before, index));
    if (row === undefined) return { hidden, unknown: true };
    hidden.add(logicalKey(row));
  }
  return { hidden, unknown: false };
}

/** The view runs on a frozen copy: it is the tool author's code, and `args` may be what runs. */
function hiddenKeys(tool: unknown, args: ToolArgs): ReadonlySet<string> {
  return new Set(hiddenArgNames(tool, frozenView(args) ?? args));
}

/** Resolve index selectors to this exact call/iteration, never by matching answer values. */
export function privateResolutionArguments(
  prior: PrivateRecordFields | undefined,
  rows: unknown,
  resolution: ArgumentResolution | undefined,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  if (resolution === undefined) return hidden;
  const all = () => new Set((resolution.fills ?? []).map((fill) => fill.argument));
  if (prior?.keys.includes('argumentResolutions')) return all();
  for (const path of prior?.fields.argumentResolutions ?? []) {
    const match = /^(0|[1-9][0-9]*)\.fills\.(0|[1-9][0-9]*)\.value$/.exec(path);
    const row = match === null || !Array.isArray(rows) ? undefined : own(rows, match[1]);
    if (row === undefined) return all();
    if (
      own(row, 'toolCallId') !== resolution.toolCallId ||
      own(row, 'iteration') !== resolution.iteration
    )
      continue;
    const fills = own(row, 'fills');
    const argument = match === null ? undefined : own(own(fills, match[2]), 'argument');
    if (typeof argument !== 'string') return all();
    hidden.add(argument);
  }
  return hidden;
}

/** The actual filled call view plus already-admitted privacy; plain runs read no state. */
export function privateFilledArguments(
  scope: { readonly argumentResolutions?: readonly ArgumentResolution[] } | undefined,
  tool: Tool | undefined,
  args: ToolArgs,
  resolution: ArgumentResolution | undefined,
): ReadonlySet<string> {
  const hidden = new Set(hiddenKeys(tool, args));
  const prior = scope === undefined ? undefined : privateFieldsInForce(scope);
  if (prior === undefined || resolution === undefined) return hidden;
  const rows = prior.keys.includes('argumentResolutions')
    ? undefined
    : (prior.fields.argumentResolutions?.length ?? 0) > 0
    ? scope?.argumentResolutions
    : undefined;
  for (const argument of privateResolutionArguments(prior, rows, resolution)) hidden.add(argument);
  return hidden;
}
function filledArgs(args: ToolArgs, fills: ArgumentResolution['fills']): Record<string, unknown> {
  return Object.assign(
    {},
    args,
    Object.fromEntries((fills ?? []).map((fill) => [fill.argument, fill.value])),
  );
}
function mark(scope: object, selections: readonly Selection[]): void {
  if (selections.length > 0) markPrivateFields(scope, selections);
}

/** Raw progress is private only when its actual filled arguments differ from their shown view. */
export function privateAskSelections(
  state: ArgumentAskState,
  calls: Calls,
  toolOf: ToolOf,
  settled: SettledFills,
  base?: SettledFills,
): Selection[] {
  const byId = new Map(calls.map((call) => [call.id, call]));
  return state.fields.flatMap((field, index) => {
    const progress = state.progress[index];
    if (progress?.answer === undefined && progress?.fills === undefined) return [];
    const hidden = field.members.some((member) =>
      member.toolCallIds.some((id) => {
        const call = byId.get(id),
          tool = toolOf(member.toolName);
        // The declaration disappearing cannot declassify an answer already bound to it.
        if (call === undefined || tool === undefined) return true;
        const args = filledArgs(call.args, [
          ...(base?.get(id)?.fills ?? []),
          ...(settled.get(id)?.fills ?? []),
        ]);
        if (progress.answer !== undefined && !Object.hasOwn(args, member.argument))
          args[member.argument] = progress.answer;
        const selected = hiddenKeys(tool, args);
        const arguments_ = progress.fills?.[id]?.values;
        return (arguments_ === undefined ? [member.argument] : Object.keys(arguments_)).some(
          (argument) => selected.has(argument),
        );
      }),
    );
    if (!hidden) return [];
    return [
      ...(progress.answer !== undefined
        ? [{ root: 'argumentAsk' as const, path: `progress.${index}.answer` }]
        : []),
      ...(progress.fills !== undefined
        ? [{ root: 'argumentAsk' as const, path: `progress.${index}.fills` }]
        : []),
    ];
  });
}

export function markPrivateAsk(
  scope: object,
  state: ArgumentAskState,
  calls: Calls,
  toolOf: ToolOf,
  settled: SettledFills,
  base?: SettledFills,
): void {
  // Missing implementations keep the dispatcher's ordinary unavailable-call path.
  // Only an actual view or admitted private carrier can create private writes.
  if (
    !privateAnswersInPlay(
      scope,
      calls.map((call) => toolOf(call.name)),
    )
  )
    return;
  mark(scope, privateAskSelections(state, calls, toolOf, settled, base));
}

/** Keep privacy across list reorder/drop/replacement by logical identity, not old indices. */
export function privateKeptSelections(
  prior: PrivateRecordFields | undefined,
  before: unknown,
  after: unknown,
  turn: number,
  context?: KeptToolContext,
): Selection[] {
  if (after === undefined || (Array.isArray(after) && after.length === 0)) return [];
  const facts = keptFacts(prior, before);
  if (facts.unknown || !Array.isArray(after)) return whole('argumentAnswersKept');
  const hidden = new Set(context === undefined ? [] : hiddenKeys(context.tool, context.args));
  for (const argument of context?.privateArguments ?? []) hidden.add(argument);
  const selections: Selection[] = [];
  for (let index = 0; index < after.length; index++) {
    const row = identity(own(after, index));
    if (row === undefined) return whole('argumentAnswersKept');
    if (
      facts.hidden.has(logicalKey(row)) ||
      (row.turn === turn && row.toolName === context?.toolName && hidden.has(row.argument))
    )
      selections.push({ root: 'argumentAnswersKept', path: `${index}.value` });
  }
  return selections;
}

export function markPrivateKept(
  scope: object,
  before: unknown,
  after: unknown,
  turn: number,
  context?: KeptToolContext,
): void {
  mark(scope, privateKeptSelections(privateFieldsInForce(scope), before, after, turn, context));
}

/** Call IDs locate this batch; the prior kept fact is the tool/argument/turn identity. */
export function privateResolutionSelections(
  prior: PrivateRecordFields | undefined,
  rows: readonly ArgumentResolution[],
  calls: Calls,
  toolOf: ToolOf,
  turn: number,
  kept?: unknown,
): Selection[] {
  const facts = keptFacts(prior, kept);
  if (facts.unknown && rows.some((row) => (row.fills?.length ?? 0) > 0))
    return whole('argumentResolutions');
  const byId = new Map(calls.map((call) => [call.id, call]));
  const selections: Selection[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const fills = row.fills ?? [];
    if (fills.length === 0) continue;
    const call = byId.get(row.toolCallId);
    if (call === undefined) return whole('argumentResolutions');
    const hidden = hiddenKeys(toolOf(call.name), filledArgs(call.args, row.fills));
    for (let fillIndex = 0; fillIndex < fills.length; fillIndex++) {
      const argument = fills[fillIndex].argument;
      if (
        hidden.has(argument) ||
        facts.hidden.has(logicalKey({ turn, toolName: call.name, argument }))
      )
        selections.push({ root: 'argumentResolutions', path: `${index}.fills.${fillIndex}.value` });
    }
  }
  return selections;
}

export function markPrivateResolutions(
  scope: object,
  rows: readonly ArgumentResolution[],
  calls: Calls,
  toolOf: ToolOf,
  turn: number,
  kept?: unknown,
): void {
  mark(
    scope,
    privateResolutionSelections(privateFieldsInForce(scope), rows, calls, toolOf, turn, kept),
  );
}

export function markPrivateCheckIn(scope: object, tool: Tool, args: ToolArgs): void {
  mark(
    scope,
    [...hiddenKeys(tool, args)].map((path) => ({ root: 'pausedCheckInArgs', path })),
  );
}
