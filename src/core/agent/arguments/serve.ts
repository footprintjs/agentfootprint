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
 *          promises no outcome a later path can break. Loaded through
 *          `import()` by every static site that serves one of them — the
 *          tools slot and seed (the schema), ToolCalls through
 *          `dispatch.ts` (the note, the refusal), the final branch's armed
 *          variant (the block) — and only under the arm: the optional-family
 *          law of docs-next's site budget, so a plain agent's graph never
 *          carries this module.
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
import { ASSUMED_BLOCK_HEADING, type TimeLimitLines } from '../coverage/answer.js';
import { argumentRewritesOf, type ArgumentRewrite } from '../middleware/rewrites.js';
import { isRefused, periodFactsOf, periodFormsOf, rulesOf, type RuledToolLike } from './declare.js';
import { HIDDEN_VALUE, type ArgumentRow } from './rows.js';
import {
  convertExact,
  convertWidened,
  formArguments,
  granularityMsOf,
  widestMsOf,
  type PeriodFacts,
  type TimeRefusal,
} from '../../time/convert.js';
import type { ReaderWindows } from '../../time/bind.js';
import type { ZoneName } from '../../time/zone.js';
import { presentRange } from '../../time/present.js';

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

// LENS · tool-description · persistent-history
// reads: the tool's own `ask` rule and the declared-sources arm — nothing about the call, the model or
//        the person
// law: says what the model may do and where it declares it; promises no outcome (the call may still be
// denied by permission, refused, or asked about again).
/**
 * The sentence a ruled `ask` property carries under DECLARED SOURCES
 * (`.findings({ argumentSources: true })`, `.inputsLayer({ argumentSources:
 * true })`) in place of `ASK_SENTENCE`: the same rule, and — at the place the
 * model decides whether to send the value — where it says the person gave it.
 * Under the arm a present value with no traced source is asked of the person
 * (`resolve.ts`), so "leave it out unless the person gave it" alone told the
 * model that SENDING the value was the whole of its statement: in the paid
 * step-5 run (`bench/inputs/runs/haiku45-step5`) it left the period out on 32
 * of 32 calls where the person gave none — and a period the person HAD given
 * was traced to their words, unasked, on 7 of 88 calls.
 */
export const ASK_SOURCES_SENTENCE =
  "The tool's rule asks the person for this value; leave it out unless the person gave it, and " +
  'then quote their words for it in `_findings.from`.';

/** The options every served-schema composer here takes. */
export interface ServeOptions {
  /**
   * Declared sources are armed (`.findings({ argumentSources: true })` or
   * `.inputsLayer({ argumentSources: true })`) AND this tool's served schema
   * carries `_findings.from`: an `ask` property says where the model declares
   * the person's words, and an answered note says a later call may cite the
   * answer. The CALLER decides it per tool, by the rule the planters and the
   * dispatch peel ask (`findings/reserved.ts` · `ownsReservedArgument`, which
   * this leaf cannot import): a tool whose author owns `_findings` is served
   * undecorated, so a sentence naming `_findings.from` would tell the model to
   * write into the author's own argument. Absent → the sentences steps 3 and 4
   * serve, byte for byte.
   */
  readonly sources?: boolean;
}

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
// decoration site, through `rulesOnWire`) and core/agent/stages/seed.ts (its static twin), each
// loading this module through `import()` under the arm; servedView rebuilds from the committed
// list, so the decoration is a pure function of (schema, tool).
/**
 * The served copy of a ruled tool's schema: every argument an `assume` or an
 * `ask` rule governs leaves `required` (the library fills it, or asks the
 * person for it, when the call leaves it out) and its property's description
 * gains the rule's sentence (an `ask` rule's names `_findings.from` under the
 * sources arm, `options.sources`). A rebuilt copy — the registry schema, which
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
  options?: ServeOptions,
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
      const sentence = options?.sources === true ? ASK_SOURCES_SENTENCE : ASK_SENTENCE;
      properties[r.argument] = withSentence(property, sentence);
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

/**
 * The served list with each ruled tool's schema decorated (`withArgumentRules`,
 * from the rules of the implementation that WINS each name), or the SAME list
 * when no served schema changed — so an armed agent whose wire carries no
 * ruled tool commits the bytes it always did. The tools slot's one decoration
 * site (`core/slots/buildToolsSlot.ts` · `commitWire`) calls it under the arm.
 * `optionsOf` gives each schema its own `ServeOptions`: under declared sources
 * one wire can hold a tool that carries `_findings.from` beside a provider's
 * tool whose author owns `_findings`, which does not.
 */
