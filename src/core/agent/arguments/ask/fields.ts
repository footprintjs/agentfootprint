import type { InputField, InputValue } from '../../../../tools/inputRequest.js';
import {
  convertForTool,
  formArguments,
  granularityMsOf,
  periodFactProblem,
  toolFacts,
  type PeriodFacts,
  type TimeRefusal,
} from '../../../../time/convert.js';
import { parseRange, type TimeRange } from '../../../../time/range.js';
import type { ZoneName } from '../../../../time/zone.js';
import {
  convertSpelling,
  isRefused,
  periodFactsOf,
  periodFormsOf,
  rulesOf,
  type PeriodSpelling,
  type RuledArgument,
} from '../../../../tools/declare.js';
import type { PartialOrigin } from '../partialWindow.js';
import type { BatchCall, ToolOf } from '../resolve.js';
import { WINDOW_FORM_EXPECTATION } from './constants.js';
import type { AskField, AskMember, AskTime, CallAsk, WindowAskPlan } from './types.js';
import { factExpectation } from './validation.js';

/**
 * Why one member tool cannot read a window the ask would put into it — the
 * one owner's answer (`time/convert.ts` · `convertForTool`: a fact it
 * breaks, `multi-day`, or `no-form-holds`) — or `undefined` when it can. A
 * tool whose rules cannot be read has nothing to say here.
 */
function unreadableBy(
  toolName: string,
  range: TimeRange,
  zone: ZoneName | undefined,
  toolOf: ToolOf,
  time: Pick<AskTime, 'now' | 'appZone' | 'zone'>,
): { readonly refused: TimeRefusal; readonly facts: PeriodFacts } | undefined {
  const rules = rulesOf(toolOf(toolName));
  if (rules === undefined || isRefused(rules)) return undefined;
  const facts = periodFactsOf(rules.period);
  const at = zone ?? time.zone;
  if (at === undefined) {
    // No form chosen yet: the tool's facts, `maxRange` the widest any form reads (`toolFacts`).
    const judged = toolFacts(periodFormsOf(rules.period), facts);
    const problem = periodFactProblem(range, judged, time.now);
    return problem === undefined ? undefined : { refused: problem, facts: judged };
  }
  const read = convertForTool({ range }, periodFormsOf(rules.period), facts, {
    now: time.now,
    zone: at,
    ...(time.appZone !== undefined && { appZone: time.appZone }),
    granularityMs: granularityMsOf(facts),
  });
  return 'refused' in read
    ? { refused: read.refused, facts: toolFacts(periodFormsOf(rules.period), facts) }
    : undefined;
}

/**
 * The indexes of the choices EVERY member tool can read (§ 6.3: "some
 * readings inside the tool's `direction` → the ones inside as choices" — and,
 * by the same law, a reading no form of the tool can hold is not offered) —
 * `undefined` when none is left (several tools that disagree: every choice
 * is offered, and the answer is judged against each tool).
 */
export function allowedChoices(
  choices: readonly string[],
  zones: readonly (ZoneName | undefined)[] | undefined,
  members: readonly { readonly toolName: string }[],
  toolOf: ToolOf,
  time: Pick<AskTime, 'now' | 'appZone' | 'zone'>,
): number[] | undefined {
  const names = [...new Set(members.map((m) => m.toolName))];
  const kept = choices.flatMap((value, i) => {
    const range = parseRange(value);
    if (range === undefined) return [];
    const zone = zones?.[i];
    return names.every((name) => unreadableBy(name, range, zone, toolOf, time) === undefined)
      ? [i]
      : [];
  });
  return kept.length > 0 ? kept : undefined;
}

/** A window field's choices narrowed to `kept` (its labels and zones with them). */
export function narrowed(field: AskField, kept: readonly number[] | undefined): AskField {
  const window = field.window;
  if (kept === undefined || field.choices === undefined || window === undefined) return field;
  const pick = <T>(list: readonly T[] | undefined) =>
    list === undefined ? undefined : kept.map((i) => list[i] as T);
  const labels = pick(window.labels);
  const zones = pick(window.zones);
  return {
    ...field,
    choices: pick(field.choices) as readonly InputValue[],
    window: {
      ...window,
      ...(labels !== undefined && { labels }),
      ...(zones !== undefined && { zones }),
    },
  };
}

/** The arguments of every period form a tool declares — what a window fills. */
function formArgumentsOfTool(toolOf: ToolOf, toolName: string): ReadonlySet<string> {
  const rules = rulesOf(toolOf(toolName));
  if (rules === undefined || isRefused(rules)) return new Set();
  return new Set(
    periodFormsOf(rules.period).flatMap((f) => formArguments(f).map((a) => a.argument)),
  );
}

const RULED_ASK_TYPES: Readonly<Record<RuledArgument['type'], InputField['type']>> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
};

