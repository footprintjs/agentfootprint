import type { TypedScope } from 'footprintjs';
import { copyJson, jsonBytes, ownData } from '../../../lib/boundedJson.js';
import {
  readToolOwner,
  sameToolBirth,
  type ToolTurnBirth,
} from '../../../tools/toolResourceOwner.js';
import { readToolParty, sameToolParty, type ToolParty } from '../../../tools/toolParty.js';
import type { ServedToolParties } from '../../slots/buildToolsSlot.js';
import type { AgentState } from '../types.js';

const KEY = 'servedToolParties';
const MAX_BYTES = 131_072;
const MAX_ROWS = 1024;
interface PartyRow {
  readonly name: string;
  readonly party: ToolParty;
}
export interface ServedPartiesCarrier {
  readonly version: 1;
  readonly owner: ToolTurnBirth;
  readonly turn: number;
  readonly current: readonly PartyRow[];
  readonly last: readonly PartyRow[];
}
function invalid(): never {
  throw new TypeError('Invalid served tool parties in pause checkpoint');
}
function rows(value: unknown): PartyRow[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) invalid();
  const names = new Set<string>();
  return value.map((raw) => {
    const row = ownData(raw, ['name', 'party']);
    if (
      typeof row.name !== 'string' ||
      row.name.length === 0 ||
      row.name.length > 1024 ||
      names.has(row.name)
    )
      invalid();
    names.add(row.name);
    const party = readToolParty(row.party) ?? invalid();
    return { name: row.name, party };
  });
}
/** Pure admission; declarations establish consistency, never authority. */
export function readServedParties(state: Record<string, unknown>): ServedPartiesCarrier {
  // The checkpoint leaf holds many unrelated domains. Admit this carrier's
  // own data fields only, never its neighbours or an inherited getter.
  const own = (key: string): unknown => {
    if (state === null || typeof state !== 'object') return undefined;
    const field = Object.getOwnPropertyDescriptor(state, key);
    return field !== undefined && 'value' in field ? field.value : undefined;
  };
  const fields = {
    [KEY]: own(KEY),
    toolResourceOwner: own('toolResourceOwner'),
    turnNumber: own('turnNumber'),
  };
  const data = ownData(copyJson(fields[KEY], MAX_BYTES, false, 8), [
    'version',
    'owner',
    'turn',
    'current',
    'last',
  ]);
  const rawOwner = ownData(data.owner, ['runId', 'componentOrdinal']);
  const expected = readToolOwner(fields.toolResourceOwner).birth;
  if (
    typeof rawOwner.runId !== 'string' ||
    typeof rawOwner.componentOrdinal !== 'number' ||
    !sameToolBirth(
      { runId: rawOwner.runId, componentOrdinal: rawOwner.componentOrdinal },
      expected,
    ) ||
    data.version !== 1 ||
    !Number.isSafeInteger(data.turn) ||
    (data.turn as number) < 1 ||
    data.turn !== fields.turnNumber
  )
    invalid();
  const current = rows(data.current),
    last = rows(data.last);
  const remembered = new Map(last.map((row) => [row.name, row.party]));
  for (const row of current) {
    const party = remembered.get(row.name);
    if (party === undefined || !sameToolParty(row.party, party)) invalid();
  }
  return { version: 1, owner: expected, turn: data.turn as number, current, last };
}
/** Written only at an actual pause; no plain-run reads or extra executable state. */
export function saveServedParties(
  scope: TypedScope<AgentState>,
  served: ServedToolParties | undefined,
): void {
  if (served === undefined) return;
  const carrier: ServedPartiesCarrier = {
    version: 1,
    owner: readToolOwner(scope.$getValue('toolResourceOwner')).birth,
    turn: scope.turnNumber as number,
    current: [],
    last: [],
  };
  // Bounds limit what a later resume can prove; they never fail a legal pause.
  // Keep the newest remembered names. Each name costs its last row and, when
  // currently offered, its current row, including exact JSON escaping/commas.
  const last: PartyRow[] = [],
    current: PartyRow[] = [];
  let bytes = jsonBytes(carrier);
  const recent = new Map(served.lastServed);
  for (const [name, value] of served.current) {
    if (value === null) continue;
    recent.delete(name);
    recent.set(name, value);
  }
  for (const [name, value] of [...recent].reverse()) {
    if (last.length === MAX_ROWS) break;
    const party = readToolParty(value);
    if (name.length === 0 || name.length > 1024 || party === undefined) continue;
    const row = { name, party };
    const active = served.current.get(name);
    const onWire = active !== undefined && active !== null && sameToolParty(active, party);
    const cost =
      jsonBytes(row) +
      (last.length > 0 ? 1 : 0) +
      (onWire ? jsonBytes(row) + (current.length > 0 ? 1 : 0) : 0);
    if (bytes + cost > MAX_BYTES) break;
    bytes += cost;
    last.push(row);
    if (onWire) current.push(row);
  }
  const keptCurrent = new Map(current.map((row) => [row.name, row]));
  const bounded = {
    ...carrier,
    current: [...served.current.keys()].flatMap((name) => {
      const row = keptCurrent.get(name);
      return row === undefined ? [] : [row];
    }),
    last: last.reverse(),
  };
  scope.servedToolParties = readServedParties({
    [KEY]: bounded,
    toolResourceOwner: { version: 1, birth: carrier.owner, nextDispatch: 0 },
    turnNumber: carrier.turn,
  });
}
/** Restore once before discovery; the next Compose owns current wire membership. */
export function restoreServedParties(
  scope: TypedScope<AgentState>,
  served: ServedToolParties | undefined,
): void {
  if (served === undefined || served.wireReady === true) return;
  const carrier = readServedParties({
    [KEY]: scope.$getValue(KEY),
    toolResourceOwner: scope.$getValue('toolResourceOwner'),
    turnNumber: scope.turnNumber,
  });
  if (served === undefined) invalid();
  served.current = new Map(carrier.current.map(({ name, party }) => [name, party]));
  served.lastServed.clear();
  for (const { name, party } of carrier.last) served.lastServed.set(name, party);
  served.restored = true;
  served.wireReady = true;
  scope.servedToolParties = undefined;
}