export function rulesOnWire(
  served: readonly LLMToolSchema[],
  winningTools: ReadonlyMap<string, RuledToolLike>,
  optionsOf?: (schema: LLMToolSchema) => ServeOptions | undefined,
): readonly LLMToolSchema[] {
  let changed = false;
  const decorated = served.map((schema) => {
    const next = withArgumentRules(schema, winningTools.get(schema.name), optionsOf?.(schema));
    if (next !== schema) changed = true;
    return next;
  });
  return changed ? decorated : served;
}

// ─── The person's windows, served LATE at the decision point (time design TQ13) ───

/**
 * What the served line reads: the turn's SETTLED windows of the person's
 * words (`core/time/bind.ts` · `readerWindowsOf` — each mention's quote and
 * its one window: the one the person confirmed or gave in the time ask, or a
 * `model` reader's reading), the quotes still PENDING (a proposal the person
 * has not answered), the turn's clock, and the app's `.time({ zone })`. An
 * unreadable mention is in neither list.
 */
export interface ServedWindows extends ReaderWindows {
  readonly appZone?: ZoneName;
}

/** A converted value as the line prints it — an object form's as JSON. */
function printedArgument(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : printedValue(value as InputValue);
}

/** A served tool that declares a period — the only tools the line speaks about. */
interface PeriodTool {
  readonly name: string;
  readonly tool: RuledToolLike;
  readonly forms: ReturnType<typeof periodFormsOf>;
  readonly facts: ReturnType<typeof periodFactsOf>;
}

/** The served tools (in served order) whose winning implementation declares period forms. */
function periodToolsOf(
  served: readonly LLMToolSchema[],
  winningTools: ReadonlyMap<string, RuledToolLike>,
): readonly PeriodTool[] {
  const out: PeriodTool[] = [];
  for (const schema of served) {
    const tool = winningTools.get(schema.name);
    const rules = rulesOf(tool);
    if (tool === undefined || rules === undefined || isRefused(rules)) continue;
    const forms = periodFormsOf(rules.period);
    if (forms.length === 0) continue;
    out.push({ name: schema.name, tool, forms, facts: periodFactsOf(rules.period) });
  }
  return out;
}

/** Whose one window of the person's words is — the line's source clause. */
function whoseWindow(w: ServedWindows['windows'][number]): string {
  if (w.source === 'answered') {
    return w.answer === 'edited'
      ? 'the window the person gave when asked what their words meant'
      : 'the window the person confirmed when asked what their words meant';
  }
  return "a reading of the person's words they have not confirmed, not their words";
}

/**
 * A window for a person, in its zone, to the minute with its end AS SAID — the last minute inside
 * the half-open range (`time/present.ts` · `presentRange`); the ISO interval if it cannot be.
 */
function presentedWindow(w: ServedWindows['windows'][number]): string {
  try {
    return presentRange(w.range, { zone: w.zone }, 'minute');
  } catch {
    return `${w.range.from}/${w.range.to}`;
  }
}

/** One tool's values for one settled window — exact, else the wider read the fill would use, said so. */
function toolValues(
  pt: PeriodTool,
  w: ServedWindows['windows'][number],
  windows: ServedWindows,
): string | undefined {
  const ctx = {
    now: windows.now,
    zone: w.zone,
    ...(windows.appZone !== undefined && { appZone: windows.appZone }),
    granularityMs: granularityMsOf(pt.facts),
  };
  const window = { range: w.range, ...(w.lookback !== undefined && { lookback: w.lookback }) };
  const exact = convertExact(window, pt.forms, ctx);
  const conversion = exact ?? convertWidened(window, pt.forms, ctx, widestMsOf(pt.facts));
  if (conversion === undefined) return undefined;
  const values = Object.entries(conversion.values).map(([argument, value]) =>
    hidesArgument(pt.tool, argument, value as InputValue)
      ? `${argument} (hidden by the tool's view)`
      : `${argument} ${printedArgument(value)}`,
  );
  const wider = exact === undefined ? ' (a wider read than the words named)' : '';
  return `${pt.name} ${values.join(', ')}${wider}`;
}

