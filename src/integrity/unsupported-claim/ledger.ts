/**
 * The claim ledger — the typed facts a run actually settled, flattened out
 * of the semantic envelopes its tools declared.
 *
 * Pattern: pure extractor over one recognized envelope (the
 *          `readCoverageResult` precedent — the envelope is absorbed into
 *          one funnel rather than re-read by every consumer).
 * Role:    the ledger side of the claim seam. Before this, a recognized
 *          envelope was emitted whole on `tools.semantics_declared` and
 *          then REPLACED by its compact model projection — the typed
 *          object existed nowhere in run state, so an answer-time check
 *          had nothing to compare against but re-parsed wire strings.
 *          `coverageDeclared` is the shape this follows: a tracked key,
 *          written only when a tool actually declared something.
 *
 * WHAT BECOMES A ROW. Two of the envelope's three shapes carry
 * entity-keyed readings, and both flatten the same way:
 * - `facts`: every column other than `entity` is one (entity, field, value).
 * - `series`: each point is one (entity, metric, value), carrying the
 *   point's own clock word as `measuredAt` when the envelope stated none —
 *   a series value's own `t` is more precise than the envelope's.
 * `edges` are relationships, not readings, and are deliberately left out:
 * a claim about a relationship needs its own predicate vocabulary, and
 * inventing one here would be exactly the inference this family bans.
 *
 * ORDER IS THE LEDGER. Rows append in declaration order and are never
 * rewritten, so "the latest row for a fact" is the settled value and
 * everything before it is quotable history — the check reads it that way.
 */

import type { ToolSemantics } from '../../lib/semantics/types.js';
import type { ClaimLedgerRow } from './check.js';

/** Which call produced these rows — the provenance a witness quotes. */
export interface ClaimSource {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
}

/**
 * Flatten one recognized envelope into ledger rows. Returns `[]` for an
 * envelope carrying no entity-keyed readings (a `clarify`-only envelope
 * declares a question, not a fact).
 */
export function claimRowsOf(
  semantics: ToolSemantics,
  source: ClaimSource,
): readonly ClaimLedgerRow[] {
  const rows: ClaimLedgerRow[] = [];
  const measuredAt = semantics.provenance?.measured_at;
  const stamp = (over: Partial<ClaimLedgerRow>): ClaimLedgerRow =>
    ({
      toolName: source.toolName,
      toolCallId: source.toolCallId,
      iteration: source.iteration,
      ...(measuredAt !== undefined && { measuredAt }),
      ...over,
    }) as ClaimLedgerRow;

  for (const fact of semantics.facts ?? []) {
    for (const [field, value] of Object.entries(fact)) {
      if (field === 'entity') continue;
      rows.push(stamp({ entity: fact.entity, field, value }));
    }
  }
  for (const point of semantics.series ?? []) {
    rows.push(
      stamp({
        entity: point.entity,
        field: point.metric,
        value: point.value,
        // The point's own clock beats the envelope's, when it has one.
        ...(point.t !== undefined && { measuredAt: point.t }),
      }),
    );
  }
  return rows;
}
