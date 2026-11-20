import {
  readRecordedResultDecision,
  readResultDispositionMark,
} from '../../core/agent/recordedCalls/resultDispositions.js';
import { copyJson, readOwnList } from '../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../lib/callOccurrence.js';
import { toolBytesOf } from '../../lib/toolBytes.js';
import { TRACE_WITHHELD } from './marker.js';

const MAX_HISTORY_MESSAGES = 4096;
const MAX_RESULT_DECISIONS = 4096;
const MAX_PROPOSED_CALLS = 1024;
const MAX_ARGUMENT_BYTES = 64 * 1024;

type RecordRow = Readonly<Record<string, unknown>>;
type ResultDecision = NonNullable<ReturnType<typeof readRecordedResultDecision>>;

function record(value: unknown): RecordRow | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as RecordRow) : undefined;
}

function field(row: RecordRow, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

function text(row: RecordRow, key: string): string | undefined {
  const value = field(row, key);
  return typeof value === 'string' ? value : undefined;
}

function legacyAddress(row: RecordRow): string | undefined {
  const id = text(row, 'toolCallId');
  const name = text(row, 'toolName');
  return id === undefined || name === undefined ? undefined : JSON.stringify([id, name]);
}

function addressOf(row: RecordRow) {
  const key = readCallOccurrenceKey(row);
  return {
    key,
    address: typeof key === 'string' ? key : key === undefined ? legacyAddress(row) : undefined,
  };
}

function mergeDecision(
  previous: ResultDecision | undefined,
  current: ResultDecision,
  legacy: boolean,
): ResultDecision {
  if (previous === 'withheld' || current === 'withheld') return 'withheld';
  // Two legacy rows may be links in the same chain or decisions for reused IDs.
  if ((legacy && previous !== undefined) || previous === 'unknown' || current === 'unknown')
    return 'unknown';
  return previous === 'rewritten' || current === 'rewritten' ? 'rewritten' : 'unchanged';
}

function decisionIndex(value: unknown): ReadonlyMap<string, ResultDecision> | undefined {
  const result = new Map<string, ResultDecision>();
  if (value === undefined) return result;
  const rows = readOwnList(value, MAX_RESULT_DECISIONS);
  if (rows === undefined || rows.unread > 0) return undefined;
  for (const entry of rows.entries) {
    const decision = readRecordedResultDecision(entry);
    if (decision === undefined) continue;
    const row = record(entry);
    if (row === undefined) return undefined;
    const { key, address } = addressOf(row);
    if (address === undefined) return undefined;
    result.set(address, mergeDecision(result.get(address), decision, key === undefined));
  }
  return result;
}

/** Framework result metadata and notes are excluded even when result text was admitted. */
function resultText(row: RecordRow, decision: ResultDecision | undefined): string {
  const mark = readResultDispositionMark(row);
  if (
    decision === 'withheld' ||
    decision === 'unknown' ||
    mark === 'withheld' ||
    mark === 'unknown' ||
    (mark === 'rewritten' && decision === 'unchanged') ||
    (mark === undefined && decision === undefined)
  )
    return TRACE_WITHHELD;

  const content = text(row, 'content');
  const cut = Object.getOwnPropertyDescriptor(row, 'toolChars');
  if (content === undefined) return TRACE_WITHHELD;
  if (
    cut !== undefined &&
    (typeof cut.value !== 'number' ||
      !Number.isSafeInteger(cut.value) ||
      cut.value < 0 ||
      cut.value > content.length)
  )
    return TRACE_WITHHELD;
  return toolBytesOf({ content, toolChars: cut?.value });
}

function projectProposedCall(value: unknown): unknown {
  const row = record(value);
  if (row === undefined) return TRACE_WITHHELD;
  const id = text(row, 'id');
  const name = text(row, 'name');
  if (id === undefined || name === undefined) return TRACE_WITHHELD;
  const key = readCallOccurrenceKey(row);
  const projected = {
    id,
    name,
    ...(typeof key === 'string' && { callOccurrenceKey: key.split('.').map(Number) }),
  };
  const args = field(row, 'args');
  if (record(args) === undefined) return projected;
  try {
    return { ...projected, args: copyJson(args, MAX_ARGUMENT_BYTES, false) };
  } catch {
    return projected;
  }
}

function projectToolResult(
  row: RecordRow,
  addresses: ReadonlyMap<string, number>,
  decisions: ReadonlyMap<string, ResultDecision> | undefined,
) {
  const toolCallId = text(row, 'toolCallId');
  const toolName = text(row, 'toolName');
  const { key, address } = addressOf(row);
  const unique = address !== undefined && addresses.get(address) === 1;
  return {
    role: 'tool',
    content:
      unique && decisions !== undefined ? resultText(row, decisions.get(address)) : TRACE_WITHHELD,
    ...(toolCallId !== undefined && { toolCallId }),
    ...(toolName !== undefined && { toolName }),
    ...(typeof key === 'string' && { callOccurrenceKey: key.split('.').map(Number) }),
  };
}

/** Prepare once per admitted trace binding. The private ledger is reduced to result decisions. */
export function traceHistoryProjector(decisions?: unknown): (value: unknown) => unknown {
  let index: ReadonlyMap<string, ResultDecision> | undefined;
  try {
    index = decisionIndex(decisions);
  } catch {
    index = undefined;
  }
  return (value) => {
    try {
      const list = readOwnList(value, MAX_HISTORY_MESSAGES);
      if (list === undefined || list.unread > 0) return TRACE_WITHHELD;
      const rows = list.entries.map(record);
      const addresses = new Map<string, number>();
      for (const row of rows) {
        if (row === undefined || text(row, 'role') !== 'tool') continue;
        const { address } = addressOf(row);
        if (address !== undefined) addresses.set(address, (addresses.get(address) ?? 0) + 1);
      }
      let proposalsLeft = MAX_PROPOSED_CALLS;
      return rows.map((row) => {
        if (row === undefined) return TRACE_WITHHELD;
        const role = text(row, 'role');
        if (role === 'tool') return projectToolResult(row, addresses, index);
        if (role !== 'system' && role !== 'user' && role !== 'assistant') return TRACE_WITHHELD;
        const content = text(row, 'content') ?? TRACE_WITHHELD;
        if (role !== 'assistant') return { role, content };
        const calls = readOwnList(field(row, 'toolCalls'), proposalsLeft);
        if (calls === undefined || calls.unread > 0) return { role, content };
        proposalsLeft -= calls.entries.length;
        return { role, content, toolCalls: calls.entries.map(projectProposedCall) };
      });
    } catch {
      return TRACE_WITHHELD;
    }
  };
}

export function projectTraceHistory(value: unknown, decisions?: unknown): unknown {
  return traceHistoryProjector(decisions)(value);
}