/** The settled half: each window, whose it is, and each tool's values for it. */
function settledSentence(tools: readonly PeriodTool[], windows: ServedWindows): string | undefined {
  const clauses: string[] = [];
  for (const w of windows.windows) {
    if (w.quote === undefined) continue;
    const values = tools.flatMap((pt) => toolValues(pt, w, windows) ?? []);
    if (values.length === 0) continue;
    clauses.push(`“${w.quote}” is ${presentedWindow(w)}, ${whoseWindow(w)} — ${values.join('; ')}`);
  }
  if (clauses.length === 0) return undefined;
  const these = clauses.length === 1 ? 'that window' : 'those windows';
  return (
    `The person's time words, as the library holds them: ${clauses.join('. ')}. ` +
    `A call may pass these values as written; an answer built on them states ${these}.`
  );
}

/**
 * The pending half: the quotes no one has confirmed. Before any call ran on a window of the
 * model's own, the one move that asks the person — the call with the period left out — named as
 * the next step, with the two moves that do not (a question in the reply, a written window).
 * After one did, the limit the answer states instead.
 */
function pendingSentence(tools: readonly PeriodTool[], windows: ServedWindows): string | undefined {
  const pending = windows.pending;
  if (pending === undefined || pending.length === 0) return undefined;
  const quotes = pending.map((q) => `“${q}”`).join(', ');
  if (windows.ranUnconfirmed === true) {
    return (
      `The window for ${quotes} is not settled: the person has not confirmed it, and the call ` +
      'that ran used a window written into it, unconfirmed. An answer built on that call says ' +
      'its window was not confirmed by the person.'
    );
  }
  const calls = tools.flatMap((pt) => {
    const args = [...new Set(pt.forms.flatMap((f) => formArguments(f).map((a) => a.argument)))];
    return args.length === 0 ? [] : [`${pt.name} is called with ${args.join(', ')} left out`];
  });
  if (calls.length === 0) return undefined;
  return (
    `The window for ${quotes} is not settled yet: the person confirms it in the library's own ` +
    `form, which shows its reading of those words with the zone and opens when ` +
    `${calls.join(', or ')} (or the call is refused with the reason). So the next step is that ` +
    'call — not a question about the time in the reply, and not a window written into the call, ' +
    'which would run unconfirmed.'
  );
}

// LENS · late-line · request-ephemeral
// reads: the turn's settled windows of the person's words (each mention's quote, its one window and
//        WHOSE it is — the person's answer in the time ask, or a model reader's reading), the
//        quotes still pending (a rule reading the person has not answered — `bind.ts` ·
//        `pendingQuotesOf`), the turn's clock, and the SERVED tools' declared period forms and
//        facts — converted by the one owner (`core/time/convert.ts`)
// law: the library's CONCLUSION, never raw facts: a settled window is named with its source (a
//      reading is never called the person's words) and the values each tool takes, as a
//      permission ("may pass"); a pending quote names no window and no reading (a proposal is not
//      a fact the model may pass) — only that it is not confirmed and the one move that asks the
//      person. Whether a call is filled, bound or refused is decided at dispatch and recorded there.
/**
 * The ONE served time line (TQ13; step T6b's serving placement): one
 * request-only `user` line appended LAST to the request, at the decision
 * point — composed at the tools slot's one decoration site
 * (`core/slots/buildToolsSlot.ts` · `commitWire`) from the tools it really
 * serves, carried to `callLLM` on `timeLine`, and rebuilt by
 * `lib/time-travel/servedView.ts` from the same committed key. Two halves:
 *
 * - SETTLED — each window the person confirmed or gave in the time ask (or a
 *   `model` reader's reading), in the person's zone, WHOSE it is, and each
 *   served period tool's values for it — the exact conversion, else the wider
 *   one the fill would use (said so); a value the tool's view hides is named
 *   hidden. So the model never re-derives a window from words, and the answer
 *   states the window it was built on.
 * - PENDING — a proposal the person has not answered is no window yet, and a
 *   call that writes its own window runs as sent, unconfirmed (§ 7.3). The
 *   line names the next step — the call with the period arguments left out,
 *   so the library's own form confirms the window with the person — and the
 *   two moves that are not it (a question about the time in the reply, a
 *   written window). Once a call of the turn already ran on a written window
 *   (`ranUnconfirmed`), it names the limit an answer states instead.
 *
 * `undefined` when no served tool declares a period or neither half has
 * anything to say — a turn with no time words serves no line at all.
 *
 * @example
 * ```ts
 * timeWindowsLine(served, winningTools, { now, windows: [], pending: ['yesterday'] });
 * // 'The window for “yesterday” is not settled yet: the person confirms it in the library's own
 * //  form, which shows its reading of those words with the zone and opens when client_activity
 * //  is called with start_time, end_time left out (or the call is refused with the reason). So
 * //  the next step is that call — not a question about the time in the reply, and not a window
 * //  written into the call, which would run unconfirmed.'
 * ```
 */
