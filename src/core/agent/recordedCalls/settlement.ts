import { readOwnList } from '../../../lib/boundedJson.js';
import { readCallOccurrenceKey, type CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import type { PeriodVerdict } from '../../../semantics/coverage/period.js';
import { MAX_ENTERED_TOOL_CALLS } from '../honesty/enteredToolCalls.js';
import { isRecord } from './record.js';

/** The bounded, content-free result of settling one admitted call occurrence. */
export interface RecordedToolSettlement {
  readonly callOccurrenceKey: CallOccurrenceKey;
  readonly execution: 'not-entered' | 'threw' | 'returned' | 'returned-unserved';
  readonly delivery?: 'native' | 'rewritten' | 'withheld';
  readonly outcome?: 'refused' | 'failed' | 'settled';
  readonly reportedStatus?: 'partial' | 'pending';
  readonly empty?: 'declared-absent' | 'empty-undeclared';
  readonly gap?: true;
  readonly rewrittenPeriod?: PeriodVerdict;
}

const executions = new Set(['not-entered', 'threw', 'returned', 'returned-unserved']);
const deliveries = new Set(['native', 'rewritten', 'withheld']);
const outcomes = new Set(['refused', 'failed', 'settled']);
const statuses = new Set(['partial', 'pending']);
const emptyKinds = new Set(['declared-absent', 'empty-undeclared']);
const periods = new Set(['covered', 'partly-held', 'not-held', 'unknown']);
const optional = (set: ReadonlySet<string>, value: unknown) =>
  value === undefined || (typeof value === 'string' && set.has(value));

function settlementRow(value: unknown): RecordedToolSettlement | undefined {
  if (!isRecord(value)) return undefined;
  const key = readCallOccurrenceKey(value);
  if (typeof key !== 'string') return undefined;
  let unreadable = false;
  const field = (name: string) => {
    const slot = Object.getOwnPropertyDescriptor(value, name);
    if (slot !== undefined && !('value' in slot)) unreadable = true;
    return slot?.value as unknown;
  };
  const execution = field('execution') as RecordedToolSettlement['execution'];
  const delivery = field('delivery') as RecordedToolSettlement['delivery'];
  const outcome = field('outcome') as RecordedToolSettlement['outcome'];
  const reportedStatus = field('reportedStatus') as RecordedToolSettlement['reportedStatus'];
  const empty = field('empty') as RecordedToolSettlement['empty'];
  const gap = field('gap');
  const rewrittenPeriod = field('rewrittenPeriod') as RecordedToolSettlement['rewrittenPeriod'];
  if (unreadable || !executions.has(execution) || !optional(deliveries, delivery)) return undefined;
  const callOccurrenceKey = key.split('.').map(Number) as unknown as CallOccurrenceKey;
  if (delivery === 'withheld') {
    return execution === 'returned' || execution === 'returned-unserved'
      ? { callOccurrenceKey, execution, delivery }
      : undefined;
  }
  if (
    (delivery !== undefined && execution !== 'returned') ||
    !optional(outcomes, outcome) ||
    !optional(statuses, reportedStatus) ||
    !optional(emptyKinds, empty) ||
    (gap !== undefined && gap !== true) ||
    !optional(periods, rewrittenPeriod)
  )
    return undefined;
  return {
    callOccurrenceKey,
    execution,
    ...(delivery !== undefined && { delivery }),
    ...(outcome !== undefined && { outcome }),
    ...(reportedStatus !== undefined && { reportedStatus }),
    ...(empty !== undefined && { empty }),
    ...(gap === true && { gap }),
    ...(rewrittenPeriod !== undefined && { rewrittenPeriod }),
  };
}

/** Absence of both fields is the legacy record boundary. Ambiguous keys establish no fact. */
export function readToolSettlements(value: unknown, complete: unknown) {
  if (value === undefined && complete === undefined) return undefined;
  const list = readOwnList(value, MAX_ENTERED_TOOL_CALLS);
  const byKey = new Map<
    string,
    { readonly index: number; readonly fact: RecordedToolSettlement }
  >();
  const ambiguous = new Set<string>();
  let incomplete = complete !== true || list === undefined || list.unread > 0;
  for (const [index, item] of (list?.entries ?? []).entries()) {
    const fact = settlementRow(item);
    if (fact === undefined) {
      incomplete = true;
      continue;
    }
    const key = readCallOccurrenceKey(fact);
    if (typeof key !== 'string') continue;
    if (byKey.has(key)) {
      byKey.delete(key);
      ambiguous.add(key);
      incomplete = true;
    }
    if (!ambiguous.has(key)) byKey.set(key, { index, fact });
  }
  return { byKey, rows: [...byKey.values()].map(({ fact }) => fact), complete: !incomplete };
}
