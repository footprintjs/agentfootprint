import { MAX_TOOL_CALLS, MAX_TOOL_LABEL } from './toolCallShape.js';
import { readServedParties } from './servedParties.js';
import type { FlowchartCheckpoint, TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { ArgumentAskState } from '../arguments/ask.js';
import type { ServedToolParties } from '../../slots/buildToolsSlot.js';
import { readToolParty, sameToolParty, type ToolParty } from '../../../tools/toolParty.js';
import { isArgumentAskPause } from '../arguments/askMarker.js';
import {
  readToolOwner,
  sameToolBirth,
  type ToolTurnBirth,
} from '../../../tools/toolResourceOwner.js';

interface CallIdentity {
  readonly id: string;
  readonly name: string;
}

interface ArgumentPartyState extends ArgumentAskState {
  readonly toolParties: {
    readonly version: 1;
    readonly owner: ToolTurnBirth;
    readonly turn: number;
    readonly iteration: number;
    readonly calls: readonly (CallIdentity & { readonly party: ToolParty | null })[];
  };
}

function invalid(): never {
  throw new TypeError('argumentAsk: missing or invalid original tool parties; recreate the pause');
}

function own(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function ownerOf(scope: TypedScope<AgentState>): ToolTurnBirth {
  return readToolOwner(scope.$getValue('toolResourceOwner')).birth;
}

function sameOwner(value: unknown, expected: ToolTurnBirth): boolean {
  const runId = own(value, 'runId');
  const componentOrdinal = own(value, 'componentOrdinal');
  return (
    typeof runId === 'string' &&
    typeof componentOrdinal === 'number' &&
    sameToolBirth({ runId, componentOrdinal }, expected)
  );
}

function callsOfValue(calls: unknown): readonly CallIdentity[] {
  if (!Array.isArray(calls) || calls.length > MAX_TOOL_CALLS) invalid();
  const ids = new Set<string>();
  return Array.from({ length: calls.length }, (_, index) => {
    const call = own(calls, index);
    const id = own(call, 'id');
    const name = own(call, 'name');
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      id.length > MAX_TOOL_LABEL ||
      ids.has(id) ||
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > MAX_TOOL_LABEL
    )
      invalid();
    ids.add(id);
    return { id, name };
  });
}

/** Admit the selected native leaf before origin, including omitted ask configuration. */
export function requireArgumentPartyCheckpoint(checkpoint: FlowchartCheckpoint): void {
  const path = checkpoint.subflowPath;
  if (!Array.isArray(path)) invalid();
  const last = path[path.length - 1];
  const leaf =
    path.length === 0
      ? checkpoint.sharedState
      : typeof last === 'string'
      ? own(checkpoint.subflowStates, last)
      : invalid();
  const askPause = isArgumentAskPause(checkpoint.pauseData);
  const pausedCall = own(leaf, 'pausedToolCallId');
  if (askPause || (typeof pausedCall === 'string' && pausedCall.length > 0)) {
    readToolOwner(own(leaf, 'toolResourceOwner'));
    readServedParties(leaf as Record<string, unknown>);
  }
  if (!askPause) return;
  const ask = own(leaf, 'argumentAsk');
  if (own(ask, 'waiting') === undefined) invalid();
  readParties(
    ask,
    callsOfValue(own(leaf, 'llmLatestToolCalls')),
    readToolOwner(own(leaf, 'toolResourceOwner')).birth,
    own(leaf, 'turnNumber'),
    own(leaf, 'iteration'),
  );
}

/** Capture declarations, never executable tools, for every sibling in the paused batch. */
export function withArgumentParties(
  scope: TypedScope<AgentState>,
  state: ArgumentAskState,
  partyOf: (name: string) => ToolParty | undefined,
): ArgumentPartyState {
  const calls = callsOfValue(scope.$getValue('llmLatestToolCalls')).map((call) => {
    const offered = partyOf(call.name);
    const party = offered === undefined ? null : readToolParty(offered) ?? invalid();
    return { ...call, party };
  });
  return {
    ...state,
    toolParties: {
      version: 1,
      owner: ownerOf(scope),
      turn: scope.turnNumber as number,
      iteration: state.iteration,
      calls,
    },
  };
}

/** Admit the whole saved batch before any discovery, peeling, policy or resource IO. */
export function restoreArgumentParties(
  scope: TypedScope<AgentState>,
  served: ServedToolParties | undefined,
): void {
  if (!('argumentAsk' in scope)) return;
  const state = scope.$getValue('argumentAsk');
  if (state === undefined) return;
  if (served === undefined) invalid();
  served.pinned = readParties(
    state,
    callsOfValue(scope.$getValue('llmLatestToolCalls')),
    ownerOf(scope),
    scope.turnNumber,
    scope.iteration,
  );
}

/** Pure bounded domain admission, shared by preflight and the live scope. */
function readParties(
  state: unknown,
  calls: readonly CallIdentity[],
  owner: ToolTurnBirth,
  turn: unknown,
  iteration: unknown,
): Map<string, ToolParty | null> {
  const binding = own(state, 'toolParties');
  const rows = own(binding, 'calls');
  if (
    own(binding, 'version') !== 1 ||
    !sameOwner(own(binding, 'owner'), owner) ||
    own(binding, 'turn') !== turn ||
    own(binding, 'iteration') !== iteration ||
    own(state, 'iteration') !== iteration ||
    !Array.isArray(rows) ||
    rows.length !== calls.length
  )
    invalid();
  const parties = new Map<string, ToolParty | null>();
  for (const [index, call] of calls.entries()) {
    const row = own(rows, index);
    if (own(row, 'id') !== call.id || own(row, 'name') !== call.name) invalid();
    const raw = own(row, 'party');
    const party = raw === null ? null : readToolParty(raw) ?? invalid();
    const prior = parties.get(call.name);
    if (
      prior !== undefined &&
      (prior === null || party === null ? prior !== party : !sameToolParty(prior, party))
    )
      invalid();
    parties.set(call.name, party);
  }
  return parties;
}
