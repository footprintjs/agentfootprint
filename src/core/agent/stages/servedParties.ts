import type { TypedScope } from 'footprintjs';
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import {
  readToolOwner,
  sameToolBirth,
  type ToolTurnBirth,
} from '../../../tools/toolResourceOwner.js';
import { readToolParty, type ToolParty } from '../../../tools/toolParty.js';
import type { ServedToolParties } from '../../slots/buildToolsSlot.js';
import type { AgentState } from '../types.js';

const KEY = 'servedToolParties';
const MAX_BYTES = 131_072;
const MAX_ROWS = 1024;
interface PartyRow {
  readonly name: string;
  readonly party: ToolParty | null;
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
function rows(value: unknown, nullable: boolean): PartyRow[] {
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
    const party = nullable && row.party === null ? null : readToolParty(row.party) ?? invalid();
    return { name: row.name, party };
  });
}
/** Pure admission; declarations establish consistency, never authority. */
export function readServedParties(state: Record<string, unknown>): ServedPartiesCarrier {
  const fields = ownData(state);
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
    data.turn !== fields.turnNumber
  )
    invalid();
  return {
    version: 1,
    owner: expected,
    turn: data.turn as number,
    current: rows(data.current, true),
    last: rows(data.last, false),
  };
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
    current: [...served.current].map(([name, party]) => ({ name, party })),
    last: [...served.lastServed].map(([name, party]) => ({ name, party })),
  };
  // Apply the same finite decoder at write and restore, without truncating history.
  scope.servedToolParties = readServedParties({
    [KEY]: carrier,
    toolResourceOwner: { version: 1, birth: carrier.owner, nextDispatch: 0 },
    turnNumber: carrier.turn,
  });
}
/** Restore once before discovery; the next Compose owns current wire membership. */
export function restoreServedParties(
  scope: TypedScope<AgentState>,
  served: ServedToolParties | undefined,
): void {
  if (!(KEY in scope)) return;
  const carrier = readServedParties({
    [KEY]: scope.$getValue(KEY),
    toolResourceOwner: scope.$getValue('toolResourceOwner'),
    turnNumber: scope.turnNumber,
  });
  if (served === undefined) invalid();
  served.current = new Map(carrier.current.map(({ name, party }) => [name, party]));
  served.lastServed.clear();
  for (const { name, party } of carrier.last) served.lastServed.set(name, party!);
  scope.servedToolParties = undefined;
}
