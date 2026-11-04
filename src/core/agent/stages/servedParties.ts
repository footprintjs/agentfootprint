import type { TypedScope } from 'footprintjs';
import { copyJson, jsonBytes, ownData } from '../../../lib/boundedJson.js';
import {
  readToolOwner,
  sameToolBirth,
  type ToolTurnBirth,
} from '../../../tools/toolResourceOwner.js';
import { readToolParty, sameToolParty, type ToolParty } from '../../../tools/toolParty.js';
import {
  finiteLabel,
  keyOfLabel,
  labelKey,
  readFiniteLabel,
  type FiniteLabel,
} from '../../../tools/finiteLabel.js';
import type { ServedToolParties } from '../../slots/buildToolsSlot.js';
import type { AgentState } from '../types.js';
import {
  originalPartyRow,
  ownCall,
  readOriginalParties,
  type OriginalPartyRow,
} from './batchParties.js';

const KEY = 'servedToolParties',
  MAX_BYTES = 131_072,
  MAX_ROWS = 1024;
interface PartyRow {
  readonly name: FiniteLabel;
  readonly party: ToolParty;
}
export interface ServedPartiesCarrier {
  readonly version: 2;
  readonly owner: ToolTurnBirth;
  readonly turn: number;
  readonly iteration: number;
  readonly argumentAsk: boolean;
  readonly truncated: boolean;
  readonly bound: readonly OriginalPartyRow[];
  readonly current: readonly PartyRow[];
  readonly last: readonly PartyRow[];
}
export interface PartySaveBinding {
  readonly calls: readonly unknown[];
  readonly iteration: number;
  readonly partyOf: (name: string) => ToolParty | undefined;
  readonly argumentAsk?: true;
  readonly paused?: { readonly id: unknown; readonly name: string };
}
function invalid(): never {
  throw new TypeError('Invalid served tool parties in pause checkpoint');
}
function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field !== undefined && 'value' in field ? field.value : undefined;
}
function rows(value: unknown): PartyRow[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) invalid();
  const names = new Set<string>();
  return value.map((raw) => {
    const row = ownData(raw, ['name', 'party']),
      name = readFiniteLabel(row.name),
      key = labelKey(name);
    if (names.has(key)) invalid();
    names.add(key);
    return { name, party: readToolParty(row.party) ?? invalid() };
  });
}
/** Pure admission of one domain; unrelated checkpoint state is never inspected. */
export function readServedParties(state: Record<string, unknown>): ServedPartiesCarrier {
  const data = ownData(copyJson(own(state, KEY), MAX_BYTES, false, 9), [
    'version',
    'owner',
    'turn',
    'iteration',
    'argumentAsk',
    'truncated',
    'bound',
    'current',
    'last',
  ]);
  const rawOwner = ownData(data.owner, ['runId', 'componentOrdinal']);
  const expected = readToolOwner(own(state, 'toolResourceOwner')).birth;
  if (
    data.version !== 2 ||
    typeof rawOwner.runId !== 'string' ||
    typeof rawOwner.componentOrdinal !== 'number' ||
    !sameToolBirth(
      { runId: rawOwner.runId, componentOrdinal: rawOwner.componentOrdinal },
      expected,
    ) ||
    !Number.isSafeInteger(data.turn) ||
    (data.turn as number) < 1 ||
    data.turn !== own(state, 'turnNumber') ||
    !Number.isSafeInteger(data.iteration) ||
    (data.iteration as number) < 1 ||
    data.iteration !== own(state, 'iteration') ||
    typeof data.argumentAsk !== 'boolean' ||
    typeof data.truncated !== 'boolean'
  )
    invalid();
  const current = rows(data.current),
    last = rows(data.last);
  const remembered = new Map(last.map((row) => [labelKey(row.name), row.party]));
  for (const row of current) {
    const party = remembered.get(labelKey(row.name));
    if (party === undefined || !sameToolParty(row.party, party)) invalid();
  }
  const calls = own(state, 'llmLatestToolCalls') ?? [];
  const pausedName = own(state, 'pausedToolName');
  readOriginalParties(
    data.bound,
    calls,
    !data.argumentAsk && typeof pausedName === 'string'
      ? {
          id: own(state, 'pausedToolCallId'),
          name: pausedName,
          party: own(state, 'pausedToolParty'),
        }
      : undefined,
  );
  if (
    data.truncated === false &&
    Array.isArray(calls) &&
    (data.bound as unknown[]).length !== calls.length
  )
    invalid();
  return {
    version: 2,
    owner: expected,
    turn: data.turn as number,
    iteration: data.iteration as number,
    argumentAsk: data.argumentAsk,
    truncated: data.truncated,
    bound: data.bound as unknown as readonly OriginalPartyRow[],
    current,
    last,
  };
}
/** One finite proof: selected paused call, then its siblings, then remembered wire. */
export function saveServedParties(
  scope: TypedScope<AgentState>,
  served: ServedToolParties | undefined,
  binding?: PartySaveBinding,
): void {
  if (served === undefined) return;
  const calls = binding?.calls ?? [];
  const carrier: ServedPartiesCarrier = {
    version: 2,
    owner: readToolOwner(scope.$getValue('toolResourceOwner')).birth,
    turn: scope.turnNumber as number,
    iteration: binding?.iteration ?? (scope.iteration as number),
    argumentAsk: binding?.argumentAsk === true,
    truncated: served.truncated === true,
    bound: [],
    current: [],
    last: [],
  };
  const bound: OriginalPartyRow[] = [],
    last: PartyRow[] = [],
    current: PartyRow[] = [];
  let bytes = jsonBytes(carrier),
    truncated = carrier.truncated;
  const paused = binding?.paused;
  const selected =
    paused === undefined
      ? -1
      : calls.findIndex((value) => {
          const call = ownCall(value);
          return call?.name === paused.name && Object.is(call.id, paused.id);
        });
  const indices = [
    ...(selected >= 0 ? [selected] : []),
    ...calls.map((_, index) => index).filter((index) => index !== selected),
  ];
  for (const index of indices) {
    const row = originalPartyRow(calls[index], index, binding?.partyOf ?? (() => undefined));
    if (row === undefined) {
      truncated = true;
      continue;
    }
    const cost = jsonBytes(row) + (bound.length > 0 ? 1 : 0);
    if (bound.length === MAX_ROWS || bytes + cost > MAX_BYTES) {
      truncated = true;
      continue;
    }
    bytes += cost;
    bound.push(row);
  }
  const recent = new Map<string, PartyRow>();
  const offered = new Map([...served.current].map(([name, party]) => [keyOfLabel(name), party]));
  for (const [key, party] of served.lastProof ?? []) {
    const [kind, value] = JSON.parse(key) as [string, string];
    const name = readFiniteLabel({ kind, value });
    recent.set(key, { name, party });
  }
  for (const [name, value] of [...served.lastServed, ...served.current]) {
    const party = value === null ? undefined : readToolParty(value);
    if (party === undefined) {
      truncated = true;
      continue;
    }
    const label = finiteLabel(name),
      key = labelKey(label);
    recent.delete(key);
    recent.set(key, { name: label, party });
  }
  for (const row of [...recent.values()].reverse()) {
    const raw = offered.get(labelKey(row.name));
    const active = raw ?? served.currentProof?.get(labelKey(row.name));
    const onWire = active !== undefined && active !== null && sameToolParty(active, row.party);
    const cost =
      jsonBytes(row) +
      (last.length > 0 ? 1 : 0) +
      (onWire ? jsonBytes(row) + (current.length > 0 ? 1 : 0) : 0);
    if (last.length === MAX_ROWS || bytes + cost > MAX_BYTES) {
      truncated = true;
      continue;
    }
    bytes += cost;
    last.push(row);
    if (onWire) current.push(row);
  }
  const currentByKey = new Map(current.map((row) => [labelKey(row.name), row]));
  const wireOrder =
    served.currentProof === undefined
      ? [...served.current.keys()].map(keyOfLabel)
      : [...served.currentProof.keys()];
  const ordered = wireOrder.flatMap((key) => {
    const row = currentByKey.get(key);
    return row === undefined ? [] : [row];
  });
  const saved = { ...carrier, truncated, bound, current: ordered, last: last.reverse() };
  scope.servedToolParties = readServedParties({
    [KEY]: saved,
    toolResourceOwner: { version: 1, birth: carrier.owner, nextDispatch: 0 },
    turnNumber: carrier.turn,
    iteration: carrier.iteration,
    llmLatestToolCalls: calls,
  });
  served.argumentAskPending = carrier.argumentAsk;
}
/** Actual restore alone narrows a cached offer; new positive Compose may replace it. */
export function restoreServedParties(
  scope: TypedScope<AgentState>,
  served: ServedToolParties | undefined,
): void {
  if (served === undefined || served.wireReady === true) return;
  const calls = scope.$getValue('llmLatestToolCalls');
  const carrier = readServedParties({
    [KEY]: scope.$getValue(KEY),
    toolResourceOwner: scope.$getValue('toolResourceOwner'),
    turnNumber: scope.turnNumber,
    iteration: scope.iteration,
    llmLatestToolCalls: calls,
    pausedToolName: scope.$getValue('pausedToolName'),
    pausedToolCallId: scope.$getValue('pausedToolCallId'),
    pausedToolParty: scope.$getValue('pausedToolParty'),
  });
  const currentProof = new Map(carrier.current.map(({ name, party }) => [labelKey(name), party]));
  served.currentProof = currentProof;
  served.lastProof = new Map(carrier.last.map(({ name, party }) => [labelKey(name), party]));
  served.current = new Map(
    carrier.current.flatMap(({ name, party }) =>
      name.kind === 'plain' ? [[name.value, party] as const] : [],
    ),
  );
  served.lastServed.clear();
  for (const { name, party } of carrier.last)
    if (name.kind === 'plain') served.lastServed.set(name.value, party);
  served.pinned = readOriginalParties(carrier.bound, calls);
  served.restored = true;
  served.truncated = carrier.truncated ? true : undefined;
  served.argumentAskPending = carrier.argumentAsk;
  served.wireReady = true;
  if (carrier.truncated)
    scope.dynamicToolSchemas = [...(scope.dynamicToolSchemas ?? [])].filter((schema) =>
      currentProof.has(keyOfLabel(schema.name)),
    );
  scope.servedToolParties = undefined;
}