/** One ruled argument's `ask` rule, read off the implementation that will answer the name. */
function askRuleOf(
  toolOf: ToolOf,
  toolName: string,
  argument: string,
): { readonly rule: RuledArgument; readonly spelling?: PeriodSpelling } | undefined {
  const rules = rulesOf(toolOf(toolName));
  if (rules === undefined || isRefused(rules)) return undefined;
  const rule = rules.ruled.find((r) => r.argument === argument);
  if (rule === undefined || rule.ask === undefined) return undefined;
  const spelling = rule.period === true ? rules.period?.spelling : undefined;
  return { rule, ...(spelling !== undefined && { spelling }) };
}

// The one conversion between declared period spellings lives beside the
// spellings themselves (`tools/declare.ts` · `convertSpelling`); re-exported here,
// where the batch ask's readers have always found it.
export { convertSpelling };

const CONVERTIBLE: readonly PeriodSpelling[] = ['lookback', 'signed-lookback'];

/**
 * Whether the period field `b` may share `a`'s field: both declare a spelling
 * the library converts, both declare choices, and the choices are the SAME
 * periods under the conversion — so every choice the person can pick is a
 * valid choice of each argument, whichever member's spelling it is read in.
 */
export function periodsShareField(a: AskField, b: AskField): boolean {
  if (a.spelling === undefined || b.spelling === undefined) return false;
  if (!CONVERTIBLE.includes(a.spelling) || !CONVERTIBLE.includes(b.spelling)) return false;
  if (a.choices === undefined || b.choices === undefined) return false;
  if (a.choices.length !== b.choices.length) return false;
  const bSet = new Set(b.choices);
  return a.choices.every((choice) => {
    const converted = convertSpelling(
      choice,
      a.spelling as PeriodSpelling,
      b.spelling as PeriodSpelling,
    );
    return converted !== undefined && bSet.has(converted);
  });
}

/** A field being gathered: its shape, its one member, the calls that need it. */
interface PendingField {
  readonly field: Omit<AskField, 'members'>;
  readonly member: Omit<AskMember, 'toolCallIds' | 'quoted'>;
  readonly ids: string[];
  /** The first reading's words among the calls that need it. */
  quoted?: string;
}

function pendingFieldOf(
  toolName: string,
  argument: string,
  read: { readonly rule: RuledArgument; readonly spelling?: PeriodSpelling },
  toolCallId: string,
): PendingField {
  const ask = read.rule.ask as NonNullable<RuledArgument['ask']>;
  return {
    field: {
      type: RULED_ASK_TYPES[read.rule.type],
      question: ask.question,
      ...(ask.choices !== undefined && { choices: ask.choices }),
      ...(read.spelling !== undefined && { spelling: read.spelling }),
    },
    member: {
      toolName,
      argument,
      ...(read.rule.period === true && { period: true as const }),
      ...(read.spelling !== undefined && { spelling: read.spelling }),
    },
    ids: [toolCallId],
  };
}

/** Each field merged into an earlier one it shares a period with (`periodsShareField`). */
function mergeSharedPeriods(fields: readonly AskField[]): AskField[] {
  const merged: AskField[] = [];
  for (const field of fields) {
    const host = merged.findIndex((f) => periodsShareField(f, field));
    if (host < 0) merged.push(field);
    else merged[host] = { ...merged[host], members: [...merged[host].members, ...field.members] };
  }
  return merged;
}

/**
 * The batch ask's fields: one per distinct (tool, argument) the calls left out,
 * in first-seen batch order, each bound to every call that needs it; then a
 * period field merged into an earlier one it shares (`periodsShareField`). An
 * argument whose rule cannot be read here is left out — the dispatch re-read
 * refuses its call.
 */
