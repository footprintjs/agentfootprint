/**
 * arguments/resolve — the inputs layer's checks and its one table, as pure
 * functions of what the layer is handed.
 *
 * Pattern: Walker. Four pure steps, one per stage of the `sf-inputs` subflow
 *          (`arguments/subflow.ts` wires them to scope): DECLARE (which calls
 *          carry rules, and which ruled values are missing), VERIFY (where each
 *          ruled value came from), RECORD (the rows, in the tool's own view),
 *          RESOLVE (the fills and refusals ToolCalls applies). The same inputs
 *          always give the same outputs; nothing here reads a clock, a model or
 *          scope.
 * Role:    core/ layer, the inputs layer (honesty layer 2). Loaded through
 *          `import()` when the layer is armed — never on a plain agent's graph.
 *          Imports nothing from `findings/` (the one-way law).
 * Emits:   N/A.
 *
 * ## The table (declared sources unarmed)
 *
 * | The value                               | `assume` rule                   | `ask` rule                        |
 * |-----------------------------------------|---------------------------------|-----------------------------------|
 * | missing                                 | `default` — fill the default    | `asked: 'missing'` — ask, once per batch |
 * | missing, an answer KEPT for it (`kept.ts`) | —                            | `answered` — fill the person's kept answer |
 * | present, equal to the declared default  | `default` — run (model's value) | — (an `ask` rule has no default)  |
 * | present, any other value                | `model` — run, flagged          | `model` — run, flagged (adopted Q2) |
 *
 * ## Under declared sources (`.inputsLayer({ argumentSources: true })`, `.findings({ argumentSources: true })`)
 *
 * A PRESENT value is checked against the source the model declared for it
 * (`checks.ts` · `checkSource`) — and so is every free argument a `from`
 * entry names, filed with no rule. A missing value is resolved exactly as
 * above: it has no source to check.
 *
 * | The present value                                                     | `assume` rule        | `ask` rule                        | no rule |
 * |-----------------------------------------------------------------------|----------------------|-----------------------------------|---------|
 * | traced — `said` (quote or phrase), `answered`, `result`, `app`       | run                  | run                               | run, a row |
 * | the declared default, not the person's (V1)                           | run → `default`      | —                                 | —       |
 * | untraced — nothing declared, `assumed`, a hint, a failed claim, a reading | run, flagged     | `asked: 'unverified'` — ask       | run, a row |
 *
 * A reading (`said` + `reading`: the person's words were found, the value is
 * not in them) ASKS under an `ask` rule — otherwise any exact fragment of the
 * person's message would carry any value past the rule — and the ask's field
 * shows the person their own words (`quoted`) unless a tool in reach may hide
 * arguments (`quotesMayShow`). The model's value never rides the ask.
 * "Equal" is the evidence module's same-value rule (`declare.ts` ·
 * `sameArgumentValue`). A present value equal to the default is filed as
 * `default`, never as the model's own choice: a model that copies a default
 * from a description chose nothing (the row's `proposed` tells it from a fill).
 * A present value on an `ask` argument is not asked in this version: the model
 * cannot yet say where a value came from (declared sources), so every present
 * value is unverified, and asking would fire on nearly every call — it runs,
 * flagged `model`. A missing one is asked: RESOLVE names it on the call's
 * entry (`ask`), and ToolCalls raises the ONE typed ask for the whole batch
 * before anything in it runs (`arguments/ask.ts`). A missing one the person
 * already answered for a call the batch that asked could not finish — its
 * answer KEPT (`kept.ts`: that batch had no second pause to give) — is filled
 * with the kept answer instead of asked again, and filed `answered`. A call
 * whose tool's rules cannot be read at dispatch is refused, never run unruled
 * and never repaired.
 */

import type { InputValue } from '../../inputRequest.js';
import {
  callWindowOf,
  type CallWindow,
  type TurnWindows,
  type WindowSource,
} from '../../time/bind.js';
import { formArguments, granularityMsOf } from '../../time/convert.js';
import type { InstantText } from '../../time/instant.js';
import { callWindowRow, type CallWindowRow } from '../../time/rows.js';
import type { ZoneName } from '../../time/zone.js';
import { shownArgsOf } from '../../toolShownArgs.js';
import { validatePropertyValue } from '../toolArgsValidation.js';
import { checkSource, isTraced, type SourceCheck, type SourceCorpus } from './checks.js';
import {
  isMissing,
  isRefused,
  periodArgumentsOf,
  periodFactsOf,
  periodFormsOf,
  rulesOf,
  sameArgumentValue,
  type RuledArgument,
  type RuledToolLike,
  type ToolRules,
} from './declare.js';
import { keptAnswerFor, type KeptAnswer } from './kept.js';
import {
  HIDDEN_VALUE,
  answeredRowOf,
  argumentRowOf,
  askedRowOf,
  sourcedRowOf,
  windowRowOf,
  type ArgumentRow,
} from './rows.js';
import { timeRefusal, unreadableRulesRefusal } from './serve.js';
import type { CallSources, DeclaredSource } from './sources.js';

