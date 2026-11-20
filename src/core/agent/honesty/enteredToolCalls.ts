import type { TypedScope } from 'footprintjs';
import { readOwnList } from '../../../lib/boundedJson.js';
import {
  readCallOccurrenceKey,
  storedCallOccurrenceField,
  type CallOccurrenceKey,
} from '../../../lib/callOccurrence.js';
import type { AgentState } from '../types.js';
import type { HonestyLayers } from './armed.js';

/** The most entered calls a turn can retain, independent of its history window. */
export const MAX_ENTERED_TOOL_CALLS = 1024;

export interface EnteredToolCall {
  readonly callOccurrenceKey: CallOccurrenceKey;
  readonly entered: true;
}

export interface ToolEntryProof {
  readonly rows: readonly EnteredToolCall[];
  readonly complete: boolean;
}

export function enteredToolCallKey(row: unknown): string | undefined {
  if (
    typeof row !== 'object' ||
    row === null ||
    Array.isArray(row) ||
    Object.getOwnPropertyDescriptor(row, 'entered')?.value !== true
  )
    return undefined;
  return readCallOccurrenceKey(row) ?? undefined;
}

/** Detach one valid content-free row from stored data. */
export function copyEnteredToolCall(row: unknown): EnteredToolCall | undefined {
  if (enteredToolCallKey(row) === undefined) return undefined;
  const { callOccurrenceKey } = storedCallOccurrenceField(row as object);
  return callOccurrenceKey === undefined ? undefined : { callOccurrenceKey, entered: true };
}

/** Start in this Agent's own state. A native pause preserves it without reseeding. */
export function seedEnteredToolCalls(
  scope: TypedScope<AgentState>,
  deps: { readonly honestyLayers?: HonestyLayers; readonly findings?: boolean },
  continuingTurn: boolean,
  prior?: ToolEntryProof,
): void {
  if (deps.honestyLayers?.inputs || deps.honestyLayers?.answer || deps.findings === true) {
    scope.enteredToolCalls = prior?.rows ?? [];
    scope.enteredToolCallsComplete = prior?.complete ?? !continuingTurn;
  }
}

/** Upgrade a native checkpoint that still packages the list with its completeness bit. */
function migrateEntryProof(
  scope: TypedScope<AgentState>,
  prior: unknown,
): readonly EnteredToolCall[] {
  const old = typeof prior === 'object' && prior !== null ? prior : {};
  const oldEntries = Object.getOwnPropertyDescriptor(old, 'entries')?.value;
  const list = readOwnList(oldEntries, MAX_ENTERED_TOOL_CALLS);
  const entries: EnteredToolCall[] = [];
  for (const row of list?.entries ?? []) {
    const entry = copyEnteredToolCall(row);
    if (entry !== undefined) entries.push(entry);
  }
  scope.enteredToolCalls = entries;
  scope.enteredToolCallsComplete =
    list !== undefined &&
    list.unread === 0 &&
    entries.length === list.entries.length &&
    Object.getOwnPropertyDescriptor(old, 'complete')?.value === true;
  return entries;
}

/** Called at the native execute boundary, after all admission gates. */
export function recordToolEntry(
  scope: TypedScope<AgentState>,
  key: CallOccurrenceKey | undefined,
): void {
  if (!('enteredToolCalls' in scope)) return;
  const prior: unknown = scope.$getValue('enteredToolCalls');
  if (prior === undefined) return;
  const entries: readonly EnteredToolCall[] = Array.isArray(prior)
    ? prior
    : migrateEntryProof(scope, prior);
  const address = readCallOccurrenceKey({ callOccurrenceKey: key });
  if (typeof address === 'string' && entries.some((entry) => enteredToolCallKey(entry) === address))
    return;
  if (
    key === undefined ||
    typeof address !== 'string' ||
    entries.length >= MAX_ENTERED_TOOL_CALLS
  ) {
    if (scope.$getValue('enteredToolCallsComplete') === true)
      scope.enteredToolCallsComplete = false;
    return;
  }
  // Assign the list alone so the commit log can record only the appended row.
  scope.enteredToolCalls = [
    ...entries,
    { callOccurrenceKey: Object.freeze([...key] as const), entered: true },
  ];
}
