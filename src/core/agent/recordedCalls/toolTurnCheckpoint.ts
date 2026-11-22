import { readOwnList } from '../../../lib/boundedJson.js';
import {
  copyEnteredToolCall,
  MAX_ENTERED_TOOL_CALLS,
  type EnteredToolCall,
  type ToolEntryProof,
} from '../honesty/enteredToolCalls.js';
import { isRecord } from './record.js';
import { readToolSettlements, type RecordedToolSettlement } from './settlement.js';
import { readWindowResultDrops, type WindowResultDrop } from './windowResultDrops.js';

/** Content-free proof kept only for a retry of the failed human request. */
export interface ToolTurnEvidence {
  readonly entries?: ToolEntryProof;
  readonly settlements?: {
    readonly rows: readonly RecordedToolSettlement[];
    readonly complete: boolean;
  };
  readonly windowResultDrops?: readonly WindowResultDrop[];
}

const own = (object: object, field: string): unknown =>
  Object.getOwnPropertyDescriptor(object, field)?.value;

function entriesOf(value: unknown, complete: unknown): ToolTurnEvidence['entries'] {
  if (typeof complete !== 'boolean') return undefined;
  const list = readOwnList(value, MAX_ENTERED_TOOL_CALLS);
  if (list === undefined || list.unread !== 0) return undefined;
  const rows: EnteredToolCall[] = [];
  for (const item of list.entries) {
    const row = copyEnteredToolCall(item);
    if (row === undefined) return undefined;
    rows.push(row);
  }
  return { rows, complete };
}

function settlementsOf(value: unknown, complete: unknown): ToolTurnEvidence['settlements'] {
  if (typeof complete !== 'boolean') return undefined;
  const list = readOwnList(value, MAX_ENTERED_TOOL_CALLS);
  if (list === undefined || list.unread !== 0) return undefined;
  const result = readToolSettlements(value, complete);
  if (
    result === undefined ||
    result.rows.length !== list.entries.length ||
    result.complete !== complete
  )
    return undefined;
  return { rows: result.rows, complete };
}

function windowDropsOf(value: unknown): ToolTurnEvidence['windowResultDrops'] {
  const drops = readWindowResultDrops(value);
  return drops?.complete ? [...drops.byKey.values()].map(({ fact }) => fact) : undefined;
}

/** Take a detached, bounded copy from the failing executor's committed state. */
export function toolTurnEvidenceFrom(state: unknown): ToolTurnEvidence | undefined {
  if (!isRecord(state)) return undefined;
  const entered = own(state, 'enteredToolCalls');
  const entries = isRecord(entered)
    ? entriesOf(own(entered, 'entries'), own(entered, 'complete'))
    : entriesOf(entered, own(state, 'enteredToolCallsComplete'));
  const settlements = settlementsOf(
    own(state, 'settledToolCalls'),
    own(state, 'settledToolCallsComplete'),
  );
  const windowResultDrops = windowDropsOf(own(state, 'windowResultDrops'));
  if (entries === undefined && settlements === undefined && windowResultDrops === undefined)
    return undefined;
  return {
    ...(entries && { entries }),
    ...(settlements && { settlements }),
    ...(windowResultDrops && { windowResultDrops }),
  };
}

/** Admit and detach present request proof before a fresh runtime can use it. */
export function admitToolTurnEvidence(checkpoint: object): ToolTurnEvidence | undefined {
  const invalid = (): never => {
    throw new TypeError('[resumeOnError] checkpoint toolTurnEvidence is malformed.');
  };
  const field = Object.getOwnPropertyDescriptor(checkpoint, 'toolTurnEvidence');
  if (field === undefined) {
    if ('toolTurnEvidence' in checkpoint) return invalid();
    return undefined;
  }
  if (!field.enumerable || !('value' in field) || !isRecord(field.value)) return invalid();
  const evidence = field.value;
  const entry = own(evidence, 'entries');
  const settlement = own(evidence, 'settlements');
  const entries = isRecord(entry)
    ? entriesOf(own(entry, 'rows'), own(entry, 'complete'))
    : undefined;
  const settlements = isRecord(settlement)
    ? settlementsOf(own(settlement, 'rows'), own(settlement, 'complete'))
    : undefined;
  const windowResultDrops = windowDropsOf(own(evidence, 'windowResultDrops'));
  if (
    (entries === undefined && settlements === undefined && windowResultDrops === undefined) ||
    ('windowResultDrops' in evidence && windowResultDrops === undefined) ||
    ('entries' in evidence && entries === undefined) ||
    ('settlements' in evidence && settlements === undefined)
  )
    return invalid();
  return {
    ...(entries && { entries }),
    ...(settlements && { settlements }),
    ...(windowResultDrops && { windowResultDrops }),
  };
}
