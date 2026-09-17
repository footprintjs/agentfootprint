/**
 * toolChoice/record — where a classifier's pick and the model's call become record.
 *
 * Pattern: one writer for one committed key (`findings/ledger.ts ·
 *          recordFindings`, `middleware/ledger.ts · recordDecisions`).
 * Role:    core/ layer leaf. Two call sites, one writer: the tools slot
 *          files the `pick` / `pick-error` row before the model call
 *          (`slots/buildToolsSlot.ts · composeStage`), `stages/callLLM.ts`
 *          files the `outcome` row after the reply. Both go through
 *          `recordToolChoice`, so the key is appended one way and the
 *          matching event fires once per row.
 * Emits:   `agentfootprint.tool_choice.picked` / `.failed` / `.outcome` —
 *          identities (tool names), enums, numbers and a boolean. Never the
 *          descriptions the classifier read, never the user's message.
 *
 * ## Append only, a fresh array per write
 *
 * A row is never replaced. Every write assigns `[...prior, row]` so the
 * committed value is a new array (a TypedScope array read is a live proxy
 * view — spread before use). The tools slot runs in an isolated subflow
 * whose `toolChoices` input is a FROZEN mount arg named `priorToolChoices`;
 * it hands the prior rows in explicitly and the mount's outputMapper carries
 * the fresh list back to the parent key. `callLLM` reads the parent key
 * itself and passes nothing.
 */

import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type {
  ToolChoiceEntry,
  ToolChoiceLedger,
  ToolChoiceOutcomeRow,
  ToolChoiceRow,
} from './types.js';

/** The scope surface this file needs. Structurally a `TypedScope<AgentState>`. */
export interface ToolChoiceScope {
  toolChoices?: ToolChoiceLedger;
  $emit(name: string, payload?: unknown): void;
}

/**
 * Append one row and emit its event. `prior` is the record as the caller's
 * frame holds it — passed by the tools slot (an isolated subflow that reads
 * the parent's rows as a frozen arg), defaulted to `scope.toolChoices` by
 * `callLLM`, which writes on the scope that owns the key.
 */
export function recordToolChoice(
  scope: ToolChoiceScope,
  row: ToolChoiceEntry,
  prior: readonly ToolChoiceEntry[] | undefined = scope.toolChoices,
): void {
  scope.toolChoices = [...(prior ?? []), row];
  emitRow(scope, row);
}

function emitRow(scope: ToolChoiceScope, row: ToolChoiceEntry): void {
  if (row.kind === 'pick') {
    typedEmit(scope, 'agentfootprint.tool_choice.picked', {
      iteration: row.iteration,
      ...(row.chosen !== undefined && { chosen: row.chosen }),
      confidence: row.confidence,
      offered: row.offered.length,
      served: row.served.length,
      narrowed: row.narrowed,
      ...(row.narrowedSkipped !== undefined && { narrowedSkipped: row.narrowedSkipped }),
      latencyMs: row.latencyMs,
      ...(row.usage !== undefined && {
        inputTokens: row.usage.inputTokens,
        outputTokens: row.usage.outputTokens,
      }),
    });
    return;
  }
  if (row.kind === 'pick-error') {
    typedEmit(scope, 'agentfootprint.tool_choice.failed', {
      iteration: row.iteration,
      ...(row.status !== undefined && { status: row.status }),
      latencyMs: row.latencyMs,
    });
    return;
  }
  typedEmit(scope, 'agentfootprint.tool_choice.outcome', {
    iteration: row.iteration,
    called: [...row.called],
    ...(row.firstAgrees !== undefined && { firstAgrees: row.firstAgrees }),
    ...(row.miss !== undefined && { missed: [...row.miss.wanted] }),
  });
}

/** The pick or pick-error row filed for `iteration`, or nothing — the call had no pick. */
export function pickRowFor(
  rows: readonly ToolChoiceEntry[] | undefined,
  iteration: number,
): ToolChoiceRow | undefined {
  let found: ToolChoiceRow | undefined;
  for (const row of rows ?? []) {
    if (row.kind === 'pick' && row.iteration === iteration) found = row;
  }
  return found;
}

/** Whether ANY pick was attempted for `iteration` — a `pick` or a `pick-error` row. */
export function pickAttemptedFor(
  rows: readonly ToolChoiceEntry[] | undefined,
  iteration: number,
): boolean {
  return (rows ?? []).some(
    (row) => (row.kind === 'pick' || row.kind === 'pick-error') && row.iteration === iteration,
  );
}

/**
 * The comparison row for one reply. Pure. `firstAgrees` exists only when
 * both readings do — a pick with a `chosen` and a reply with a call; `miss`
 * only when the call was narrowed and the model named a tool outside what
 * was served (a door is served, so it can never be a miss).
 */
export function outcomeRowFor(
  pick: ToolChoiceRow | undefined,
  called: readonly string[],
  iteration: number,
): ToolChoiceOutcomeRow {
  const first = called[0];
  const wanted =
    pick?.narrowed === true ? called.filter((name) => !pick.served.includes(name)) : [];
  return {
    kind: 'outcome',
    iteration,
    called: [...called],
    ...(pick?.chosen !== undefined &&
      first !== undefined && { firstAgrees: pick.chosen === first }),
    ...(wanted.length > 0 && { miss: { wanted } }),
  };
}
