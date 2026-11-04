import { ownData } from '../../../lib/boundedJson.js';
import {
  callIdLabel,
  finiteLabel,
  labelKey,
  readFiniteLabel,
  type FiniteLabel,
} from '../../../tools/finiteLabel.js';
import { readToolParty, sameToolParty, type ToolParty } from '../../../tools/toolParty.js';

export interface OriginalPartyRow {
  readonly index: number;
  readonly id: FiniteLabel;
  readonly name: FiniteLabel;
  readonly party: ToolParty | null;
}
export function ownCall(
  value: unknown,
): { readonly id: unknown; readonly name: string } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const id = Object.getOwnPropertyDescriptor(value, 'id');
  const name = Object.getOwnPropertyDescriptor(value, 'name');
  return name !== undefined && 'value' in name && typeof name.value === 'string'
    ? { id: id !== undefined && 'value' in id ? id.value : undefined, name: name.value }
    : undefined;
}
export function originalPartyRow(
  value: unknown,
  index: number,
  partyOf: (name: string) => ToolParty | undefined,
): OriginalPartyRow | undefined {
  const call = ownCall(value);
  if (call === undefined) return undefined;
  const id = callIdLabel(call.id);
  if (id === undefined) return undefined;
  const declared = partyOf(call.name);
  const party = declared === undefined ? null : readToolParty(declared);
  if (party === undefined) throw new TypeError('Invalid original tool party');
  return { index, id, name: finiteLabel(call.name), party };
}
/** Owner/turn/iteration admission belongs to the containing carrier. */
export function readOriginalParties(
  value: unknown,
  calls: unknown,
  selected?: { readonly id: unknown; readonly name: string; readonly party: unknown },
): Map<string, ToolParty | null> {
  if (!Array.isArray(value) || value.length > 1024 || !Array.isArray(calls))
    throw new TypeError('Invalid original tool parties');
  const seen = new Set<number>(),
    parties = new Map<string, ToolParty | null>();
  for (const raw of value) {
    const row = ownData(raw, ['index', 'id', 'name', 'party']);
    if (
      !Number.isSafeInteger(row.index) ||
      (row.index as number) < 0 ||
      (row.index as number) >= calls.length ||
      seen.has(row.index as number)
    )
      throw new TypeError('Invalid original tool call');
    const index = row.index as number;
    seen.add(index);
    const slot = Object.getOwnPropertyDescriptor(calls, String(index));
    const call = ownCall(slot !== undefined && 'value' in slot ? slot.value : undefined);
    const id = call === undefined ? undefined : callIdLabel(call.id);
    if (
      call === undefined ||
      id === undefined ||
      labelKey(readFiniteLabel(row.id)) !== labelKey(id) ||
      labelKey(readFiniteLabel(row.name)) !== labelKey(finiteLabel(call.name))
    )
      throw new TypeError('Invalid original tool identity');
    const party = row.party === null ? null : readToolParty(row.party);
    if (party === undefined) throw new TypeError('Invalid original tool party');
    const prior = parties.get(call.name);
    if (
      prior !== undefined &&
      (prior === null || party === null ? prior !== party : !sameToolParty(prior, party))
    )
      throw new TypeError('Conflicting original tool parties');
    parties.set(call.name, party);
  }
  if (selected !== undefined) {
    const index = calls.findIndex((value) => {
      const call = ownCall(value);
      return call?.name === selected.name && Object.is(call.id, selected.id);
    });
    if (!seen.has(index)) throw new TypeError('Missing original paused call');
    if (selected.party !== undefined) {
      const raw = readToolParty(selected.party),
        bound = parties.get(selected.name);
      if (raw === undefined || bound === undefined || bound === null || !sameToolParty(raw, bound))
        throw new TypeError('Changed original paused party');
    }
  }
  return parties;
}
