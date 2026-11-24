import { readOwnList } from '../../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../../lib/callOccurrence.js';
import { MAX_DISPLAY_NAME_CHARS, readDisplayName } from '../../../../lib/displayName.js';
import { isPlaceholder } from '../../../../redaction/marker.js';
import { MAX_ENTERED_TOOL_CALLS } from '../../honesty/enteredToolCalls.js';
import { readToolSettlements } from '../../recordedCalls.js';
import { fire, type Gathered } from '../gathered.js';
import { statePointer } from '../pointer.js';
import type { RetainedReasonState } from '../reasonDetails.js';
import { isRecord } from '../recordValues.js';

const MAX_GROUP_ID_CHARS = 128;
const MAX_UNUSED_TOOL_LABELS = 3;

const field = (row: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(row, key)?.value;
const isGroupId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= MAX_GROUP_ID_CHARS && !isPlaceholder(id);
const isCallableId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id >= 0;

function completeList(
  value: unknown,
  limit = MAX_ENTERED_TOOL_CALLS,
): readonly unknown[] | undefined {
  // Reject oversized nested arrays without repeatedly copying their bounded prefix.
  const length = Array.isArray(value) ? field(value, 'length') : undefined;
  if (typeof length !== 'number' || length > limit) return undefined;
  const list = readOwnList(value, limit);
  return list?.unread === 0 ? list.entries : undefined;
}

/** Group completeness is independent of the list of offered routes. */
function uncheckedGroups(
  entries: readonly unknown[],
  attempted: ReadonlySet<number>,
  nativeAbsence: (occurrence: string) => boolean,
): ReadonlyMap<string, ReadonlySet<number> | undefined> {
  const groups = new Map<string, ReadonlySet<number> | undefined>();
  let remainingCallables = MAX_ENTERED_TOOL_CALLS;
  let remainingOrigins = MAX_ENTERED_TOOL_CALLS;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = field(entry, 'group');
    if (!isGroupId(id)) continue;
    if (groups.has(id)) {
      groups.set(id, undefined);
      continue;
    }
    // Reserve even a rejected row's ID, so a later duplicate cannot supply proof.
    groups.set(id, undefined);
    const holders = completeList(field(entry, 'callables'), remainingCallables);
    if (holders === undefined) continue;
    remainingCallables -= holders.length;
    if (!holders.every(isCallableId) || holders.some((id) => attempted.has(id))) continue;
    const origins = Object.getOwnPropertyDescriptor(entry, 'origins');
    if (origins !== undefined) {
      const occurrences = completeList(origins.value, remainingOrigins);
      if (occurrences === undefined) continue;
      remainingOrigins -= occurrences.length;
      if (
        !occurrences.some((callOccurrenceKey) => {
          const key = readCallOccurrenceKey({ callOccurrenceKey });
          return typeof key === 'string' && nativeAbsence(key);
        })
      )
        continue;
    }
    groups.set(id, new Set(holders));
  }
  return groups;
}

/** Fold only positive, visible offer receipts for which the current turn recorded no attempt. */
export function readSourceConsultation(
  state: Readonly<Record<string, unknown>>,
  g: Gathered,
  retain: RetainedReasonState,
): readonly string[] {
  // The optional key's absence or withholding leaves this check silent without
  // recording an unavailable input for the rest of the assessment.
  const raw = field(state, 'sourceConsultation');
  if (raw === undefined || isPlaceholder(raw)) return [];
  const receipts = retain('sourceConsultation', raw);
  if (!isRecord(receipts) || field(receipts, 'complete') !== true) return [];
  const offers = completeList(field(receipts, 'offers'));
  const attempted = completeList(field(receipts, 'attempted'));
  const groups = completeList(field(receipts, 'groups'));
  if (
    !offers?.length ||
    attempted === undefined ||
    !attempted.every(isCallableId) ||
    !groups?.length
  )
    return [];
  let settlements: ReturnType<typeof readToolSettlements> | null = null;
  const unchecked = uncheckedGroups(groups, new Set(attempted), (occurrence) => {
    if (settlements === null) {
      const rawSettlements = field(state, 'settledToolCalls');
      settlements =
        rawSettlements === undefined
          ? undefined
          : readToolSettlements(
              retain('settledToolCalls', rawSettlements),
              field(state, 'settledToolCallsComplete'),
            );
    }
    const fact = settlements?.byKey.get(occurrence)?.fact;
    return (
      fact?.execution === 'returned' &&
      fact.delivery === 'native' &&
      fact.empty === 'declared-absent'
    );
  });
  const witnessed = new Map<string, Set<number>>();
  const names = new Set<string>();
  for (const [index, offer] of offers.entries()) {
    if (!isRecord(offer)) continue;
    const group = field(offer, 'group');
    const callable = field(offer, 'callable');
    if (!isGroupId(group) || !isCallableId(callable) || !unchecked.get(group)?.has(callable))
      continue;
    const nameSlot = Object.getOwnPropertyDescriptor(offer, 'name');
    const name: unknown = nameSlot?.value;
    if (
      nameSlot !== undefined &&
      (typeof name !== 'string' ||
        name.length > MAX_DISPLAY_NAME_CHARS ||
        isPlaceholder(name) ||
        readDisplayName(name) !== name)
    )
      continue;
    const callables = witnessed.get(group) ?? new Set<number>();
    if (callables.has(callable)) continue;
    if (
      !fire(
        g,
        'source-not-consulted',
        statePointer('sourceConsultation', 'offers', index, 'callable'),
      )
    )
      continue;
    callables.add(callable);
    witnessed.set(group, callables);
    if (typeof name === 'string') names.add(name);
  }
  return [...names].sort().slice(0, MAX_UNUSED_TOOL_LABELS);
}

/** Only app-declared display names may appear in the standing line. */
export function sourceConsultationClause(names: readonly string[]): string {
  return names.length > 0
    ? `the run left declared ground unchecked after it was offered ${names.join(', ')}`
    : 'the run left a declared source unchecked';
}
