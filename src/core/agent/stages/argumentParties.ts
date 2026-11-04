import type { FlowchartCheckpoint, TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { ArgumentAskState } from '../arguments/ask.js';
import type { ServedToolParties } from '../../slots/buildToolsSlot.js';
import { readToolParty, sameToolParty, type ToolParty } from '../../../tools/toolParty.js';
import { isArgumentAskPause } from '../arguments/askMarker.js';

interface CallIdentity {
  readonly id: string;
  readonly name: string;
}

interface ArgumentPartyState extends ArgumentAskState {
  readonly toolParties: {
    readonly version: 1;
    readonly owner: string;
    readonly turn: number;
    readonly iteration: number;
    readonly calls: readonly (CallIdentity & { readonly party: ToolParty | null })[];
  };
}

const MAX_CALLS = 1024;
const MAX_LABEL = 1024;

function invalid(): never {
  throw new TypeError('argumentAsk: missing or invalid original tool parties; recreate the pause');
}

function own(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function ownerOf(scope: TypedScope<AgentState>): string {
  const owner = JSON.stringify([scope.turnStartMs, scope.$getValue('runIdentity')]);
  if (owner.length > 16384) invalid();
  return owner;
}

function callsOf(scope: TypedScope<AgentState>): readonly CallIdentity[] {
  const calls = scope.$getValue('llmLatestToolCalls');
  if (!Array.isArray(calls) || calls.length > MAX_CALLS) invalid();
  const ids = new Set<string>();
  return Array.from({ length: calls.length }, (_, index) => {
    const call = own(calls, index);
    const id = own(call, 'id');
    const name = own(call, 'name');
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      id.length > MAX_LABEL ||
      ids.has(id) ||
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > MAX_LABEL
    )
      invalid();
    ids.add(id);
    return { id, name };
  });
}

/** Admit the selected native leaf, including mounted pauses whose new config omits the ask. */
export function requireArgumentPartyCheckpoint(checkpoint: FlowchartCheckpoint): void {
  if (!isArgumentAskPause(checkpoint.pauseData)) return;
  const path = checkpoint.subflowPath;
  if (!Array.isArray(path)) invalid();
  const last = path[path.length - 1];
  const leaf =
    path.length === 0
      ? checkpoint.sharedState
      : typeof last === 'string'
      ? own(checkpoint.subflowStates, last)
      : invalid();
  const ask = own(leaf, 'argumentAsk');
  if (own(ask, 'toolParties') === undefined || own(ask, 'waiting') === undefined) invalid();
}

/** Capture declarations, never executable tools, for every sibling in the paused batch. */
export function withArgumentParties(
  scope: TypedScope<AgentState>,
  state: ArgumentAskState,
  partyOf: (name: string) => ToolParty | undefined,
): ArgumentPartyState {
  const calls = callsOf(scope).map((call) => {
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
  const state = scope.$getValue('argumentAsk');
  if (state === undefined) return;
  const binding = own(state, 'toolParties');
  const calls = callsOf(scope);
  const rows = own(binding, 'calls');
  if (
    served === undefined ||
    own(binding, 'version') !== 1 ||
    own(binding, 'owner') !== ownerOf(scope) ||
    own(binding, 'turn') !== scope.turnNumber ||
    own(binding, 'iteration') !== scope.iteration ||
    own(state, 'iteration') !== scope.iteration ||
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
  served.current = parties;
}