/** One call of the batch, as the model emitted it (its raw arguments). */
export interface BatchCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** The implementation that will answer a name — the shared dispatch resolver's. */
export type ToolOf = (
  toolName: string,
) => (RuledToolLike & { readonly argumentsFrom?: readonly string[] }) | undefined;

/** One ruled argument of one call, as DECLARE found it. Identities and a flag — no value. */
export interface PlannedArgument {
  readonly argument: string;
  readonly rule: 'ask' | 'assume';
  readonly period?: true;
  readonly missing: boolean;
}

/** One call whose tool carries rules, as DECLARE found it. */
export interface PlannedCall {
  readonly toolCallId: string;
  readonly toolName: string;
  /** The dispatch re-read could not read the rules — the assert's own sentence. */
  readonly refused?: string;
  readonly ruled: readonly PlannedArgument[];
  /**
   * Under declared sources: the FREE arguments (no rule) a `from` entry named
   * — each is checked and filed with no rule, never filled and never asked
   * (adopted Q18). Absent when there are none.
   */
  readonly free?: readonly string[];
}

/** One ruled argument, as VERIFY placed it. No value — the rows take the value in the tool's view. */
export interface CheckedArgument {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argument: string;
  /** The argument's rule — absent only on a FREE argument a `from` entry named. */
  readonly rule?: 'ask' | 'assume';
  readonly period?: true;
  /** Where the value came from — absent exactly on an argument to ASK (`asked`). */
  readonly source?: 'default' | 'model' | 'answered' | 'said' | 'result' | 'app';
  /**
   * The library fills the value — the call left the argument out: the declared
   * default (`source: 'default'`), or the person's answer KEPT for this
   * (tool, argument) (`source: 'answered'`, `kept.ts`).
   */
  readonly filled?: true;
  /**
   * The person is asked, once per batch: the call left an `ask` argument out
   * (`missing`), or — under declared sources — its present value is not traced
   * to a source the record holds (`unverified`).
   */
  readonly asked?: 'missing' | 'unverified';
  /**
   * The declared-sources check's verdict on a PRESENT value — set exactly when
   * the arm is on for the call (`checks.ts` · `checkSource`). Enums, flags, a
   * result id and an app label: never the value, never the quote.
   */
  readonly check?: SourceCheck;
  /**
   * The model's quote for this argument may be SHOWN — on the row and on the
   * ask (`quotesMayShow`: no tool in reach can hide arguments). Absent → a quote
   * reads `'REDACTED'` on the row and rides no ask.
   */
  readonly quoteShown?: true;
  /**
   * Under `.time()`: the library fills the value from the turn's ONE window of
   * the person's (`core/time/bind.ts`) — who that window is. Set with `filled`.
   */
  readonly window?: WindowSource;
}

/**
 * Under `.time()` (the time layer, step T5a): the turn's windows and clock, as
 * the record holds them — the `time-reading` rows and the `clock` row of this
 * turn, read by `core/time/bind.ts` · `turnWindowsOf`. A tool whose period
 * declares forms is then filled from the turn's one window, bound to the
 * person's window, or recorded as the model's (`callWindowOf`). Absent → the
 * arm is off and every call is resolved exactly as before.
 */
export interface TimeArm {
  readonly turn: TurnWindows;
  /** The turn's frozen clock. */
  readonly now: InstantText;
  /** The clock's zone. */
  readonly zone: ZoneName;
  /** The app's `.time({ zone })` — a form declaring `wallZone: 'app'` reads in it. */
  readonly appZone?: ZoneName;
}

/**
 * The declared sources, as the layer's stages are handed them: each call's
 * `from` entries (`sources.ts` · `CallSources`, by call id — a call with no
 * entry declares nothing: its tool owns the reserved argument) and, for the
 * checks, the corpora (`checks.ts` · `SourceCorpus`). Absent → the arm is off.
 */
export interface SourcesArm {
  readonly declared: ReadonlyMap<string, CallSources>;
  /** Present from VERIFY on — DECLARE needs only the entries. */
  readonly corpus?: SourceCorpus;
  /**
   * A tool in reach may carry an arguments view — one the agent registers
   * carries one (`core/toolShownArgs.ts` · `carriesArgumentView`), or a
   * ToolProvider is wired (any provider: its list is known only per
   * iteration). Decided once, at build; present only then; read by VERIFY
   * (`quotesMayShow`): no quote is shown on a row or an ask.
   */
  readonly argumentViews?: true;
}

