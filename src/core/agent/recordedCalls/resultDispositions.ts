import type { HistoryCall } from './history.js';
import { isRecord, str } from './record.js';

type Disposition = 'withheld' | 'rewritten';

/** On old recordings the after-tool decision can still prove what policy served. */
function legacyDispositions(
  decisions: unknown,
): ReadonlyMap<string, ReadonlyMap<string, Disposition>> {
  const byId = new Map<string, Map<string, Disposition>>();
  if (!Array.isArray(decisions)) return byId;
  for (const decision of decisions) {
    if (!isRecord(decision) || decision.moment !== 'after-tool' || decision.at !== 'tool') continue;
    if (decision.changed !== true) continue;
    const id = str(decision.toolCallId);
    const name = str(decision.toolName);
    if (id === undefined || name === undefined) continue;
    const disposition =
      decision.outcome === 'deny' || decision.outcome === 'refused'
        ? 'withheld'
        : decision.outcome === 'allow'
        ? 'rewritten'
        : undefined;
    if (disposition === undefined) continue;
    const byName = byId.get(id) ?? new Map<string, Disposition>();
    if (byName.get(name) !== 'withheld') byName.set(name, disposition);
    byId.set(id, byName);
  }
  return byId;
}

export function resultDispositions(
  calls: readonly HistoryCall[],
  decisions: unknown,
): Map<number, Disposition> {
  const legacy = legacyDispositions(decisions);
  const stamped = new Set<string>();
  const dispositions = new Map<number, Disposition>();
  for (const { index, message, providerId, toolName } of calls) {
    const mark = message.toolResultDisposition;
    if (mark === 'withheld' || mark === 'rewritten') {
      dispositions.set(index, mark);
      if (providerId !== undefined && toolName !== undefined) {
        stamped.add(JSON.stringify([providerId, toolName]));
      }
    }
  }
  for (const { index, providerId, toolName } of calls) {
    if (providerId === undefined || toolName === undefined) continue;
    // A new mark binds policy to its occurrence. Applying legacy decisions
    // across another occurrence with the same provider ID would hide it too.
    if (stamped.has(JSON.stringify([providerId, toolName]))) continue;
    const disposition = legacy.get(providerId)?.get(toolName);
    if (disposition !== undefined) dispositions.set(index, disposition);
  }
  return dispositions;
}
