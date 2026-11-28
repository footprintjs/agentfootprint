import {
  callOccurrenceField,
  readCallOccurrenceKey,
  type CallOccurrenceKey,
} from '../../../lib/callOccurrence.js';
/**
 * middleware/ledger — INTERNAL. Where a chain's decisions become record.
 *
 * Pattern: one writer for one committed key.
 * Role:    core/ layer. `runChain` decides; this file is the only thing
 *          that commits what it decided and emits the matching event, so
 *          the agent's call sites (the tool dispatch, an inner call through
 *          `ctx.tools`, the message boundary) cannot record the same fact
 *          different ways.
 * Emits:   `agentfootprint.middleware.decision`, one per row.
 *
 * ## Why the original value is committed too
 *
 * A transform makes the trace and the wire disagree — the model saw one
 * string, the run remembers another. Committing the pair, with the
 * middleware's name and its `why` beside it, is what turns that
 * disagreement from a lie into a record. Every slice taken afterwards can
 * then find the moment the value changed and who changed it.
 *
 * The same reasoning covers the `'after-tool'` moment from the other side. A
 * result the model was not allowed to read still HAPPENED — the tool ran, the
 * side effect landed — so the refusal row carries the real result. A run that
 * dropped it would record an agent that called a tool and got nothing back,
 * which is not what occurred.
 *
 * This is not a redaction layer, and it is not trying to be one. For the
 * `'input'` phase the seed stage commits the transformed message, so the
 * model and the conversation never hold the original — but this row is NOT
 * its only copy: the run's input as passed (`run.entry` payload), a crash
 * checkpoint's `originalInput` and a paused
 * run's checkpoint (`RunnerPauseOutcome.checkpoint`, which `standingAgent`
 * stores for a paused session) keep it too — the full list, and what an app
 * must redact, is in `./README.md`, the one place it is maintained. An app
 * whose threat model says the original must not survive in the RECORD names
 * it in `Agent.create({ redact })`: `middlewareDecisions` (this state key —
 * every row's `before` / `after`; the `middleware.decision` events below carry
 * neither) is then the placeholder in every record. The checkpoints keep the real
 * values — a resume runs on them — so where the app stores a checkpoint, it
 * protects it.
 */

import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { MiddlewareDecision } from './types.js';

/** The scope surface this file needs. Structurally a `TypedScope<AgentState>`. */
export interface LedgerScope {
  middlewareDecisions?: readonly MiddlewareDecision[];
  $emit(name: string, payload?: unknown): void;
}

/**
 * Append decision rows to the run's ledger and emit one event per row.
 *
 * No-op on an empty list, so an agent with no middleware never writes the
 * key at all and its commit log is the one it always had.
 */
export function recordDecisions(
  scope: LedgerScope,
  rows: readonly MiddlewareDecision[],
  callOccurrenceKey?: CallOccurrenceKey,
): number | undefined {
  if (rows.length === 0) return undefined;
  const prev = (scope.middlewareDecisions as readonly MiddlewareDecision[] | undefined) ?? [];
  // Spread into a plain local array first: a TypedScope array read is a live
  // deep-proxy view, and both the commit and the event payloads below must be
  // detached plain data (RFC-001 'clone' capture under deferred delivery).
  const stamped =
    callOccurrenceKey === undefined
      ? rows
      : rows.map((row) => ({ ...row, ...callOccurrenceField(callOccurrenceKey) }));
  const updated = [...prev, ...stamped];
  scope.middlewareDecisions = updated;
  for (const row of stamped) {
    typedEmit(scope, 'agentfootprint.middleware.decision', {
      middleware: row.middleware,
      moment: row.moment,
      at: row.at,
      ...(row.phase !== undefined && { phase: row.phase }),
      ...(row.personApproved !== undefined && { personApproved: row.personApproved }),
      ...(row.toolName !== undefined && { toolName: row.toolName }),
      ...(row.toolCallId !== undefined && { toolCallId: row.toolCallId }),
      ...callOccurrenceField(row.callOccurrenceKey),
      iteration: row.iteration,
      outcome: row.outcome,
      changed: row.changed,
      ...(row.why !== undefined && { why: row.why }),
      ...(row.componentId !== undefined && { componentId: row.componentId }),
    });
  }
  return updated.length - 1;
}

/** Final delivery may attach private effect evidence to the already-recorded row. */
export function recordResultEffects(
  scope: LedgerScope,
  rowIndex: number,
  callOccurrenceKey: CallOccurrenceKey,
  resultEffects: NonNullable<MiddlewareDecision['resultEffects']>,
): void {
  const rows = scope.middlewareDecisions;
  const row = rows?.[rowIndex];
  if (
    !rows ||
    !row ||
    row.moment !== 'after-tool' ||
    row.resultEffects !== undefined ||
    readCallOccurrenceKey(row) !== readCallOccurrenceKey({ callOccurrenceKey })
  )
    return;
  const updated = [...rows];
  updated[rowIndex] = { ...row, resultEffects };
  scope.middlewareDecisions = updated;
}