/**
 * One value the library fills into a call, raw: the declared default
 * (`default`), the person's answer to the batch ask (`answered`), or — under
 * `.time()` — the turn's one window of the person's, converted into the tool's
 * form (`window`; `from` says whose window: their words, a model reader's
 * reading, a UI control). A window fill of an `object` form is an object.
 */
export type ArgumentFill =
  | {
      readonly argument: string;
      readonly value: InputValue;
      readonly source: 'default';
    }
  | {
      readonly argument: string;
      /** A window answered for an `object` form is an object (the lazy word-driven ask). */
      readonly value: InputValue | Readonly<Record<string, InputValue>>;
      readonly source: 'answered';
      /** The value was written by the library from the WINDOW the person chose (the lazy word-driven ask). */
      readonly window?: true;
      /** …and no form held that window exactly, so it reads a wider one (as a `window` fill's `wider`). */
      readonly wider?: 'reads-more' | 'tool-trims';
    }
  | {
      readonly argument: string;
      readonly value: InputValue | Readonly<Record<string, InputValue>>;
      readonly source: 'window';
      readonly from: WindowSource;
      /**
       * No form holds the window exactly, so the value reads a WIDER one (step
       * T5b): `reads-more` — the call reads parts nobody asked for;
       * `tool-trims` — the tool declares `filtersToAsked` and drops them.
       */
      readonly wider?: 'reads-more' | 'tool-trims';
    };

/**
 * What ToolCalls applies to ONE call of the batch the layer resolved: the
 * values to fill, or the sentence the call reads instead of running. Working
 * state, never a row: it holds the RAW filled value, because the call must run
 * with it — the same class as the assistant message's own arguments. Stamped
 * with the batch's iteration, so an entry is only ever applied to the batch it
 * was resolved for.
 */
export interface ArgumentResolution {
  readonly toolCallId: string;
  readonly iteration: number;
  readonly fills?: readonly ArgumentFill[];
  readonly refused?: string;
  /**
   * The `ask`-ruled arguments to ask the person for, in the rule's declared
   * order — names only: the ones this call left out, and, under declared
   * sources, the ones whose present value is not traced to a source the record
   * holds. ToolCalls asks the person for every one of them across the batch,
   * ONCE and before anything runs (`arguments/ask.ts`), and fills the answers
   * as `answered`.
   */
  readonly ask?: readonly string[];
  /**
   * Under declared sources: for an argument asked because the model READ a
   * value into the person's words (`said` + `reading`), those words — the
   * quote the model declared, found in the person's own messages — so the ask
   * can show the person what was read. Never the model's value, and never
   * while a tool in reach may hide arguments (`quotesMayShow`).
   */
  readonly quoted?: readonly { readonly argument: string; readonly quote: string }[];
  /**
   * Under `.time({ reader })`: the call left its period out while the turn's
   * one mention was still OPEN (`core/time/bind.ts` · `not-filled` /
   * `open-reading`) — its period arguments in `ask` are asked as that
   * mention's window, in one field for the batch (`ask.ts` · `planAskFields`,
   * the lazy word-driven ask of time design § 5.2), not one by one.
   */
  readonly window?: true;
}

// ─── DECLARE ────────────────────────────────────────────────────────────

/** The free arguments (no rule) a call's `from` entries name, in declared order. */
function freeNamed(
  sources: SourcesArm | undefined,
  toolCallId: string,
  ruled: readonly { readonly argument: string }[],
): string[] {
  const from = sources?.declared.get(toolCallId)?.from ?? [];
  const ruledNames = new Set(ruled.map((r) => r.argument));
  return from.filter((e) => !ruledNames.has(e.argument)).map((e) => e.argument);
}

/**
 * Every call of the batch whose tool carries rules — read through `rulesOf`,
 * the dispatch re-read of the SAME assert `defineTool` runs — with each ruled
 * argument marked missing or present. A call whose rules cannot be read is
 * planned as refused. Calls to tools without rules are not planned — unless,
 * under declared sources (`sources`), a `from` entry names one of their
 * arguments: that argument is planned FREE, to be checked and filed.
 */
export function declareBatch(
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  sources?: SourcesArm,
): PlannedCall[] {
  const plan: PlannedCall[] = [];
  for (const call of calls) {
    const rules = rulesOf(toolOf(call.name));
    if (rules === undefined) {
      const free = freeNamed(sources, call.id, []);
      if (free.length > 0) plan.push({ toolCallId: call.id, toolName: call.name, ruled: [], free });
      continue;
    }
    if (isRefused(rules)) {
      plan.push({ toolCallId: call.id, toolName: call.name, refused: rules.refused, ruled: [] });
      continue;
    }
    const free = freeNamed(sources, call.id, rules.ruled);
    plan.push({
      toolCallId: call.id,
      toolName: call.name,
      ruled: rules.ruled.map((r) => ({
        argument: r.argument,
        rule: r.rule,
        ...(r.period === true && { period: true as const }),
        missing: isMissing(call.args, r.argument),
      })),
      ...(free.length > 0 && { free }),
    });
  }
  return plan;
}

