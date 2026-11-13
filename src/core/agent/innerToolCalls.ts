/**
 * innerToolCalls — INTERNAL. Where an inner call (`ctx.tools.call`) becomes record.
 *
 * Pattern: one writer for one committed key (the `middleware/ledger.ts` shape).
 * Role:    core/agent. Inner dispatch (`toolDispatch.ts`) decides; this file
 *          is the only thing that writes `innerToolCalls`, one row per inner
 *          call, appended when the call ends.
 * Emits:   nothing. The gates file their own events under the inner id.
 *
 * WHY A ROW OF ITS OWN. The readers that count the model's calls read
 * `stream.tool_start` / `stream.tool_end` or the history's tool messages —
 * the account of a run, the cost and status recorders, the UI adapters, the
 * tool-call journal, the check-in trail. An inner call is not a call the
 * model made, so it rides none of those; its row sits on a key none of them
 * reads. It is written when the call ends, in the stage of the outer call that
 * made it, so it is committed with that stage's writes, the way
 * `middlewareDecisions` keeps the chain's rows. Two calls leave no row: one
 * whose composing tool did not await it and that ended after that stage
 * committed, and one made through a `ctx.tools` kept past a stage that has
 * committed (refused, `refusedBy: 'ended'` — its row is written only while
 * the outer call's stage is still open). And a chain that threw OUT of the
 * walker (a link returning nothing at all) files no `middleware.decision`
 * for the inner call: the row's `refusedBy: 'middleware'` is its record.
 *
 * THE ROWS FEED THE SEQUENCE. The rows of one outer call whose function was
 * entered are what a later checker sees of it (`innerCallsRanOf`): handed to
 * the next inner call's checker while the outer call runs, and stamped on the
 * outer call's history message when it lands (`LLMMessage.calls`), so a
 * later turn's sequence keeps them.
 *
 * Example — `tidy_up` (model call `c1`) calls `delete_account`, which the
 * permission checker denies:
 *
 *   { toolCallId: 'c1#inner-1', outerToolCallId: 'c1', toolName: 'delete_account',
 *     iteration: 1, args: { id: 'A1' }, entered: false, ended: 'refused',
 *     refusedBy: 'permission' }
 *
 * `args` is shown through the tool's own argument view
 * (`../toolShownArgs.ts` · `shownArgsOf`): a key the tool hides reads as its
 * placeholder, as it does wherever the record shows a tool's arguments. Under
 * `conversationRedaction()` the key `innerToolCalls` is kept out whole, as
 * `middlewareDecisions` is (`redaction/conversation.ts`): a policy's field
 * selector does not reach into the rows of a list.
 */

import type { TypedScope } from 'footprintjs';

import { frozenProjectionOf, frozenView } from '../../lib/frozenCopy.js';
import { shownArgsOf } from '../toolShownArgs.js';
import type { InnerCallRan } from '../../provider-contract/innerCalls.js';
import {
  innerCallNumberOf,
  type InnerCallEnd,
  type InnerCallFacts,
  type InnerCallRefuser,
} from './toolDispatch.js';

/** One inner call, as the record keeps it on `innerToolCalls`. */
export interface InnerToolCallRow {
  /** The inner call's own id: `<outerToolCallId>#inner-<n>`. Its gates' events carry it. */
  readonly toolCallId: string;
  /** The call the model made whose tool asked for this one. */
  readonly outerToolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  /**
   * The arguments as they stood when the call ended — after every before-tool
   * rewrite the chain allowed. When `entered` is true these are the arguments
   * the tool's function ran with. Shown through the tool's argument view.
   * `{}` for a call refused because its composing tool passed something that
   * is not an object (that value is not kept).
   */
  readonly args: Readonly<Record<string, unknown>>;
  /** Whether the tool's function was entered. `false` for every refusal. */
  readonly entered: boolean;
  /** `'returned'`, `'threw'` and `'paused'` only after `entered`; `'refused'` only before it. */
  readonly ended: InnerCallEnd;
  /** Who refused it — present exactly when `ended` is `'refused'`. */
  readonly refusedBy?: InnerCallRefuser;
  /** The refusal was a checker's `'halt'`: the run ended after the outer call settled. */
  readonly halted?: true;
}