export function timeWindowsLine(
  served: readonly LLMToolSchema[],
  winningTools: ReadonlyMap<string, RuledToolLike>,
  windows: ServedWindows,
): string | undefined {
  const tools = periodToolsOf(served, winningTools);
  if (tools.length === 0) return undefined;
  const settled = settledSentence(tools, windows);
  const pending = pendingSentence(tools, windows);
  if (settled === undefined) return pending;
  return pending === undefined ? settled : `${settled} ${pending}`;
}

// LENS · late-line · request-ephemeral
// reads: the turn's `period` rows whose result checks hold and its `source-clock` rows, composed by
//        the ONE owner of the limits lines (`coverage/timeLimits.ts` · `timeLimitLinesOf`,
//        audience `model`) — the same lines the limits block prints for the person after the answer
// law: the library's CONCLUSION about what each call READ against what it ASKED (step T8), both
//      ranges in the person's zone, and what an answer built on it states; it names what the record
//      holds for calls that already ran and promises nothing a later call can break.
/**
 * The time limits an answer states (time step T8's serving placement): the
 * result checks that hold this turn — a read narrower, wider or shifted from
 * what was asked, a window older than the source keeps, sources on different
 * clocks — served to the MODEL as the library's conclusion, LATE, at the
 * decision point, in the ONE served time line (TQ13) after the windows'
 * halves. The step-7b bench showed why: raw facts on a result are not
 * compared by the model, a conclusion served at the decision point is.
 *
 * `undefined` when nothing holds — a turn whose reads match what was asked
 * serves no sentence at all.
 *
 * @example
 * ```ts
 * timeLimitsSentence({ period: ['client_activity read less than was asked — asked: …; read: …'], clocks: [] });
 * // 'The time the tools read is not the time asked about, and an answer says so: client_activity
 * //  read less than was asked — asked: …; read: …. An answer states the time each result read
 * //  and claims nothing about time no result read.'
 * ```
 */
export function timeLimitsSentence(lines: TimeLimitLines | undefined): string | undefined {
  if (lines === undefined) return undefined;
  const parts: string[] = [];
  if (lines.period.length > 0) {
    parts.push(
      `The time the tools read is not the time asked about, and an answer says so: ` +
        `${lines.period.join('; ')}. An answer states the time each result read and claims ` +
        `nothing about time no result read.`,
    );
  }
  if (lines.clocks.length > 0) {
    parts.push(`Clocks: ${lines.clocks.join('; ')}.`);
  }
  return parts.length === 0 ? undefined : parts.join(' ');
}

// ─── The note on a result ───────────────────────────────────────────────