// ─── VERIFY ─────────────────────────────────────────────────────────────

const callById = (calls: readonly BatchCall[]): Map<string, BatchCall> =>
  new Map(calls.map((c) => [c.id, c]));

/** The tool's rules, when they can be read — `undefined` otherwise. */
function readableRules(toolOf: ToolOf, toolName: string): ToolRules | undefined {
  const rules = rulesOf(toolOf(toolName));
  return rules === undefined || isRefused(rules) ? undefined : rules;
}

/** The declared default of one ruled argument, read off the implementation that will run. */
function declaredDefault(
  toolOf: ToolOf,
  toolName: string,
  argument: string,
): InputValue | undefined {
  return readableRules(toolOf, toolName)?.ruled.find((r) => r.argument === argument)?.assume;
}

/**
 * The person's answer KEPT for one `ask`-ruled (tool, argument) this turn
 * (`kept.ts`), when it still fits the property's own schema on the
 * implementation that will run — re-checked by the same validator the answer
 * passed when it was bound; one that no longer fits is not used, and the
 * value is asked for as usual.
 */
function keptValue(
  toolOf: ToolOf,
  kept: readonly KeptAnswer[] | undefined,
  toolName: string,
  argument: string,
): InputValue | undefined {
  const answer = keptAnswerFor(kept, toolName, argument);
  if (answer === undefined) return undefined;
  const properties = toolOf(toolName)?.schema.inputSchema?.properties;
  const property =
    typeof properties === 'object' && properties !== null
      ? (properties as Record<string, unknown>)[argument]
      : undefined;
  const schema =
    typeof property === 'object' && property !== null
      ? (property as Readonly<Record<string, unknown>>)
      : undefined;
  return validatePropertyValue(answer.value, schema).ok ? answer.value : undefined;
}

/** A free-text `ask` field — a string with no declared choices: the person typed a name. */
function isFreeAsk(toolOf: ToolOf, toolName: string, argument: string): boolean {
  const rule = readableRules(toolOf, toolName)?.ruled.find((r) => r.argument === argument);
  return rule?.type === 'string' && rule.ask !== undefined && rule.ask.choices === undefined;
}

/** The model's `from` entry for one argument of one call, if it declared one. */
function claimFor(
  sources: SourcesArm | undefined,
  toolCallId: string,
  argument: string,
): DeclaredSource | undefined {
  return sources?.declared.get(toolCallId)?.from.find((e) => e.argument === argument);
}

/**
 * The declared-sources verdict on one present value (`checks.ts` ·
 * `checkSource`) — `undefined` when the arm is off for this call (no corpus,
 * or the call declares nothing: its tool owns the reserved argument).
 */
function sourceCheckOf(
  sources: SourcesArm | undefined,
  toolOf: ToolOf,
  call: BatchCall,
  argument: string,
  rule: RuledArgument | undefined,
): SourceCheck | undefined {
  if (sources?.corpus === undefined || !sources.declared.has(call.id)) return undefined;
  const tool = toolOf(call.name);
  const spelling =
    rule?.period === true ? readableRules(toolOf, call.name)?.period?.spelling : undefined;
  const claim = claimFor(sources, call.id, argument);
  return checkSource(
    {
      toolName: call.name,
      argument,
      value: call.args[argument],
      ...(rule !== undefined && { rule }),
      ...(spelling !== undefined && { spelling }),
      ...(tool?.argumentsFrom !== undefined && { argumentsFrom: tool.argumentsFrom }),
      ...(claim !== undefined && { claim }),
    },
    sources.corpus,
  );
}

/** A present value's place under the arm: run on the verdict, or — an untraced `ask` value — ask. */
function placeChecked(
  base: Omit<CheckedArgument, 'source' | 'asked' | 'check'>,
  check: SourceCheck,
): CheckedArgument {
  if (base.rule === 'ask' && !isTraced(check)) return { ...base, asked: 'unverified', check };
  return { ...base, source: check.source, check };
}

