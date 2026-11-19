import type { TypedScope } from 'footprintjs';
import { readCallOccurrenceKey, type CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import type { AgentState } from '../types.js';
import type { HonestyLayers } from './armed.js';

/** The most entered calls a turn can retain, independent of its history window. */
export const MAX_ENTERED_TOOL_CALLS = 1024;

interface EnteredToolCall {
  readonly callOccurrenceKey: CallOccurrenceKey;
  readonly entered: true;
}

export interface EnteredToolCalls {
  readonly entries: readonly EnteredToolCall[];
  /** False if an entry could not be recorded or the turn restarted after an error. */
  readonly complete: boolean;
}

/** Start in this Agent's own state. A native pause preserves it without reseeding. */
export function seedEnteredToolCalls(
  scope: TypedScope<AgentState>,
  deps: { readonly honestyLayers?: HonestyLayers; readonly findings?: boolean },
  continuingTurn: boolean,
): void {
  if (deps.honestyLayers?.inputs || deps.honestyLayers?.answer || deps.findings === true) {
    scope.enteredToolCalls = { entries: [], complete: !continuingTurn };
  }
}

/** Append one proof. A repeated address adds nothing and leaves the bound alone. */
export function appendEnteredToolCall(
  prior: EnteredToolCalls,
  key: CallOccurrenceKey | undefined,
): EnteredToolCalls {
  const address = readCallOccurrenceKey({ callOccurrenceKey: key });
  if (key === undefined || typeof address !== 'string') {
    return prior.complete ? { ...prior, complete: false } : prior;
  }
  if (
    prior.entries.some(
      (entry) => entry?.entered === true && readCallOccurrenceKey(entry) === address,
    )
  ) {
    return prior;
  }
  if (prior.entries.length >= MAX_ENTERED_TOOL_CALLS) {
    return prior.complete ? { ...prior, complete: false } : prior;
  }
  return {
    complete: prior.complete,
    entries: [
      ...prior.entries,
      { callOccurrenceKey: Object.freeze([...key] as const), entered: true },
    ],
  };
}

/** Called at the native execute boundary, after all admission gates. */
export function recordToolEntry(
  scope: TypedScope<AgentState>,
  key: CallOccurrenceKey | undefined,
): void {
  if (!('enteredToolCalls' in scope)) return;
  const prior = scope.$getValue('enteredToolCalls') as EnteredToolCalls | undefined;
  if (prior === undefined) return;
  const known =
    Array.isArray(prior?.entries) && typeof prior.complete === 'boolean'
      ? prior
      : { entries: [], complete: false };
  const next = appendEnteredToolCall(known, key);
  if (next !== prior) scope.enteredToolCalls = next;
}
