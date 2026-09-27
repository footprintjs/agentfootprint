/**
 * arguments/serve — what the inputs layer says, and to whom.
 *
 * Pattern: Lens. Pure composers, one per served surface: the ruled tool's
 *          SCHEMA (a rebuilt copy per request, never the registry reference),
 *          the past-tense NOTE on a result whose call ran on a filled value
 *          (a declared default, or the person's answer to the batch ask), the
 *          REFUSALS a call reads when it does not run, and the "Assumed"
 *          block under an existing `.limitsTravelWithTheAnswer()`.
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). Every
 *          sentence here is registered in `test/modelFacingSurfaces.test.ts`:
 *          it says what the model may do and what the record keeps, and
 *          promises no outcome a later path can break.
 * Emits:   N/A.
 *
 * ## The value in a sentence goes through the tool's own view
 *
 * A served schema and a served tool message are both part of the record. When
 * the tool's argument view (`core/toolShownArgs.ts` · `shownArgsOf`) hides a
 * ruled argument, no sentence here prints its value — it says the value is
 * hidden by the tool's view instead.
 */

import type { LLMToolSchema } from '../../../adapters/types.js';
import { shownArgsOf } from '../../toolShownArgs.js';
import type { InputValue } from '../../inputRequest.js';
import { isRefused, rulesOf, type RuledToolLike } from './declare.js';

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A declared value as a sentence prints it: a string quoted, a number or boolean bare. */
export function printedValue(value: InputValue): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Whether the tool's own argument view hides `argument` — asked with a probe
 * of the declared value, so the answer is the view's, never a guess.
 */
export function hidesArgument(tool: unknown, argument: string, value: InputValue): boolean {
  const probe = { [argument]: value };
  const shown = shownArgsOf(tool, probe);
  return shown !== probe && shown[argument] !== value;
}

/**
 * The sentence a ruled `assume` property carries in the served schema: what the
 * library does when the call leaves the argument out, and what the record
 * keeps. It promises nothing a later path can break — not that the call runs
 * (permission may deny it), only what fills a value that is left out.
 */
export function assumeSentence(value: InputValue, hidden: boolean): string {
  return hidden
    ? "If left out, the tool's rule fills a declared value (hidden by the tool's view), recorded as assumed."
    : `If left out, the tool's rule fills ${printedValue(value)}, recorded as assumed.`;
}

// LENS · tool-description · persistent-history
// reads: the tool's own `ask` rule — nothing about the call, the model or the person
// law: says what the model may do and what the record keeps; promises no outcome (the call may still
// be denied by permission, refused, or asked about again).
/**
 * The sentence a ruled `ask` property carries in the served schema: the rule
 * asks the person for the value, so the model may leave it out — and should,
 * unless the person gave it. No value is printed: an `ask` rule has no default.
 */
export const ASK_SENTENCE =
  "The tool's rule asks the person for this value; leave it out unless the person gave it.";

function withSentence(property: PlainObject, sentence: string): PlainObject {
  const description = property.description;
  const text =
    typeof description === 'string' && description.trim() !== ''
      ? `${description.trimEnd()} ${sentence}`
      : sentence;
  return { ...property, description: text };
}

// FOLD · the one owner of how a ruled tool's schema is SERVED
// consumers read this and never re-derive it: core/slots/buildToolsSlot.ts · commitWire (the one
// decoration site) and core/agent/stages/seed.ts (its static twin); servedView rebuilds from the
// committed list, so the decoration is a pure function of (schema, tool).
/**
 * The served copy of a ruled tool's schema: every argument an `assume` or an
 * `ask` rule governs leaves `required` (the library fills it, or asks the
 * person for it, when the call leaves it out) and its property's description
 * gains the rule's sentence. A rebuilt copy — the registry schema, which
 * `validateToolArgs` judges and `mcpServe` serves, is never edited. The SAME
 * reference back for a tool with no rules, rules that cannot be read (the
 * dispatch re-read refuses its calls) or no tool at all (a chart with no
 * claimant record) — so an agent whose tools declare nothing serves the bytes
 * it always did.
 *
 * @example
 * ```ts
 * withArgumentRules(searchLogs.schema, searchLogs).inputSchema.required; // ['service']
 * ```
 */
