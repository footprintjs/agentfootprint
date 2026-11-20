/**
 * core/agent/llmCallReads — the run records CallLLM reads, READ-ONLY, inside
 * the grouped chart's `sf-llm-call` boundary (`buildDynamicAgentChart.ts`).
 *
 * In the grouped chart CallLLM lives INSIDE that boundary, while each of these
 * keys is written OUTSIDE it (by tool-calls, the Route decider or the window).
 * A key that does not cross is silently empty inside: the same agent, with the
 * same declarations, served less because of a chart shape it did not choose.
 * All three are value-conditional (an agent that never wrote one crosses no
 * new key) and read-only inside (the writes are outside), so no outputMapper
 * line is needed.
 *
 * - `compactions` (9.60.0): the window ledger. CallLLM's dangling-reference
 *   check reads which grounds left the window; without it the check sees an
 *   empty ledger every pass and reports a healthy run, which is worse than not
 *   running it at all.
 * - `findingsLedger` (9.101.0, step 3): CallLLM composes the ledger piece and
 *   the wire-only collapse from it; without it the piece is empty and nothing
 *   collapses.
 * - `placedTickets`: the receipt of the tickets the library placed
 *   (`placedTickets.ts`); without it the staged-refs nudge names no ticket.
 *
 * @example
 * ```ts
 * inputMapper: (parent) => ({ ...llmCallReadsInto(parent), iteration: parent.iteration });
 * ```
 */

/** The three keys, in this order, each only when the parent holds it. */
export function llmCallReadsInto(p: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    ...(p.compactions !== undefined && { compactions: p.compactions }),
    ...(p.findingsLedger !== undefined && { findingsLedger: p.findingsLedger }),
    ...(p.placedTickets !== undefined && { placedTickets: p.placedTickets }),
  };
}