/** The outer call every row of one `ctx.tools` names. */
export interface InnerCallOwner {
  readonly toolCallId: string;
  readonly iteration: number;
}

/**
 * Append one inner call's row. The arguments are copied here — a frozen copy,
 * or what JSON writes of them when no copy can be made — so nothing the
 * composing tool does to its object afterwards reaches the record.
 */
export function recordInnerToolCall(
  scope: TypedScope<{ innerToolCalls?: readonly InnerToolCallRow[] }>,
  owner: InnerCallOwner,
  facts: InnerCallFacts,
): void {
  const shown = shownArgsOf(facts.tool, facts.args);
  const row: InnerToolCallRow = {
    toolCallId: facts.toolCallId,
    outerToolCallId: owner.toolCallId,
    toolName: facts.toolName,
    iteration: owner.iteration,
    args: frozenView(shown) ?? frozenProjectionOf(shown),
    entered: facts.entered,
    ended: facts.ended,
    ...(facts.refusedBy !== undefined && { refusedBy: facts.refusedBy }),
    ...(facts.halted === true && { halted: true as const }),
  };
  const prior = (scope.innerToolCalls as readonly InnerToolCallRow[] | undefined) ?? [];
  // A plain local array first: a TypedScope array read is a live proxy view.
  scope.innerToolCalls = [...prior, row];
}

/** The rows a run's state holds — `[]` before the first inner call. */
export function innerToolCallRowsOf(state: {
  readonly innerToolCalls?: unknown;
}): readonly InnerToolCallRow[] {
  return (state.innerToolCalls as readonly InnerToolCallRow[] | undefined) ?? [];
}

/** A stage's scope, read raw: the rows as plain objects, never live proxy views. */
export interface RawStateReader {
  $getValue(key: string): unknown;
}

/**
 * The rows the running stage holds so far, as plain objects (`$getValue`).
 * Asked first with `in` — the scope's `has` trap, which records no read — so
 * a run whose tools made no inner call reads nothing here and keeps exactly
 * the reads (and the narrative) it always had.
 */
export function liveInnerToolCallRowsOf(scope: RawStateReader): readonly InnerToolCallRow[] {
  if (!('innerToolCalls' in scope)) return [];
  return innerToolCallRowsOf({ innerToolCalls: scope.$getValue('innerToolCalls') });
}

/**
 * The inner calls of ONE outer call whose tool's function was entered, in the
 * order the composing tool made them — what a sequence counts of that call (a
 * refused inner call ran nothing, as a denied model call is not in the
 * sequence). Matched by the outer call's id AND iteration, since a provider may
 * reuse an id on a later iteration.
 */
export function innerCallsRanOf(
  rows: readonly InnerToolCallRow[],
  outerToolCallId: string,
  iteration: number,
): readonly InnerCallRan[] {
  return rows
    .filter((r) => r.outerToolCallId === outerToolCallId && r.iteration === iteration && r.entered)
    .sort((a, b) => innerCallNumberOf(a.toolCallId) - innerCallNumberOf(b.toolCallId))
    .map((r) => ({ toolCallId: r.toolCallId, toolName: r.toolName, args: r.args }));
}

/**
 * The field the outer call's `role: 'tool'` history message carries — spread
 * into the message at every door that lands a result whose tool could have
 * made inner calls. Empty (no field at all) when none ran, so a run without
 * inner calls writes exactly the history it always did.
 */
export function innerCallsFieldOf(
  scope: RawStateReader,
  outerToolCallId: string,
  iteration: number,
): { readonly calls?: readonly InnerCallRan[] } {
  const ran = innerCallsRanOf(liveInnerToolCallRowsOf(scope), outerToolCallId, iteration);
  return ran.length > 0 ? { calls: ran } : {};
}