/**
 * Whether ANY quote of this batch may be SHOWN — on its row and on the ask. A
 * quote is free text the model wrote, token-equal to the person's words: it
 * may hold ANY value the person gave, in any spelling (a user name and a
 * password in one sentence; a PIN typed "1 2 3 4" and passed as `1234`), and
 * no tool's view covers it — a tool hides its OWN arguments. So a quote is
 * shown only on an agent where no tool in reach can hide arguments
 * (`SourcesArm.argumentViews`, decided ONCE at build over every party
 * `toolOf` can resolve — the registry, each tool asked, and any ToolProvider,
 * whatever it lists). Decided before the first quote is filed, so no ordering
 * can leak one: a quote filed BEFORE the call that carries the hidden value,
 * in an earlier iteration or turn, or before a provider first lists the tool
 * that hides it, is hidden too. The checks still read every quote in memory;
 * only what the record SHOWS is decided here.
 */
function quotesMayShow(sources: SourcesArm | undefined): boolean {
  return sources?.corpus !== undefined && sources.argumentViews !== true;
}

/**
 * The quotes the model declared as the person's (`source: 'user'`) for a
 * call's period arguments — `undefined` when declared sources are off for the
 * call (the arm is off, or the call declares nothing). Read from the entries
 * alone, so every stage (with or without the corpora) decides alike.
 */
function periodQuotesOf(
  sources: SourcesArm | undefined,
  toolCallId: string,
  periodArguments: ReadonlySet<string>,
): readonly string[] | undefined {
  if (sources === undefined || !sources.declared.has(toolCallId)) return undefined;
  const from = sources.declared.get(toolCallId)?.from ?? [];
  return from
    .filter((e) => e.source === 'user' && e.quote !== undefined && periodArguments.has(e.argument))
    .map((e) => e.quote as string);
}

/**
 * Under `.time()`: per planned call whose tool's period declares forms, which
 * window the call carries (`core/time/bind.ts` · `callWindowOf`) — a pure
 * function of the call, the tool's forms and facts, the turn's windows and the
 * model's declared quotes. Empty when the arm is off. Every stage asks it
 * afresh (the same inputs, the same answer), so no decision is staged twice.
 */
