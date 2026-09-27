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
 * ## The table this version applies (declared sources unarmed)
 *
 * | The value                               | `assume` rule                   | `ask` rule                        |
 * |-----------------------------------------|---------------------------------|-----------------------------------|
 * | missing                                 | `default` — fill the default    | `asked: 'missing'` — ask, once per batch |
 * | missing, an answer KEPT for it (`kept.ts`) | —                            | `answered` — fill the person's kept answer |
 * | present, equal to the declared default  | `default` — run (model's value) | — (an `ask` rule has no default)  |
 * | present, any other value                | `model` — run, flagged          | `model` — run, flagged (adopted Q2) |
 *
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
import { shownArgsOf } from '../../toolShownArgs.js';
import { validatePropertyValue } from '../toolArgsValidation.js';
import { isMissing, isRefused, rulesOf, sameArgumentValue, type RuledToolLike } from './declare.js';
import { keptAnswerFor, type KeptAnswer } from './kept.js';
import {
  HIDDEN_VALUE,
  answeredRowOf,
  argumentRowOf,
  askedRowOf,
  type ArgumentRow,
} from './rows.js';
import { unreadableRulesRefusal } from './serve.js';

/** One call of the batch, as the model emitted it (its raw arguments). */
export interface BatchCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** The implementation that will answer a name — the shared dispatch resolver's. */
export type ToolOf = (toolName: string) => RuledToolLike | undefined;

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
}

/** One ruled argument, as VERIFY placed it. No value — the rows take the value in the tool's view. */
export interface CheckedArgument {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argument: string;
  readonly rule: 'ask' | 'assume';
  readonly period?: true;
  /** Where the value came from — absent exactly on an argument to ASK (`asked`). */
  readonly source?: 'default' | 'model' | 'answered';
  /**
   * The library fills the value — the call left the argument out: the declared
   * default (`source: 'default'`), or the person's answer KEPT for this
   * (tool, argument) (`source: 'answered'`, `kept.ts`).
   */
  readonly filled?: true;
  /** The call left an `ask` argument out: the person is asked, once per batch. */
  readonly asked?: 'missing';
}

/**
 * One value the library fills into a call, raw: the declared default
 * (`default`), or the person's answer to the batch ask (`answered`).
 */
export interface ArgumentFill {
  readonly argument: string;
  readonly value: InputValue;
  readonly source: 'default' | 'answered';
}

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
   * The `ask`-ruled arguments this call left out, in the rule's declared order
   * — names only. ToolCalls asks the person for every one of them across the
   * batch, ONCE and before anything runs (`arguments/ask.ts`), and fills the
   * answers as `answered`.
   */
  readonly ask?: readonly string[];
}

// ─── DECLARE ────────────────────────────────────────────────────────────

/**
 * Every call of the batch whose tool carries rules — read through `rulesOf`,
 * the dispatch re-read of the SAME assert `defineTool` runs — with each ruled
 * argument marked missing or present. A call whose rules cannot be read is
 * planned as refused. Calls to tools without rules are not planned.
 */
export function declareBatch(calls: readonly BatchCall[], toolOf: ToolOf): PlannedCall[] {
  const plan: PlannedCall[] = [];
  for (const call of calls) {
    const rules = rulesOf(toolOf(call.name));
    if (rules === undefined) continue;
    if (isRefused(rules)) {
      plan.push({ toolCallId: call.id, toolName: call.name, refused: rules.refused, ruled: [] });
      continue;
    }
    plan.push({
      toolCallId: call.id,
      toolName: call.name,
      ruled: rules.ruled.map((r) => ({
        argument: r.argument,
        rule: r.rule,
        ...(r.period === true && { period: true as const }),
        missing: isMissing(call.args, r.argument),
      })),
    });
  }
  return plan;
}

// ─── VERIFY ─────────────────────────────────────────────────────────────

const callById = (calls: readonly BatchCall[]): Map<string, BatchCall> =>
  new Map(calls.map((c) => [c.id, c]));

/** The declared default of one ruled argument, read off the implementation that will run. */
function declaredDefault(
  toolOf: ToolOf,
  toolName: string,
  argument: string,
): InputValue | undefined {
  const rules = rulesOf(toolOf(toolName));
  if (rules === undefined || isRefused(rules)) return undefined;
  return rules.ruled.find((r) => r.argument === argument)?.assume;
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
  const rules = rulesOf(toolOf(toolName));
  if (rules === undefined || isRefused(rules)) return false;
  const rule = rules.ruled.find((r) => r.argument === argument);
  return rule?.type === 'string' && rule.ask !== undefined && rule.ask.choices === undefined;
}

