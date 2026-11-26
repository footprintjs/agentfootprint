import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { LOOP_MOMENTS } from '../../../lib/moments.js';
import type { HistoryCall } from './history.js';
import { isRecord, str } from './record.js';

type Disposition = 'withheld' | 'rewritten';

const recordedMoments: ReadonlySet<unknown> = new Set(LOOP_MOMENTS);

function dataField(row: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

/** Read only decision metadata. A historic result's address may no longer
 * be in retained history, but that does not clear its recorded decision. */
export function readRecordedResultDecision(
  row: unknown,
): Disposition | 'unchanged' | 'unknown' | undefined {
  if (!isRecord(row)) return 'unknown';
  const moment = dataField(row, 'moment');
  if (moment !== 'after-tool') {
    return recordedMoments.has(moment) ? undefined : 'unknown';
  }
  if (dataField(row, 'at') !== 'tool') return 'unknown';
  const changed = dataField(row, 'changed');
  const outcome = dataField(row, 'outcome');
  if (outcome === 'allow') {
    if (changed === true) return 'rewritten';
    if (changed === false) return 'unchanged';
  }
  return changed === true && (outcome === 'deny' || outcome === 'refused') ? 'withheld' : 'unknown';
}

/** After occurrence/decision admission, read its own nonblank name once, without a getter. */
export function readResultRewriteName(row: unknown): string | undefined {
  if (!isRecord(row)) return undefined;
  const name = dataField(row, 'middleware');
  return typeof name === 'string' && name.trim().length > 0 ? name : undefined;
}

export function readResultDispositionMark(message: object): Disposition | 'unknown' | undefined {
  const field = Object.getOwnPropertyDescriptor(message, 'toolResultDisposition');
  if (field === undefined) return undefined;
  const mark: unknown = field.value;
  return mark === 'withheld' || mark === 'rewritten' ? mark : 'unknown';
}

function legacyAddress(id: string | undefined, name: string | undefined) {
  return id === undefined || name === undefined ? undefined : JSON.stringify([id, name]);
}

/** An after-tool decision can still prove what the hook served in an older recording. */
function decisionDispositions(decisions: unknown) {
  const keyed = new Map<string, Disposition>();
  const legacy = new Map<string, Disposition>();
  if (!Array.isArray(decisions)) return { keyed, legacy };
  for (const decision of decisions) {
    if (!isRecord(decision)) continue;
    const disposition = readRecordedResultDecision(decision);
    if (disposition !== 'withheld' && disposition !== 'rewritten') continue;
    const occurrence = readCallOccurrenceKey(decision);
    if (occurrence === null) continue;
    const address =
      occurrence ??
      legacyAddress(str(dataField(decision, 'toolCallId')), str(dataField(decision, 'toolName')));
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
    const mark = readResultDispositionMark(message);
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
