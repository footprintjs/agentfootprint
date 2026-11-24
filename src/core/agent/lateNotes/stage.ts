import type { TypedScope } from 'footprintjs';
import { readDisplayName } from '../../../lib/displayName.js';
import { retainedStateValue } from '../../../redaction/runRedaction.js';
import { MAX_ENTERED_TOOL_CALLS } from '../honesty/enteredToolCalls.js';
import type { ToolRegistrations } from '../stages/toolResolver.js';
import type { AgentState } from '../types.js';
import { gatherLateNotePoints } from './gather/gather.js';

const LATE_NOTE_READS = [
  'turnNumber',
  'coverageDeclared',
  'libraryResultLimits',
  'libraryResultLimitsIncomplete',
  'settledToolCalls',
  'settledToolCallsComplete',
] as const;

/** The grouped call reads the same recorded facts as the flat call. */
export function lateNoteReadsInto(state: Readonly<Record<string, unknown>>) {
  const read: Record<string, unknown> = {};
  for (const key of LATE_NOTE_READS) if (state[key] !== undefined) read[key] = state[key];
  return read;
}

/** Compose only evidence that the owning native redaction rule is prepared to serve. */
export function readLateRecordPoints(
  scope: TypedScope<AgentState>,
  registrations: ToolRegistrations | undefined,
) {
  const history: unknown = scope.$getValue('history');
  const record: Record<string, unknown> = {};
  if (Array.isArray(history) && history.length <= MAX_ENTERED_TOOL_CALLS)
    record.history = retainedStateValue(scope, 'history', history);
  for (const key of LATE_NOTE_READS) {
    if (key in scope) record[key] = retainedStateValue(scope, key, scope.$getValue(key));
  }
  const names = new Map<string, string>();
  for (const [name, tool] of registrations?.registryByName ?? []) {
    if ((registrations?.toolClaimants?.get(name)?.length ?? 0) > 1) continue;
    const display = readDisplayName(tool.displayName);
    if (display !== undefined) names.set(name, display);
  }
  const servedNames = retainedStateValue(
    scope,
    'lateRecordNoteDisplayNames',
    Object.fromEntries(names),
  );
  const admitted = new Map<string, string>();
  if (typeof servedNames === 'object' && servedNames !== null) {
    for (const name of names.keys()) {
      const value: unknown = Object.getOwnPropertyDescriptor(servedNames, name)?.value;
      if (typeof value === 'string') admitted.set(name, value);
    }
  }
  return gatherLateNotePoints(record, admitted);
}
