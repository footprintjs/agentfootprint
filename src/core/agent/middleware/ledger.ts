/**
 * middleware/ledger — INTERNAL. Where a chain's decisions become record.
 *
 * Pattern: one writer for one committed key.
 * Role:    core/ layer. `runChain` decides; this file is the only thing
 *          that commits what it decided and emits the matching event, so
 *          the three call sites cannot record the same fact three
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
 * This is not a redaction layer, and it is not trying to be one. For the
 * `'input'` phase in particular, the ledger row is the ONLY copy of the
 * pre-scrub text anywhere in the run — the seed stage commits the
 * transformed message and nothing else ever holds the original. If your
 * threat model says the original must not survive in the commit log,
 * configure footprintjs redaction over this key; it scrubs `before` /
 * `after` at write time and the row itself survives, so the run still says
 * a scrub happened and who did it.
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
export function recordDecisions(scope: LedgerScope, rows: readonly MiddlewareDecision[]): void {
  if (rows.length === 0) return;
  const prev = (scope.middlewareDecisions as readonly MiddlewareDecision[] | undefined) ?? [];
  // Spread into a plain local array first: a TypedScope array read is a live
  // deep-proxy view, and both the commit and the event payloads below must be
  // detached plain data (RFC-001 'clone' capture under deferred delivery).
  scope.middlewareDecisions = [...prev, ...rows];
  for (const row of rows) {
    typedEmit(scope, 'agentfootprint.middleware.decision', {
      middleware: row.middleware,
      at: row.at,
      ...(row.phase !== undefined && { phase: row.phase }),
      ...(row.toolName !== undefined && { toolName: row.toolName }),
      ...(row.toolCallId !== undefined && { toolCallId: row.toolCallId }),
      iteration: row.iteration,
      outcome: row.outcome,
      changed: row.changed,
      ...(row.why !== undefined && { why: row.why }),
    });
  }
}