/**
 * Where each ruled value of each planned call came from, by the table above.
 * Declared sources are not armed in this version, so a present value either IS
 * the declared default (an `assume` rule) or is the model's own; a missing
 * value on an `ask` rule is placed `asked: 'missing'` — or, when this turn
 * KEPT the person's answer for that (tool, argument) (`kept`), filled with it
 * and placed `answered`.
 */
export function verifyPlan(
  plan: readonly PlannedCall[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  kept?: readonly KeptAnswer[],
): CheckedArgument[] {
  const byId = callById(calls);
  const checked: CheckedArgument[] = [];
  for (const planned of plan) {
    if (planned.refused !== undefined) continue;
    const call = byId.get(planned.toolCallId);
    if (call === undefined) continue;
    for (const p of planned.ruled) {
      const base = {
        toolCallId: planned.toolCallId,
        toolName: planned.toolName,
        argument: p.argument,
        rule: p.rule,
        ...(p.period === true && { period: true as const }),
      };
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
  }
  return checked;
}

// ─── RECORD ─────────────────────────────────────────────────────────────

/**
 * One row per checked argument, its value in the tool's OWN argument view
 * (`shownArgsOf`) — a fill is shown as the call will run with it, a model's
 * value as the model sent it; an argument to ASK has no value yet, so its row
 * carries none; a kept answer files `answered` (`free` for a free-text
 * field), exactly as the answer did when the person gave it. The raw value
 * never reaches a row.
 */
export function rowsOf(
  checked: readonly CheckedArgument[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  kept?: readonly KeptAnswer[],
): ArgumentRow[] {
  const byId = callById(calls);
  const rows: ArgumentRow[] = [];
  for (const c of checked) {
    const call = byId.get(c.toolCallId);
    if (call === undefined) continue;
    const tool = toolOf(c.toolName);
    if (c.asked !== undefined) {
      rows.push(askedRowOf(c, stamp));
      continue;
    }
    if (c.filled === true && c.source === 'answered') {
      const answer = keptValue(toolOf, kept, c.toolName, c.argument);
      if (answer === undefined) continue;
      const shown = shownArgsOf(tool, { ...call.args, [c.argument]: answer });
      rows.push(
        answeredRowOf(
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
        ),
      );
      continue;
    }
    if (c.filled === true) {
      const assumed = declaredDefault(toolOf, c.toolName, c.argument);
      if (assumed === undefined) continue;
      const shown = shownArgsOf(tool, { ...call.args, [c.argument]: assumed });
      rows.push(argumentRowOf({ ...c, source: 'default', shownValue: shown[c.argument] }, stamp));
      continue;
    }
    const shown = shownArgsOf(tool, call.args)[c.argument];
    rows.push(
      argumentRowOf(
        {
          ...c,
          // A present value: the declared default the model sent itself, or the model's own
          // (`answered` is only ever a FILL, handled above).
          source: c.source === 'default' ? 'default' : 'model',
          shownValue: shown,
          ...(c.source === 'default' && { shownProposed: shown }),
        },
        stamp,
      ),
    );
  }
  return rows;
}

// ─── RESOLVE ────────────────────────────────────────────────────────────

/**
 * What ToolCalls applies: per call, the declared defaults and the kept answers
 * to fill and the `ask` arguments to ask the person for, or — for a call whose
 * rules could not be read — the sentence it reads instead of running. Nothing
 * for a call that runs as the model sent it.
 */
export function resolutionsOf(
  plan: readonly PlannedCall[],
  checked: readonly CheckedArgument[],
  toolOf: ToolOf,
  iteration: number,
  kept?: readonly KeptAnswer[],
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
    const fills: ArgumentFill[] = [];
    const ask: string[] = [];
    for (const c of checked) {
      if (c.toolCallId !== planned.toolCallId) continue;
      if (c.asked === 'missing') {
        ask.push(c.argument);
        continue;
      }
      if (c.filled !== true) continue;
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
    if (fills.length > 0 || ask.length > 0) {
      resolutions.push({
        toolCallId: planned.toolCallId,
        iteration,
        ...(fills.length > 0 && { fills }),
        ...(ask.length > 0 && { ask }),
      });
    }
  }
  return resolutions;
}
