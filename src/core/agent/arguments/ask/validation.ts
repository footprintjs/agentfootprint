import type { InputValue } from '../../../../tools/inputRequest.js';
import { validatePropertyValue } from '../../../../tools/toolArgsValidation.js';
import {
  formArguments,
  formFacts,
  periodFactProblem,
  readBack,
  readBackLacksZone,
  type PeriodFactProblem,
  type PeriodFacts,
  type PeriodForm,
} from '../../../../time/convert.js';
import { isRefused, periodFactsOf, periodFormsOf, rulesOf } from '../../../../tools/declare.js';
import { memberValue } from '../answerRows.js';
import type { BatchCall, ToolOf } from '../resolve.js';
import { WINDOW_FORM_EXPECTATION } from './constants.js';
import type { ArgumentAskState, AskField, AskMember, AskTime } from './types.js';

/** The property schema a member's argument is judged against, off the implementation that will run. */
export function propertyOf(
  toolOf: ToolOf,
  member: AskMember,
): Readonly<Record<string, unknown>> | undefined {
  const properties = toolOf(member.toolName)?.schema.inputSchema?.properties;
  const property =
    typeof properties === 'object' && properties !== null
      ? (properties as Record<string, unknown>)[member.argument]
      : undefined;
  return typeof property === 'object' && property !== null
    ? (property as Readonly<Record<string, unknown>>)
    : undefined;
}

/**
 * Whether `answer` fits EVERY member's property schema (in the member's own
 * spelling) — the re-check the typed ask cannot do: an integer asked as a
 * number, a `pattern`, a string length (never a numeric bound — the one
 * validator ignores `minimum` / `maximum`). The rule is re-read through the
 * same resolver.
 * `expected` names what a misfit failed — the schema's expectation, never the
 * answer.
 */
export function checkAnswer(
  field: AskField,
  answer: InputValue,
  toolOf: ToolOf,
  time?: AskTime,
): { readonly fits: boolean; readonly expected?: string } {
  for (const member of field.members) {
    const value = memberValue(field, member, answer);
    if (value === undefined) {
      return { fits: false, expected: `a value spelled '${field.spelling ?? 'as declared'}'` };
    }
    const verdict = validatePropertyValue(value, propertyOf(toolOf, member));
    if (!verdict.ok) {
      const expected = verdict.issues[0]?.expected;
      return { fits: false, ...(expected !== undefined && { expected }) };
    }
    const fact = time === undefined ? undefined : factBroken(toolOf, member, value, time);
    if (fact !== undefined)
      return { fits: false, expected: factExpectation(fact.problem, fact.facts) };
  }
  return { fits: true };
}

/**
 * The tool's declared fact an answer for its period argument breaks (the time
 * layer, step T5a — `time/convert.ts` · `periodFactProblem`): the answer,
 * read back through the single-argument form that names the argument, against
 * `direction`, `retention` and `maxRange` at the turn's clock. `undefined` for
 * a tool that declares none of the three, an argument no single-argument form
 * names (one bound of two), or an answer no form reads back.
 */
function factBroken(
  toolOf: ToolOf,
  member: AskMember,
  value: InputValue,
  time: AskTime,
): { readonly problem: PeriodFactProblem; readonly facts: PeriodFacts } | undefined {
  if (member.period !== true) return undefined;
  const rules = rulesOf(toolOf(member.toolName));
  if (rules === undefined || isRefused(rules)) return undefined;
  const declared = periodFactsOf(rules.period);
  const forms = periodFormsOf(rules.period);
  if (!declaresFacts(declared, forms)) return undefined;
  for (const form of forms) {
    if (form.kind === 'bounds' || form.kind === 'object' || form.argument !== member.argument)
      continue;
    const range = readBack({ [member.argument]: value }, form, time);
    if (range === undefined) continue;
    // Read back through THIS form, so held to this form's own `maxRange` (`formFacts`).
    const facts = formFacts(form, declared);
    const problem = periodFactProblem(range, facts, time.now);
    return problem === undefined ? undefined : { problem, facts };
  }
  return undefined;
}

/** Whether a tool declares any fact a range can break — a period fact, or a form's own `maxRange`. */
function declaresFacts(facts: PeriodFacts, forms: readonly PeriodForm[]): boolean {
  return (
    facts.direction !== undefined ||
    facts.retention !== undefined ||
    facts.maxRange !== undefined ||
    forms.some((f) => f.maxRange !== undefined)
  );
}