/** One filled argument, as the note names it. */
export interface FilledArgument {
  readonly argument: string;
  /** A window fill of an `object` form is an object (printed as JSON). */
  readonly value: InputValue | Readonly<Record<string, InputValue>>;
  readonly hidden: boolean;
  /**
   * `answered`: the person's answer to the batch ask filled it. `window`: the
   * turn's one window of the person's did (the time layer), `from` saying
   * whose. Absent: the tool's rule assumed it.
   */
  readonly source?: 'answered' | 'window';
  /**
   * On a `window` fill: the person's words, a `model` reader's unconfirmed
   * reading of them, a UI control — or the window the person CHOSE when the
   * library asked about their words (`answered`, the lazy word-driven ask).
   */
  readonly from?: 'said' | 'derived-from-reading' | 'control' | 'answered';
  /**
   * On a `window` fill: no form held the window exactly, so the value reads a
   * WIDER one (the time layer, step T5b) — `reads-more`, or `tool-trims` when
   * the tool declares that it drops the rows outside the asked window.
   */
  readonly wider?: 'reads-more' | 'tool-trims';
  /**
   * The value the call had CARRIED, which the person's answer replaced
   * (declared sources: an untraced value is asked about). Absent: the call
   * had left the argument out.
   */
  readonly carried?: InputValue;
}

// LENS · tool-result · persistent-history
// reads: the call's own fill (`argumentResolutions`, the layer's entry for this toolCallId), kept only
//        where the call RAN with it (`dispatch.ts` · `fillsThatRan` — a middleware may rewrite one)
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
export function filledNote(
  toolName: string,
  fills: readonly FilledArgument[],
  options?: ServeOptions,
): string {
  return fills
    .map((f) =>
      f.source === 'answered'
        ? answeredClause(toolName, f, options?.sources === true)
        : f.source === 'window'
        ? windowClause(toolName, f)
        : assumedClause(toolName, f),
    )
    .join('');
}

/** A filled value as a note prints it — an object form's value as JSON. */
function printedFill(value: FilledArgument['value']): string {
  return typeof value === 'object' ? JSON.stringify(value) : printedValue(value);
}

// LENS · tool-result · persistent-history
// reads: the call's window fill (`argumentResolutions`: the turn's ONE window of the person's, converted
//        into the tool's form — `core/time/bind.ts`), kept only where the call RAN with it, and whose window
//        it was (the person's words, a model reader's unconfirmed reading of them, a UI control)
// law: may omit, never deny; past tense, naming the call this result answers; a reading of the person's
//      words is never called their words.
/** The clause for a value the turn's one window of the person's filled (the time layer, step T5a). */
function windowClause(toolName: string, f: FilledArgument): string {
  const whose =
    f.from === 'control'
      ? 'from the window the person set in the app — recorded as set in the app'
      : f.from === 'answered'
      ? 'from the window the person chose when asked what their words meant — recorded as ' +
        "the person's answer"
      : f.from === 'derived-from-reading'
      ? "from a reading of the person's words they have not confirmed — recorded as a reading, " +
        "not as the person's"
      : "from the window the person's own words gave — recorded as the person's";
  const wider =
    f.wider === 'reads-more'
      ? "; the tool's form could not hold that window exactly, so the value reads a wider one — " +
        'recorded as wider than asked'
      : f.wider === 'tool-trims'
      ? "; the tool's form could not hold that window exactly, so the value reads a wider one, " +
        'and the tool declares that it drops the rows outside the asked window'
      : '';
  return f.hidden
    ? `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran with ` +
        `a value ${whose} (the value is hidden by the tool's view)${wider}.]`
    : `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran with ` +
        `${printedFill(f.value)}, ${whose}${wider}.]`;
}

function assumedClause(toolName: string, f: FilledArgument): string {
  return f.hidden
    ? `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran ` +
        "with the value the tool's rule assumes (the value is hidden by the tool's view) — " +
        "recorded as assumed, not as the person's.]"
    : `\n\n[${f.argument} was not in the ${toolName} call this result answers; the call ran ` +
        `with ${printedFill(f.value)}, the value the tool's rule assumes — recorded as ` +
        "assumed, not as the person's.]";
}

/**
 * The clause an answered note gains under declared sources: a later call may
 * name the person's answer as its source — `turn`, checked against the
 * ledger's `answered` rows (`checks.ts` · `checkTurn`). A permission, never a
 * promise: the claim is still checked. In the paid step-5 run the model sent
 * an answered period again on the next turn with no `from` entry (and so was
 * asked again) or left it out (and so was asked again): nothing it was served
 * said an earlier ANSWER was a source it could name.
 */