export function planAskFields(
  asks: readonly CallAsk[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  windowPlan?: WindowAskPlan,
): AskField[] {
  const nameOf = new Map(calls.map((c) => [c.id, c.name]));
  // Keyed by tool, then argument — a map of maps, never a joined key.
  const byTool = new Map<string, Map<string, PendingField>>();
  const order: PendingField[] = [];
  // The lazy word-driven ask: a call's PERIOD arguments join the one window field.
  const windowMembers = new Map<string, Map<string, string[]>>();
  for (const entry of asks) {
    const toolName = nameOf.get(entry.toolCallId);
    if (toolName === undefined) continue;
    const forTool = byTool.get(toolName) ?? new Map<string, PendingField>();
    byTool.set(toolName, forTool);
    const periodArguments =
      windowPlan !== undefined && entry.window === true
        ? formArgumentsOfTool(toolOf, toolName)
        : new Set<string>();
    for (const argument of entry.ask) {
      if (periodArguments.has(argument)) {
        const forWindow = windowMembers.get(toolName) ?? new Map<string, string[]>();
        windowMembers.set(toolName, forWindow);
        const ids = forWindow.get(argument) ?? [];
        if (!ids.includes(entry.toolCallId)) ids.push(entry.toolCallId);
        forWindow.set(argument, ids);
        continue;
      }
      const quote = entry.quoted?.find((q) => q.argument === argument)?.quote;
      const seen = forTool.get(argument);
      if (seen !== undefined) {
        if (!seen.ids.includes(entry.toolCallId)) seen.ids.push(entry.toolCallId);
        if (seen.quoted === undefined && quote !== undefined) seen.quoted = quote;
        continue;
      }
      const read = askRuleOf(toolOf, toolName, argument);
      if (read === undefined) continue;
      const pending = pendingFieldOf(toolName, argument, read, entry.toolCallId);
      if (quote !== undefined) pending.quoted = quote;
      forTool.set(argument, pending);
      order.push(pending);
    }
  }
  const fields = mergeSharedPeriods(
    order.map((p) => ({
      ...p.field,
      members: [
        {
          ...p.member,
          toolCallIds: [...p.ids],
          ...(p.quoted !== undefined && { quoted: p.quoted }),
        },
      ],
    })),
  );
  if (windowPlan === undefined || windowMembers.size === 0) return fields;
  const window = windowFieldOf(windowPlan, windowMembers);
  const kept =
    window.choices === undefined
      ? undefined
      : allowedChoices(
          window.choices as readonly string[],
          windowPlan.zones,
          window.members,
          toolOf,
          windowPlan,
        );
  return [narrowed(window, kept), ...fields];
}

/** The ONE window field: the open mention's question, bound to every call's period arguments. */
function windowFieldOf(
  plan: WindowAskPlan,
  members: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>,
): AskField {
  return {
    type: 'string',
    question: plan.question,
    ...(plan.choices !== undefined && { choices: plan.choices }),
    members: [...members].flatMap(([toolName, byArgument]) =>
      [...byArgument].map(([argument, ids]) => ({
        toolName,
        argument,
        period: true as const,
        toolCallIds: [...ids],
      })),
    ),
    window: {
      format: plan.format,
      ...(plan.reply !== undefined && { reply: plan.reply }),
      ...(plan.labels !== undefined && { labels: plan.labels }),
      ...(plan.zones !== undefined && { zones: plan.zones }),
      mention: plan.mention,
    },
  };
}

/** One genuine native meaning field; valid members remain available for identity and exhaustion. */
export function confirmationField(
  plan: WindowAskPlan,
  origins: readonly PartialOrigin[],
  fillAsks: readonly CallAsk[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
): AskField {
  const members = new Map<string, Map<string, string[]>>();
  const add = (name: string, argument: string, id: string) => {
    const args = members.get(name) ?? new Map<string, string[]>();
    members.set(name, args);
    const ids = args.get(argument) ?? [];
    if (!ids.includes(id)) ids.push(id);
    args.set(argument, ids);
  };
  for (const origin of origins) {
    for (const argument of origin.arguments) add(origin.call.name, argument, origin.call.id);
  }
  for (const ask of fillAsks) {
    const call = calls.find((c) => c.id === ask.toolCallId);
    if (call === undefined) continue;
    for (const argument of formArgumentsOfTool(toolOf, call.name))
      add(call.name, argument, call.id);
  }
  const field = windowFieldOf(plan, members);
  return {
    ...field,
    question:
      plan.question +
      ' This confirms your time words; a separately completed tool range stays unchanged.',
    window: {
      ...field.window!,
      role: 'confirm-meaning',
      confirmOnlyIds: origins.map((o) => o.call.id),
    },
  };
}

/** Why the first reading cannot be read, when ONE member tool can read no reading at all — the refusal's words. */
export function readingsOutside(
  choices: readonly string[],
  zones: readonly (ZoneName | undefined)[],
  members: readonly { readonly toolName: string }[],
  toolOf: ToolOf,
  time: Pick<AskTime, 'now' | 'appZone' | 'zone'>,
): string | undefined {
  for (const name of new Set(members.map((m) => m.toolName))) {
    const reasons = choices.map((value, i) => {
      const range = parseRange(value);
      return range === undefined ? undefined : unreadableBy(name, range, zones[i], toolOf, time);
    });
    const first = reasons[0];
    if (first !== undefined && reasons.every((r) => r !== undefined)) {
      return refusalExpectation(first.refused, first.facts);
    }
  }
  return undefined;
}

/** What an answer must be, in the refusal's words, when a tool cannot read it: its fact, else a form that holds it. */
export function refusalExpectation(refused: TimeRefusal, facts: PeriodFacts): string {
  return refused === 'time-future' ||
    refused === 'time-past' ||
    refused === 'beyond-retention' ||
    refused === 'over-max-range'
    ? factExpectation(refused, facts)
    : WINDOW_FORM_EXPECTATION;
}