export function withArgumentRules(
  schema: LLMToolSchema,
  tool: RuledToolLike | undefined,
): LLMToolSchema {
  const rules = rulesOf(tool);
  if (rules === undefined || isRefused(rules)) return schema;
  const served = rules.ruled.filter(
    (r) =>
      (r.rule === 'assume' && r.assume !== undefined) || (r.rule === 'ask' && r.ask !== undefined),
  );
  if (served.length === 0) return schema;
  const input = schema.inputSchema;
  const properties = isPlainObject(input.properties) ? { ...input.properties } : {};
  for (const r of served) {
    const property = properties[r.argument];
    if (!isPlainObject(property)) continue;
    if (r.rule === 'ask') {
      properties[r.argument] = withSentence(property, ASK_SENTENCE);
      continue;
    }
    const value = r.assume as InputValue;
    properties[r.argument] = withSentence(
      property,
      assumeSentence(value, hidesArgument(tool, r.argument, value)),
    );
  }
  const ruledNames = new Set(served.map((r) => r.argument));
  const required = Array.isArray(input.required)
    ? (input.required as readonly unknown[]).filter(
        (name) => !(typeof name === 'string' && ruledNames.has(name)),
      )
    : undefined;
  const { required: _required, ...rest } = input;
  void _required;
  return {
    ...schema,
    inputSchema: {
      ...rest,
      properties,
      ...(required !== undefined && required.length > 0 && { required }),
    },
  };
}

// ─── The note on a result ───────────────────────────────────────────────

/** One filled argument, as the note names it. */
export interface FilledArgument {
  readonly argument: string;
  readonly value: InputValue;
  readonly hidden: boolean;
  /** `answered`: the person's answer to the batch ask filled it. Absent: the tool's rule assumed it. */
  readonly source?: 'answered';
}

// LENS · tool-result · persistent-history
// reads: the call's own fill (`argumentResolutions`, the layer's entry for this toolCallId), kept only
//        where the call RAN with it (`stages/toolCalls.ts` · `fillsThatRan` — a middleware may rewrite one)
// law: may omit, never deny; every clause anchored to the call it was composed on — past tense,
// naming the call this result answers, so a later call of the turn re-reading it reads a true sentence.
/**
 * The past-tense note ToolCalls appends to the result of a call that RAN on a
 * value the library filled — one bracket per filled argument the call really
 * ran with (a clause whose fill a before-tool middleware rewrote is left
 * out), after the tool's own bytes. The message then carries `toolChars`, and
 * every reader of a result's content as the TOOL's words reads through that
 * cut (`lib/toolBytes.ts` · `toolBytesOf`): the evidence index, the answer's
 * standing and the answer account's in-view results, the unsupported-argument
 * seam's grounded corpus and the empty-lookup seam's producer corpus. The
 * value is kept in the note because the model needs it to reason about what
 * ran ("no errors in 2h"); it is never evidence for that value, and it never
 * hides a reading of the tool's own bytes.
 *
 * @example
 * ```ts
 * filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: false }]);
 * // '\n\n[window was not in the search_logs call this result answers; the call ran with "2h",
 * //  the value the tool's rule assumes — recorded as assumed, not as the person's.]'
 * ```
 */
export function filledNote(toolName: string, fills: readonly FilledArgument[]): string {
  return fills
    .map((f) =>
      f.source === 'answered' ? answeredClause(toolName, f) : assumedClause(toolName, f),
    )
    .join('');
}

function assumedClause(toolName: string, f: FilledArgument): string {
  return f.hidden
    ? `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran ` +
        "with the value the tool's rule assumes (the value is hidden by the tool's view) — " +
        "recorded as assumed, not as the person's.]"
    : `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran ` +
        `with ${printedValue(f.value)}, the value the tool's rule assumes — recorded as ` +
        "assumed, not as the person's.]";
}

// LENS · tool-result · persistent-history
// reads: the call's answered fill (the batch ask's answer bound to this toolCallId), kept only where the
//        call RAN with it (`stages/toolCalls.ts` · `fillsThatRan`)
// law: may omit, never deny; past tense, naming the call this result answers.
function answeredClause(toolName: string, f: FilledArgument): string {
  return f.hidden
    ? `\n\n[${f.argument} in the ${toolName} call this result answers was chosen by the person ` +
        "when asked (the value is hidden by the tool's view; the call had left it out).]"
    : `\n\n[${f.argument} = ${printedValue(f.value)} in the ${toolName} call this result answers ` +
        'was chosen by the person when asked (the call had left it out).]';
}

// ─── The refusals ───────────────────────────────────────────────────────

