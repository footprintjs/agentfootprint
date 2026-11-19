import { readCoverageResult } from '../../../semantics/coverage/read.js';
import { periodVerdict, leastHeld } from '../../../semantics/coverage/period.js';
import { readToolResultEnvelope } from '../../../semantics/toolEffects.js';
import { callOutcomeOf } from '../../../semantics/toolOutcome.js';
import { parseMaybeJson } from '../emptiness.js';
import type { HistoryCall } from '../recordedCalls.js';
import { isRecord, str } from './recordValues.js';
import type { TurnResult } from './turnResults.js';

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
): ReadonlyMap<number, Disposition> {
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

/** Native rows without a unique address are usable only when no possible owner rewrote them. */
export function nativeFactsOf(
  calls: readonly HistoryCall[],
  dispositions: ReadonlyMap<number, Disposition>,
): (row: Readonly<Record<string, unknown>>, address?: number) => boolean {
  const affected = calls.filter((call) => dispositions.has(call.index));
  return (row, address) => {
    if (address !== undefined) return !dispositions.has(address);
    return !affected.some(
      (call) =>
        call.providerId === row.toolCallId &&
        (row.toolName === undefined ||
          call.toolName === undefined ||
          row.toolName === call.toolName),
    );
  };
}

/** Read a rewrite's declarations from its served bytes, without reading the native rows. */
export function rewrittenResult(result: TurnResult): {
  readonly result: TurnResult;
  readonly period: ReturnType<typeof leastHeld>;
} {
  const envelope = readToolResultEnvelope(parseMaybeJson(result.content));
  const content = envelope === undefined ? result.content : envelope.content;
  const coverage = readCoverageResult(parseMaybeJson(content));
  const periods = coverage?.declared.flatMap(({ period }) =>
    period === undefined ? [] : [periodVerdict(period)],
  );
  const status = envelope?.status;
  const outcome = callOutcomeOf({ ran: true, clean: true, status });
  const reportedStatus = status === 'partial' || status === 'pending' ? status : undefined;
  return {
    result: {
      index: result.index,
      rewritten: true,
      ...(result.toolCallId !== undefined && { toolCallId: result.toolCallId }),
      ...(result.toolName !== undefined && { toolName: result.toolName }),
      content,
      ...(outcome !== undefined && { outcome }),
      ...(reportedStatus !== undefined && { reportedStatus }),
    },
    period: periods === undefined ? undefined : leastHeld(periods),
  };
}
