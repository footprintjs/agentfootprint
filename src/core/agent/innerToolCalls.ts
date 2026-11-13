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
 * reads. It is written while the call runs, in the stage that made it, so it
 * is committed with that stage's writes, the way `middlewareDecisions` keeps
 * the chain's rows.
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
import type { ToolArgs } from '../../tools/runChain.js';
import { shownArgsOf } from '../toolShownArgs.js';
import type { InnerCallEnd, InnerCallFacts, InnerCallRefuser } from './toolDispatch.js';

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
   */
  readonly args: Readonly<Record<string, unknown>>;
  /** Whether the tool's function was entered. `false` for every refusal. */
  readonly entered: boolean;
  /** `'returned'`, `'threw'` and `'paused'` only after `entered`; `'refused'` only before it. */
  readonly ended: InnerCallEnd;
  /** Who refused it — present exactly when `ended` is `'refused'`. */
  readonly refusedBy?: InnerCallRefuser;
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
  const given =
    facts.args !== null && typeof facts.args === 'object' && !Array.isArray(facts.args)
      ? (facts.args as ToolArgs)
      : {};
  const shown = shownArgsOf(facts.tool, given);
  const row: InnerToolCallRow = {
    toolCallId: facts.toolCallId,
    outerToolCallId: owner.toolCallId,
    toolName: facts.toolName,
    iteration: owner.iteration,
    args: frozenView(shown) ?? frozenProjectionOf(shown),
    entered: facts.entered,
    ended: facts.ended,
    ...(facts.refusedBy !== undefined && { refusedBy: facts.refusedBy }),
  };
  const prior = (scope.innerToolCalls as readonly InnerToolCallRow[] | undefined) ?? [];
  // A plain local array first: a TypedScope array read is a live proxy view.
  scope.innerToolCalls = [...prior, row];
}
