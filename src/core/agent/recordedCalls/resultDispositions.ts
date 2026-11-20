import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import type { HistoryCall } from './history.js';
import { isRecord, str } from './record.js';

type Disposition = 'withheld' | 'rewritten';

function legacyAddress(id: string | undefined, name: string | undefined) {
  return id === undefined || name === undefined ? undefined : JSON.stringify([id, name]);
}

/** An after-tool decision can still prove what the hook served in an older recording. */
function decisionDispositions(decisions: unknown) {
  const keyed = new Map<string, Disposition>();
  const legacy = new Map<string, Disposition>();
  if (!Array.isArray(decisions)) return { keyed, legacy };
  for (const decision of decisions) {
    if (!isRecord(decision) || decision.moment !== 'after-tool' || decision.at !== 'tool') continue;
    if (decision.changed !== true) continue;
    const disposition =
      decision.outcome === 'deny' || decision.outcome === 'refused'
        ? 'withheld'
        : decision.outcome === 'allow'
        ? 'rewritten'
        : undefined;
    if (disposition === undefined) continue;
    const occurrence = readCallOccurrenceKey(decision);
    if (occurrence === null) continue;
    const address = occurrence ?? legacyAddress(str(decision.toolCallId), str(decision.toolName));
    const group = occurrence === undefined ? legacy : keyed;
    if (address !== undefined && group.get(address) !== 'withheld') group.set(address, disposition);
  }
  return { keyed, legacy };
}

export function resultDispositions(
  calls: readonly HistoryCall[],
  decisions: unknown,
): Map<number, Disposition> {
  const { keyed, legacy } = decisionDispositions(decisions);
  const stampedLegacy = new Set<string>();
  const dispositions = new Map<number, Disposition>();
  for (const { index, message, providerId, toolName, occurrenceKey } of calls) {
    const mark = message.toolResultDisposition;
    if (mark === 'withheld' || mark === 'rewritten') {
      dispositions.set(index, mark);
      const address = occurrenceKey === undefined ? legacyAddress(providerId, toolName) : undefined;
      if (address !== undefined) stampedLegacy.add(address);
    }
  }
  for (const { index, providerId, toolName, occurrenceKey } of calls) {
    if (dispositions.has(index) || occurrenceKey === null) continue;
    const address = occurrenceKey ?? legacyAddress(providerId, toolName);
    if (address === undefined) continue;
    // The key is the address when present. This specifically excludes the
    // legacy ID decision for a different execution of the same tool.
    const disposition =
      occurrenceKey !== undefined
        ? keyed.get(address)
        : stampedLegacy.has(address)
        ? undefined
        : legacy.get(address);
    if (disposition !== undefined) dispositions.set(index, disposition);
  }
  return dispositions;
}