export function timeDecisionsOf(
  plan: readonly PlannedCall[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  time: TimeArm | undefined,
  sources?: SourcesArm,
): ReadonlyMap<string, CallWindow> {
  const decisions = new Map<string, CallWindow>();
  if (time === undefined) return decisions;
  const byId = callById(calls);
  for (const planned of plan) {
    if (planned.refused !== undefined) continue;
    const call = byId.get(planned.toolCallId);
    const rules = readableRules(toolOf, planned.toolName);
    const forms = periodFormsOf(rules?.period);
    if (call === undefined || rules === undefined || forms.length === 0) continue;
    const quotes = periodQuotesOf(sources, call.id, periodArgumentsOf(rules.period));
    decisions.set(
      call.id,
      callWindowOf(
        {
          args: call.args,
          forms,
          isMissing: (argument) => isMissing(call.args, argument),
          ...(quotes !== undefined && { quotes }),
          facts: periodFactsOf(rules.period),
        },
        time.turn,
        {
          now: time.now,
          zone: time.zone,
          ...(time.appZone !== undefined && { appZone: time.appZone }),
          granularityMs: granularityMsOf(periodFactsOf(rules.period)),
        },
      ),
    );
  }
  return decisions;
}

/** The `call-window` rows for this batch's decisions, in batch order (`core/time/rows.ts`). */
export function callWindowRowsOf(
  decisions: ReadonlyMap<string, CallWindow>,
  calls: readonly BatchCall[],
  stamp: { readonly turn: number; readonly iteration: number },
): CallWindowRow[] {
  return calls.flatMap((c) => {
    const decision = decisions.get(c.id);
    return decision === undefined
      ? []
      : [callWindowRow({ toolCallId: c.id, toolName: c.name }, decision, stamp)];
  });
}

/** The arguments a decision FILLS — the chosen form's, by name — or none. */
function filledArguments(decision: CallWindow | undefined): ReadonlySet<string> {
  return decision?.how === 'filled'
    ? new Set(Object.keys(decision.conversion.values))
    : new Set<string>();
}

/** The arguments of every form of a decided call — a filled call leaves the others' alone. */
function formArgumentsOf(toolOf: ToolOf, toolName: string): ReadonlySet<string> {
  const forms = periodFormsOf(readableRules(toolOf, toolName)?.period);
  return new Set(forms.flatMap((f) => formArguments(f).map((a) => a.argument)));
}

/**
 * The arguments of every form OTHER than the one a present window was read
 * back from (`bound`, `model-chosen`, `model`) that the read form does not
 * also name — an alternative the call did not take. Empty for any other
 * decision; a ruled argument outside every form is never in it.
 */
function untakenFormArgumentsOf(
  toolOf: ToolOf,
  toolName: string,
  decision: CallWindow | undefined,
): ReadonlySet<string> {
  if (
    decision === undefined ||
    (decision.how !== 'bound' && decision.how !== 'model-chosen' && decision.how !== 'model')
  ) {
    return new Set();
  }
  const forms = periodFormsOf(readableRules(toolOf, toolName)?.period);
  const used = forms[decision.form];
  if (used === undefined) return new Set();
  const mine = new Set(formArguments(used).map((a) => a.argument));
  return new Set(
    forms.flatMap((f) => formArguments(f).map((a) => a.argument)).filter((a) => !mine.has(a)),
  );
}

/** The argument-row source a window fills with: the person's words, a reading of them, or the app's control. */
const sourceOfWindow = (window: WindowSource): 'said' | 'app' =>
  window === 'control' ? 'app' : 'said';

/**
 * A present period value's check under a time decision: BOUND to the person's
 * window by the model's quote → the person's words (`said`, `matched:
 * 'mention'`; a `model` reader's window stays a reading); a window that
 * DIFFERS from the person's runs as sent (the v1 law, § 7.3) — never asked.
 * The binding raises the row ONLY when the quote itself checked out — found in
 * the person's words (`source: 'said'`, nothing `failed`). A quote the check
 * refused (made up, or another runner's words) is a claim that failed: the
 * row keeps its own verdict and the call runs as sent, like a value binding.
 */
function checkUnderWindow(
  check: SourceCheck,
  decision: CallWindow | undefined,
): { readonly check: SourceCheck; readonly runs: boolean } {
  if (
    decision?.how === 'bound' &&
    decision.by === 'quote' &&
    check.failed === undefined &&
    check.source === 'said'
  ) {
    const { failed: _f, coincides: _c, reading: _r, ...kept } = check;
    void _f;
    void _c;
    void _r;
    return {
      check: {
        ...kept,
        source: 'said',
        matched: 'mention',
        ...(decision.window.source === 'derived-from-reading' && { reading: true as const }),
      },
      runs: true,
    };
  }
  // Bound by value (the sent window IS the person's, but no declared quote names it) and a window
  // that differs both run as sent; neither is raised to the person's words.
  return { check, runs: decision?.how === 'model-chosen' || decision?.how === 'bound' };
}

/**
 * Where each ruled value of each planned call came from, by the table above.
 * Unarmed (no `sources`), a present value either IS the declared default (an
 * `assume` rule) or is the model's own; a missing value on an `ask` rule is
 * placed `asked: 'missing'` — or, when this turn KEPT the person's answer for
 * that (tool, argument) (`kept`), filled with it and placed `answered`. Under
 * declared sources, a PRESENT value — and every free argument a `from` entry
 * names — is checked (`checks.ts` · `checkSource`), and an untraced value on
 * an `ask` rule is asked about (`asked: 'unverified'`).
 */
export function verifyPlan(
  plan: readonly PlannedCall[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  kept?: readonly KeptAnswer[],
  sources?: SourcesArm,
  time?: TimeArm,
): CheckedArgument[] {
  const byId = callById(calls);
  const decisions = timeDecisionsOf(plan, calls, toolOf, time, sources);
  const checked: CheckedArgument[] = [];
  // Quotes are shown on this batch's rows and ask only when no tool in reach can hide
  // arguments — and never beside a call whose name nothing answers (no view to ask).
  const quotesShown = quotesMayShow(sources);
  const quoteOf = (call: BatchCall, argument: string): { quoteShown?: true } =>
    quotesShown &&
    toolOf(call.name) !== undefined &&
    claimFor(sources, call.id, argument)?.quote !== undefined
      ? { quoteShown: true }
      : {};
  for (const planned of plan) {
    if (planned.refused !== undefined) continue;
    const call = byId.get(planned.toolCallId);
    if (call === undefined) continue;
    const rules = readableRules(toolOf, planned.toolName);
    const decision = decisions.get(planned.toolCallId);
    // Refused before dispatch on its window (step T5b): the call will not run, so none of its
    // arguments is filled, asked or filed — its `call-window` row is the record.
    if (decision?.how === 'refused') continue;
    const filled = filledArguments(decision);
    const alternatives = filled.size > 0 ? formArgumentsOf(toolOf, planned.toolName) : filled;
    // A window the model SENT in one form: another form's missing arguments were an alternative
    // it did not take — never filled or asked (step T5b: a look-back sent to a tool that also
    // takes bounds must run, so the clock at dispatch can record it).
    const untaken = untakenFormArgumentsOf(toolOf, planned.toolName, decision);
    for (const p of planned.ruled) {
      const base = {
        toolCallId: planned.toolCallId,
        toolName: planned.toolName,
        argument: p.argument,
        rule: p.rule,
        ...(p.period === true && { period: true as const }),
      };
      // Under `.time()`: the turn's one window fills the chosen form's arguments; another
      // form's arguments were an alternative the call no longer needs — never filled or asked.
      if (decision?.how === 'filled' && filled.has(p.argument)) {
        const from = decision.window.source;
        checked.push({ ...base, source: sourceOfWindow(from), filled: true, window: from });
        continue;
      }
      if (alternatives.has(p.argument)) continue;
      if (p.missing && untaken.has(p.argument)) continue;
      const rule = rules?.ruled.find((r) => r.argument === p.argument);
      const check = p.missing ? undefined : sourceCheckOf(sources, toolOf, call, p.argument, rule);
      if (check !== undefined) {
        if (p.period === true && decision !== undefined) {
          const under = checkUnderWindow(check, decision);
          checked.push(
            under.runs || isTraced(under.check)
              ? {
                  ...base,
                  ...quoteOf(call, p.argument),
                  source: under.check.source,
                  check: under.check,
                }
              : placeChecked({ ...base, ...quoteOf(call, p.argument) }, under.check),
          );
          continue;
        }
        checked.push(placeChecked({ ...base, ...quoteOf(call, p.argument) }, check));
        continue;
      }
      if (p.rule === 'ask') {
        if (!p.missing) {
          checked.push({ ...base, source: 'model' });
        } else if (keptValue(toolOf, kept, planned.toolName, p.argument) !== undefined) {
          checked.push({ ...base, source: 'answered', filled: true });
        } else {
          checked.push({ ...base, asked: 'missing' });
        }
        continue;
      }
      const assumed = declaredDefault(toolOf, planned.toolName, p.argument);
      if (assumed === undefined) continue;
      if (p.missing) {
        checked.push({ ...base, source: 'default', filled: true });
      } else if (sameArgumentValue(call.args[p.argument], assumed)) {
        checked.push({ ...base, source: 'default' });
      } else {
        checked.push({ ...base, source: 'model' });
      }
    }
    for (const argument of planned.free ?? []) {
      const check = sourceCheckOf(sources, toolOf, call, argument, undefined);
      if (check === undefined) continue;
      checked.push({
        toolCallId: planned.toolCallId,
        toolName: planned.toolName,
        argument,
        source: check.source,
        check,
        ...quoteOf(call, argument),
      });
    }
  }
  return checked;
}

// ─── RECORD ─────────────────────────────────────────────────────────────

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
  call: BatchCall,
  toolOf: ToolOf,
  sources: SourcesArm | undefined,
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow {
  const tool = toolOf(c.toolName);
  // A name nothing answers has no view to ask — shown as hidden, never raw.
  const shown = tool === undefined ? HIDDEN_VALUE : shownArgsOf(tool, call.args)[c.argument];
  const quoteShown = c.quoteShown === true;
  const quote = claimFor(sources, c.toolCallId, c.argument)?.quote;
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
  call: BatchCall,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  kept: readonly KeptAnswer[] | undefined,
  decision: CallWindow | undefined,
): ArgumentRow | undefined {
  const tool = toolOf(c.toolName);
  const who = { ...c, rule: ruleOf(c) };
  if (c.asked !== undefined) return askedRowOf(who, stamp);
  if (c.filled === true && c.window !== undefined) {
    const value = windowValue(decision, c.argument);
    if (value === undefined) return undefined;
    const shown = shownArgsOf(tool, { ...call.args, [c.argument]: value });
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
    const answer = keptValue(toolOf, kept, c.toolName, c.argument);
    if (answer === undefined) return undefined;
    const shown = shownArgsOf(tool, { ...call.args, [c.argument]: answer });
    return answeredRowOf(
      {
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        argument: c.argument,
        rule: 'ask',
        ...(c.period === true && { period: true as const }),
        // A name nothing answers has no view to ask — shown as hidden, never raw.
        shownValue: tool === undefined ? HIDDEN_VALUE : shown[c.argument],
        ...(isFreeAsk(toolOf, c.toolName, c.argument) && { free: true as const }),
      },
      stamp,
    );
  }
  if (c.filled === true) {
    const assumed = declaredDefault(toolOf, c.toolName, c.argument);
    if (assumed === undefined) return undefined;
    const shown = shownArgsOf(tool, { ...call.args, [c.argument]: assumed });
    return argumentRowOf({ ...who, source: 'default', shownValue: shown[c.argument] }, stamp);
  }
  const shown = shownArgsOf(tool, call.args)[c.argument];
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
export function rowsOf(
  checked: readonly CheckedArgument[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  kept?: readonly KeptAnswer[],
  sources?: SourcesArm,
  decisions?: ReadonlyMap<string, CallWindow>,
): ArgumentRow[] {
  const byId = callById(calls);
  const rows: ArgumentRow[] = [];
  const counted = new Set<string>();
  for (const c of checked) {
    const call = byId.get(c.toolCallId);
    if (call === undefined) continue;
    const row =
      c.check !== undefined
        ? sourcedRow({ ...c, check: c.check }, call, toolOf, sources, stamp)
        : plainRow(c, call, toolOf, stamp, kept, decisions?.get(c.toolCallId));
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

// ─── RESOLVE ────────────────────────────────────────────────────────────

/**
 * The person's own words a READING was made of, for the ask's field — the
 * quote the model declared, found in the person's messages (`said` +
 * `reading`), and only where the row may show it (`quoteShown`: the ask is on
 * the record too).
 */
function quotedFor(c: CheckedArgument, sources: SourcesArm | undefined): string | undefined {
  if (c.asked !== 'unverified' || c.check?.source !== 'said' || c.check.reading !== true) {
    return undefined;
  }
  if (c.quoteShown !== true) return undefined;
  return claimFor(sources, c.toolCallId, c.argument)?.quote;
}

/**
 * What ToolCalls applies: per call, the declared defaults and the kept answers
 * to fill and the `ask` arguments to ask the person for (with, under declared
 * sources, the person's words a reading was made of), or — for a call whose
 * rules could not be read — the sentence it reads instead of running. Nothing
 * for a call that runs as the model sent it.
 */
export function resolutionsOf(
  plan: readonly PlannedCall[],
  checked: readonly CheckedArgument[],
  toolOf: ToolOf,
  iteration: number,
  kept?: readonly KeptAnswer[],
  sources?: SourcesArm,
  decisions?: ReadonlyMap<string, CallWindow>,
): ArgumentResolution[] {
  const resolutions: ArgumentResolution[] = [];
  for (const planned of plan) {
    if (planned.refused !== undefined) {
      resolutions.push({
        toolCallId: planned.toolCallId,
        iteration,
        refused: unreadableRulesRefusal(planned.toolName, planned.refused),
      });
      continue;
    }
    const decision = decisions?.get(planned.toolCallId);
    if (decision?.how === 'refused') {
      resolutions.push({
        toolCallId: planned.toolCallId,
        iteration,
        refused: timeRefusal(
          planned.toolName,
          decision.refused,
          periodFactsOf(readableRules(toolOf, planned.toolName)?.period),
          decision.argument,
        ),
      });
      continue;
    }
    const fills: ArgumentFill[] = [];
    const ask: string[] = [];
    const quoted: { argument: string; quote: string }[] = [];
    for (const c of checked) {
      if (c.toolCallId !== planned.toolCallId) continue;
      if (c.asked !== undefined) {
        ask.push(c.argument);
        const quote = quotedFor(c, sources);
        if (quote !== undefined) quoted.push({ argument: c.argument, quote });
        continue;
      }
      if (c.filled !== true) continue;
      if (c.window !== undefined) continue; // the window's fills are added per call, below
      if (c.source === 'answered') {
        const answer = keptValue(toolOf, kept, c.toolName, c.argument);
        if (answer !== undefined) {
          fills.push({ argument: c.argument, value: answer, source: 'answered' });
        }
        continue;
      }
      const value = declaredDefault(toolOf, c.toolName, c.argument);
      if (value !== undefined) fills.push({ argument: c.argument, value, source: 'default' });
    }
    // Under `.time()`: every argument the turn's one window fills — the ruled ones filed above,
    // and an `object` form's (a ruled argument is a flat value, so an object carries no rule).
    if (decision?.how === 'filled') {
      const wider =
        'sent' in decision.conversion
          ? decision.trimmedByTool === true
            ? ('tool-trims' as const)
            : ('reads-more' as const)
          : undefined;
      for (const [argument, value] of Object.entries(decision.conversion.values)) {
        fills.push({
          argument,
          value: value as InputValue | Readonly<Record<string, InputValue>>,
          source: 'window',
          from: decision.window.source,
          ...(wider !== undefined && { wider }),
        });
      }
    }
    // The lazy word-driven ask: a period left out while the turn's one mention is open is asked
    // as that mention's window — only where the tool's own rule asks for a period argument.
    const forms = formArgumentsOf(toolOf, planned.toolName);
    const window =
      decision?.how === 'not-filled' &&
      decision.why === 'open-reading' &&
      ask.some((a) => forms.has(a));
    if (fills.length > 0 || ask.length > 0) {
      resolutions.push({
        toolCallId: planned.toolCallId,
        iteration,
        ...(fills.length > 0 && { fills }),
        ...(ask.length > 0 && { ask }),
        ...(quoted.length > 0 && { quoted }),
        ...(window && { window: true as const }),
      });
    }
  }
  return resolutions;
}
