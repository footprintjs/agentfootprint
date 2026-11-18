/** Fold — existing current native inputs for the declared-source corpus. */
import type { FindingsRow } from '../findings/types.js';
import type { SourceInputs } from '../arguments/subflow.js';

/**
 * The raw pieces the declared-sources corpora are built from — read off the
 * parent's committed state by the input mapping, only under the arm and only
 * for a batch with calls. Never the whole ledger: its standing rows (the
 * model's current reading of each result) and its `answered` argument rows
 * (the person's earlier answers).
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
  };
}