export const ANSWERED_SOURCE_CLAUSE =
  "; a later call may cite that answer in `_findings.from` with source 'turn'";

// LENS · tool-result · persistent-history
// reads: the call's answered fill (the batch ask's answer bound to this toolCallId), kept only where the
//        call RAN with it (`dispatch.ts` · `fillsThatRan`), the value the call had carried, if any, and
//        whether declared sources are armed (the `turn` clause)
// law: may omit, never deny; past tense, naming the call this result answers; the `turn` clause is a
// permission ("may cite"), never an outcome — the claim is checked like any other.
function answeredClause(toolName: string, f: FilledArgument, sources: boolean): string {
  const before =
    f.carried === undefined
      ? 'the call had left it out'
      : f.hidden
      ? 'the call had carried a value of its own'
      : `the call had carried ${printedValue(f.carried)}`;
  // A hidden answer is on the record as 'REDACTED' — a `turn` claim for it cannot be checked
  // (`checks.ts` · `checkTurn`: `uncheckable`), so its clause offers none.
  return f.hidden
    ? `\n\n[${f.argument} in the ${toolName} call this result answers was chosen by the person ` +
        `when asked (the value is hidden by the tool's view; ${before}).]`
    : `\n\n[${f.argument} = ${printedFill(f.value)} in the ${toolName} call this result answers ` +
        `was chosen by the person when asked (${before})${sources ? ANSWERED_SOURCE_CLAUSE : ''}.]`;
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
// reads: the call's `call-window` decision (`core/time/bind.ts` · `callWindowOf`: the window it asked
//        for against the tool's DECLARED facts — `direction`, `retention`, `maxRange`, a `day`-only form,
//        a sent wall time the zone skips) and those facts' own spellings
// law: may omit, never deny; past tense, anchored to the call; prints no window value (it may be the
//      person's) — only the tool's declared facts and an argument name; says what the model may do and
//      promises no outcome.
/**
 * The result a call reads when it was refused BEFORE DISPATCH on its window
 * (the time layer, step T5b — time design § 7.2): the window breaks one of the
 * tool's declared facts, spans days for a tool that reads one day per call, or
 * a sent wall time is one the zone's clocks skip. Splitting a window into
 * several calls is the model's choice, never the library's.
 *
 * @example
 * ```ts
 * timeRefusal('search_logs', 'time-future', { direction: 'past' });
 * // 'search_logs was not run on that call: the window it asked for had not happened yet, and the
 * //  tool declares that its source holds only the past.'
 * ```
 */
export function timeRefusal(
  toolName: string,
  refusal: TimeRefusal,
  facts: PeriodFacts,
  argument?: string,
): string {
  const head = `${toolName} was not run on that call: `;
  switch (refusal) {
    case 'time-future':
      return (
        head +
        'the window it asked for had not happened yet, and the tool declares that its source ' +
        'holds only the past.'
      );
    case 'time-past':
      return (
        head +
        'the window it asked for had already ended, and the tool declares that its source ' +
        'holds only the future.'
      );
    case 'beyond-retention':
      return (
        head +
        'the window it asked for was wholly older than the oldest data the tool declares its ' +
        `source keeps (${facts.retention ?? 'its retention'}).`
      );
    case 'over-max-range':
      return (
        head +
        'the window it asked for was wider than the tool declares it reads at once ' +
        `(maxRange ${facts.maxRange ?? 'undeclared'}); narrower windows, one call each, may be ` +
        'proposed instead.'
      );
    case 'multi-day':
      return (
        head +
        'the window it asked for spanned more than one calendar day, and the tool reads one day ' +
        'per call; one call per day may be proposed instead.'
      );
    case 'dst-gap':
      return (
        head +
        `the wall time sent for ${argument ?? 'its period'} does not exist in the tool's zone — ` +
        'the clocks skip it at a daylight-saving change.'
      );
  }
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

/**
 * The block's opening line. Stable — tests and readers match on it. Owned by
 * the appended section's one composer (`coverage/answer.ts`), beside the
 * limits block's heading, so a reader of an answer's text finds every block
 * the framework appends through one module; re-exported here, where the block
 * is composed.
 */
export { ASSUMED_BLOCK_HEADING };

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

/**
 * The "Assumed" block for THIS turn, read off the record: every `default`
 * argument row of `turn`, in the order it was filed, less each row a
 * before-tool rewrite superseded (its call ran with the rewrite's value, not
 * the one the row names). `readDecisions` hands over `middlewareDecisions`; it
 * is asked only when a row exists (a run with nothing assumed never reads the
 * key), and is absent on an agent with no before-tool chain, whose record can
 * hold no tool rewrite. `''` when nothing is assumed. The final branch's armed
 * variant (`stages/prepareFinal.ts` · `prepareFinalWithLimitsAndAssumedStage`)
 * calls it through `import()`.
 *
 * @example
 * ```ts
 * assumedBlockOf(state.findingsLedger ?? [], state.turnNumber, undefined);
 * // "Assumed (a tool's rule, not your words):\n- window = \"2h\" (search_logs)"
 * ```
 */
export function assumedBlockOf(
  ledger: readonly { readonly kind: string }[],
  turn: number,
  readDecisions: (() => readonly unknown[]) | undefined,
): string {
  return assumedBlock(assumedLinesFor(ledger, turn, readDecisions));
}

// FOLD · the one reading of "what was assumed this turn"
// consumers read this and never re-derive it: the prose "Assumed" block (`assumedBlockOf`, above),
// a TYPED answer's limits as data (`stages/answerCoverage.ts` · `withAnswerCoverage` — the
// `assumed` list on `answerCoverage`) and the answer layer's standing line
// (`assessment/stage.ts` · `assessAnswerStage`). Same rows, same view, same order — so the block,
// the data and the line cannot disagree about which values were assumed.
/**
 * This turn's assumed values, as the "Assumed" block's lines: every `default`
 * argument row of `turn`, in the order it was filed, less each row a
 * before-tool rewrite superseded (its call ran with the rewrite's value, not
 * the one the row names). `readDecisions` hands over `middlewareDecisions`; it
 * is asked only when a row exists, and is absent on an agent with no
 * before-tool chain, whose record can hold no tool rewrite. `[]` when nothing
 * is assumed. The block prints each distinct (tool, argument, value) once.
 *
 * @example
 * ```ts
 * assumedLinesFor(state.findingsLedger ?? [], state.turnNumber, undefined);
 * // [{ toolName: 'search_logs', argument: 'window', value: '2h', hidden: false }]
 * ```
 */
export function assumedLinesFor(
  ledger: readonly { readonly kind: string }[],
  turn: number,
  readDecisions: (() => readonly unknown[]) | undefined,
): AssumedLine[] {
  const rows = defaultRowsOf(ledger, turn);
  const rewrites =
    readDecisions !== undefined && rows.length > 0
      ? argumentRewritesOf(readDecisions())
      : undefined;
  return assumedLinesOf(rows, rewrites);
}

const isArgumentRow = (row: { readonly kind: string }): row is ArgumentRow =>
  row.kind === 'argument';

/** This turn's `default` argument rows, in the order they were filed. */
function defaultRowsOf(ledger: readonly { readonly kind: string }[], turn: number): ArgumentRow[] {
  const rows: ArgumentRow[] = [];
  for (const row of ledger) {
    if (isArgumentRow(row) && row.turn === turn && row.source === 'default') rows.push(row);
  }
  return rows;
}

/**
 * The rows as the "Assumed" block names them — every row a before-tool
 * rewrite superseded left out: its call ran with the rewrite's value, not
 * the one the row names (`middleware/rewrites.ts` · `argumentRewritesOf`).
 */
function assumedLinesOf(
  rows: readonly ArgumentRow[],
  rewrites: ReadonlyMap<string, ReadonlyMap<string, ArgumentRewrite>> | undefined,
): AssumedLine[] {
  const lines: AssumedLine[] = [];
  for (const row of rows) {
    if (rewrites?.get(row.toolCallId)?.has(row.argument) === true) continue;
    const value = row.value ?? '';
    lines.push({
      toolName: row.toolName,
      argument: row.argument,
      value,
      hidden: value === HIDDEN_VALUE,
    });
  }
  return lines;
}