// LENS · tool-result · persistent-history
// reads: the dispatch re-read of the tool's rules (`declare.ts` · `rulesOf`) — the assert's own sentence
// law: may omit, never deny; every clause anchored to the call it was composed on.
/** The result a call reads when its tool's rules could not be read at dispatch. */
export function unreadableRulesRefusal(toolName: string, reason: string): string {
  const why = reason.replace(/^defineTool\('[^']*'\):\s*/, '');
  return `${toolName} was not run on that call: its argument rules could not be read (${why}).`;
}

// LENS · tool-result · persistent-history
// reads: nothing but the tool's declaration — the agent was built without the inputs layer
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * The result a call reads when its tool declares argument rules and the agent
 * was built without the inputs layer (a ToolProvider served the tool, and the
 * build could not see it) — refused rather than run unruled, because
 * configured-and-inert looks exactly like configured-and-working.
 */
export function unmountedRulesRefusal(toolName: string): string {
  return `${toolName} was not run on that call: it declares argument rules this agent was not built to apply.`;
}

// LENS · tool-result · persistent-history
// reads: the batch ask's settled state — the arguments whose answers never fit, and the rule they failed
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * The result a call reads when the person was asked for a ruled argument
 * `MAX_ASK_ROUNDS` times and no answer fitted what the tool accepts — the call
 * does not run. `expected` is the property schema's own expectation (never the
 * person's answer).
 */
export function unansweredRefusal(
  toolName: string,
  unanswered: readonly { readonly argument: string; readonly expected?: string }[],
): string {
  const names = unanswered.map((u) => u.argument).join(', ');
  const rules = unanswered.flatMap((u) =>
    u.expected !== undefined ? [`${u.argument}: ${u.expected}`] : [],
  );
  return (
    `${toolName} was not run on that call: the person's answers for ${names} did not fit what ` +
    `the tool accepts${rules.length > 0 ? ` (${rules.join('; ')})` : ''}.`
  );
}

// LENS · tool-result · persistent-history
// reads: nothing but the fact that this batch already paused once, for the library's own ask
// law: may omit, never deny; past tense, anchored to the call; names no destination.
/**
 * The result a call reads when it needed a person — its check-in consent gate
 * tripped, or the tool itself asked to pause — in a batch that had ALREADY
 * paused once, to ask the person for argument values: a resumed batch has no
 * second pause to give (at most one human question per resume). The call did
 * not finish; nothing about it is decided for the person.
 */
export function secondPauseRefusal(toolName: string, why: 'check-in' | 'tool-pause'): string {
  const need =
    why === 'check-in'
      ? 'its check-in consent gate needed a person’s approval for those arguments'
      : 'the tool asked to pause for a person';
  return (
    `${toolName} was not run to completion on that call: ${need}, and this batch had already ` +
    'paused once — to ask the person for argument values — so there was no second pause to ' +
    'ask with.'
  );
}

// LENS · tool-result · persistent-history
// reads: the tool's name and the NAMES of the arguments whose answers the refused call carried
//        (`kept.ts` keeps their values)
// law: past tense, anchored to the call it was composed on, so a later call of the turn re-reading it
// (after the kept answer was used) still reads a true sentence; says what the model may do and promises
// no outcome (a call proposed again may still be denied, refused, paused or asked); prints no value.
/**
 * The clause a refusal by the one-question law gains when the refused call
 * carried the person's answers: they were KEPT for the tool's next call that
 * leaves those arguments out (`kept.ts`), so the model may propose the call
 * again without them. Empty when the call carried none.
 *
 * @example
 * ```ts
 * keptAnswersNote('purge_logs', ['window']);
 * // " The person's answer for window was kept for the next purge_logs call that leaves it out,
 * //   so the call may be proposed again without window."
 * ```
 */
export function keptAnswersNote(toolName: string, argumentNames: readonly string[]): string {
  if (argumentNames.length === 0) return '';
  if (argumentNames.length === 1) {
    const [name] = argumentNames;
    return (
      ` The person's answer for ${name} was kept for the next ${toolName} call that leaves ` +
      `it out, so the call may be proposed again without ${name}.`
    );
  }
  const names = `${argumentNames.slice(0, -1).join(', ')} and ${argumentNames.at(-1)}`;
  return (
    ` The person's answers for ${names} were kept for the next ${toolName} call that leaves ` +
    'them out, so the call may be proposed again without them.'
  );
}

// ─── The "Assumed" block (under `.limitsTravelWithTheAnswer()`) ───────────

/** The block's opening line. Stable — tests and readers match on it. */
export const ASSUMED_BLOCK_HEADING = "Assumed (a tool's rule, not your words):";

/** One assumed value, as the answer's block names it. */
export interface AssumedLine {
  readonly toolName: string;
  readonly argument: string;
  /** The row's value — the tool's own view; `'REDACTED'` when it hides it. */
  readonly value: string;
  readonly hidden: boolean;
}

/**
 * The "Assumed" block: one line per distinct (tool, argument, value) of this
 * turn's `default` rows, in the order the rows were filed. Composed by the
 * framework from the rows — the model does not write it, so it cannot drop
 * it. Empty string when there is nothing assumed.
 */
export function assumedBlock(lines: readonly AssumedLine[]): string {
  const seen = new Set<string>();
  const printed: string[] = [];
  for (const line of lines) {
    const key = JSON.stringify([line.toolName, line.argument, line.hidden ? '' : line.value]);
    if (seen.has(key)) continue;
    seen.add(key);
    printed.push(
      line.hidden
        ? `- ${line.argument} (its value is hidden by the tool's view) (${line.toolName})`
        : `- ${line.argument} = ${JSON.stringify(line.value)} (${line.toolName})`,
    );
  }
  return printed.length === 0 ? '' : `${ASSUMED_BLOCK_HEADING}\n${printed.join('\n')}`;
}