/**
 * The period fields whose answers break a tool's fact only TOGETHER — one
 * bound of two (`start_time`, `end_time`) is no window, so {@link checkAnswer}
 * cannot judge it alone (`factBroken` reads single-argument forms only). Per
 * call, the answers this pass carries and the ones an earlier round bound are
 * written over the call's own arguments; every `bounds` / `object` form whose
 * arguments are then all present is read back (`convert.ts` · `readBack`) and
 * judged against `direction`, `retention` and `maxRange` at the turn's clock
 * (`periodFactProblem`). A pair that breaks one sends each of its fields
 * asked in this pass back to be asked again, naming the fact; a pair whose
 * bounds are all present yet name no window (the end given before the start)
 * goes back the same way, naming the window form — the same
 * bounded re-ask a single argument gets, so a future start and end the
 * person gave never reach a tool whose source holds only the past, with or
 * without the reader.
 */
export function pairsBroken(
  state: ArgumentAskState,
  values: Readonly<Record<string, InputValue>>,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  time: AskTime | undefined,
): ReadonlyMap<number, string> {
  const broken = new Map<number, string>();
  const waiting = state.waiting;
  if (time === undefined || waiting === undefined) return broken;
  const now = new Map(waiting.fieldIndexes.map((index, k) => [index, values[`f${k + 1}`]]));
  // Per call: its tool, and each period argument's answer with the field it came from.
  const perCall = new Map<
    string,
    { toolName: string; answers: Map<string, { value: InputValue; field: number }> }
  >();
  state.fields.forEach((field, index) => {
    if (field.window !== undefined) return;
    const answer = now.has(index) ? now.get(index) : state.progress[index]?.answer;
    if (answer === undefined) return;
    for (const member of field.members) {
      if (member.period !== true) continue;
      const value = memberValue(field, member, answer);
      if (value === undefined) continue;
      for (const id of member.toolCallIds) {
        const entry = perCall.get(id) ?? { toolName: member.toolName, answers: new Map() };
        entry.answers.set(member.argument, { value, field: index });
        perCall.set(id, entry);
      }
    }
  });
  for (const [id, { toolName, answers }] of perCall) {
    const call = byId.get(id);
    const rules = rulesOf(toolOf(toolName));
    if (call === undefined || rules === undefined || isRefused(rules)) continue;
    const declared = periodFactsOf(rules.period);
    if (!declaresFacts(declared, periodFormsOf(rules.period))) continue;
    const args: Record<string, unknown> = { ...call.args };
    for (const [argument, { value }] of answers) args[argument] = value;
    for (const form of periodFormsOf(rules.period)) {
      if (form.kind !== 'bounds' && form.kind !== 'object') continue;
      // A zone argument the rule assumes is not in the call yet; `readBack` answers without one.
      const names = formArguments(form).map((a) => a.argument);
      const bounds = formArguments(form).filter((a) => a.role !== 'zone');
      const asked = names.filter((a) => answers.has(a));
      if (asked.length === 0 || bounds.some((a) => args[a.argument] === undefined)) continue;
      const range = readBack(args, form, time);
      // Every bound is present: no range means the pair names no window (a start not before its
      // end, a misspelled bound) — never "no problem", or it reaches the tool unjudged. Only a
      // zone still to come leaves the pair for the zone's own ask.
      const facts = formFacts(form, declared);
      const expectation =
        range !== undefined
          ? pairExpectation(periodFactProblem(range, facts, time.now), facts)
          : readBackLacksZone(args, form, time)
          ? undefined
          : WINDOW_FORM_EXPECTATION;
      if (expectation === undefined) continue;
      for (const a of asked) {
        const field = (answers.get(a) as { field: number }).field;
        if (now.has(field) && !broken.has(field)) broken.set(field, expectation);
      }
    }
  }
  return broken;
}

/** A pair's fact problem in the refusal's words — `undefined` when the pair breaks none. */
function pairExpectation(
  problem: PeriodFactProblem | undefined,
  facts: PeriodFacts,
): string | undefined {
  return problem === undefined ? undefined : factExpectation(problem, facts);
}

// LENS · tool-result · persistent-history (through `core/agent/arguments/serve.ts` · `unansweredRefusal`)
// reads: the tool's declared fact the person's answers kept breaking, and its declared value
// law: names the rule, never the answer; a fact about the source, in the present tense of the source.
/**
 * What an answer for a period argument must be, in the words the refusal of
 * an exhausted ask names it (`core/agent/arguments/serve.ts` · `unansweredRefusal`'s `expected`) —
 * the tool's own fact, never the person's answer.
 */
export function factExpectation(problem: PeriodFactProblem, facts: PeriodFacts): string {
  switch (problem) {
    case 'time-future':
      return 'a window that has already happened (the source holds only the past)';
    case 'time-past':
      return 'a window still to come (the source holds only the future)';
    case 'beyond-retention':
      return `a window inside what the source keeps (${facts.retention ?? 'its retention'})`;
    case 'over-max-range':
      return `a window no wider than ${facts.maxRange ?? 'the source reads at once'}`;
  }
}
