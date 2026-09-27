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
 * ## The table this version applies (`assume` rules; declared sources unarmed)
 *
 * | The value                                   | Row source | Resolution          |
 * |---------------------------------------------|------------|---------------------|
 * | missing                                     | `default`  | fill the default    |
 * | present, equal to the declared default      | `default`  | run (model's value) |
 * | present, any other value                    | `model`    | run, flagged        |
 *
 * "Equal" is the evidence module's same-value rule (`declare.ts` ·
 * `sameArgumentValue`). A present value equal to the default is filed as
 * `default`, never as the model's own choice: a model that copies a default
 * from a description chose nothing (the row's `proposed` tells it from a fill).
 * A call whose tool's rules cannot be read at dispatch is refused, never run
 * unruled and never repaired.
 */

import type { InputValue } from '../../inputRequest.js';
import { shownArgsOf } from '../../toolShownArgs.js';
import { isMissing, isRefused, rulesOf, sameArgumentValue, type RuledToolLike } from './declare.js';
import { argumentRowOf, type ArgumentRow } from './rows.js';
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
  readonly source: 'default' | 'model';
  /** The library fills the declared default: the call left the argument out. */
  readonly filled?: true;
}

/** One value the library fills into a call — the declared default, raw. */
export interface ArgumentFill {
  readonly argument: string;
  readonly value: InputValue;
  readonly source: 'default';
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
 * Where each ruled value of each planned call came from, by the table above.
 * This version applies `assume` rules only (an `ask` rule never reaches here:
 * the dispatch re-read refuses it), and declared sources are not armed, so a
 * present value either IS the declared default or is the model's own.
 */
export function verifyPlan(
  plan: readonly PlannedCall[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
): CheckedArgument[] {
  const byId = callById(calls);
  const checked: CheckedArgument[] = [];
  for (const planned of plan) {
    if (planned.refused !== undefined) continue;
    const call = byId.get(planned.toolCallId);
    if (call === undefined) continue;
    for (const p of planned.ruled) {
      if (p.rule !== 'assume') continue;
      const assumed = declaredDefault(toolOf, planned.toolName, p.argument);
      if (assumed === undefined) continue;
      const base = {
        toolCallId: planned.toolCallId,
        toolName: planned.toolName,
        argument: p.argument,
        rule: p.rule,
        ...(p.period === true && { period: true as const }),
      };
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
 * value as the model sent it. The raw value never reaches a row.
 */
export function rowsOf(
  checked: readonly CheckedArgument[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow[] {
  const byId = callById(calls);
  const rows: ArgumentRow[] = [];
  for (const c of checked) {
    const call = byId.get(c.toolCallId);
    if (call === undefined) continue;
    const tool = toolOf(c.toolName);
    if (c.filled === true) {
      const assumed = declaredDefault(toolOf, c.toolName, c.argument);
      if (assumed === undefined) continue;
      const shown = shownArgsOf(tool, { ...call.args, [c.argument]: assumed });
      rows.push(argumentRowOf({ ...c, shownValue: shown[c.argument] }, stamp));
      continue;
    }
    const shown = shownArgsOf(tool, call.args)[c.argument];
    rows.push(
      argumentRowOf(
        {
          ...c,
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
 * What ToolCalls applies: per call, the declared defaults to fill, or — for a
 * call whose rules could not be read — the sentence it reads instead of
 * running. Nothing for a call that runs as the model sent it.
 */
export function resolutionsOf(
  plan: readonly PlannedCall[],
  checked: readonly CheckedArgument[],
  toolOf: ToolOf,
  iteration: number,
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
    for (const c of checked) {
      if (c.toolCallId !== planned.toolCallId || c.filled !== true) continue;
      const value = declaredDefault(toolOf, c.toolName, c.argument);
      if (value !== undefined) fills.push({ argument: c.argument, value, source: 'default' });
    }
    if (fills.length > 0) resolutions.push({ toolCallId: planned.toolCallId, iteration, fills });
  }
  return resolutions;
}
