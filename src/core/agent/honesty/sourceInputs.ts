/**
 * honesty/sourceInputs — what the inputs layer's declared-sources checks are
 * HANDED from the parent scope (`mounts.ts` · `mountInputsLayer`, the input
 * mapping), as raw pieces; the corpora are built from them inside the layer
 * (`sourceCorpus.ts` · `sourceCorpusOf`).
 *
 * @example
 * ```ts
 * const inputs = sourceInputsOf(parent); // { history, ledger?, placedTickets?, … }
 * ```
 */

import type { SourceInputs } from '../arguments/subflow.js';
import type { FindingsRow } from '../findings/types.js';

/**
 * The raw pieces the declared-sources corpora are built from — read off the
 * parent's committed state by the input mapping, only under the arm and only
 * for a batch with calls. Never the whole ledger: its standing rows (the
 * model's current reading of each result) and its `answered` argument rows
 * (the person's earlier answers). And the receipt of the tickets the library
 * placed (`placedTickets`), because only a ticket the library placed may fail
 * a claim as `placed-result` (`sourceCorpus.ts` · `placedByLibrary`); without
 * it every ticket reads as an ordinary result.
 */
export function sourceInputsOf(parent: Record<string, unknown>): SourceInputs {
  const ledger = ((parent.findingsLedger as readonly FindingsRow[] | undefined) ?? []).filter(
    (row) => row.kind === 'standing' || (row.kind === 'argument' && row.source === 'answered'),
  );
  const injections = (parent.systemPromptInjections as readonly unknown[] | undefined) ?? [];
  const previous = ((parent.toolResults as readonly Record<string, unknown>[] | undefined) ?? [])
    .filter((r) => typeof r?.toolCallId === 'string')
    .map((r) => ({
      toolCallId: r.toolCallId as string,
      ...(typeof r.toolName === 'string' && { toolName: r.toolName }),
    }));
  return {
    history: [...((parent.history as readonly unknown[] | undefined) ?? [])],
    ...(injections.length > 0 && { systemPromptInjections: [...injections] }),
    ...(ledger.length > 0 && { ledger }),
    ...(previous.length > 0 && { previousBatch: previous }),
    ...(parent.userMessageFrom === 'composed' && { composed: true as const }),
    ...(Array.isArray(parent.placedTickets) && { placedTickets: [...parent.placedTickets] }),
  };
}
