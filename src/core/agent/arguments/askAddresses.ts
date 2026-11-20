import { batchAddress, type BatchAddress } from './batchAddress.js';
import type { BatchCall } from './resolve.js';
import type { ArgumentAskState, AskField, AskMember } from './ask.js';

type CallIdentity = Pick<BatchCall, 'id' | 'callOccurrenceKey'>;

export const addressOf = (call: CallIdentity): BatchAddress =>
  batchAddress(call.id, call.callOccurrenceKey);

/** An ID on an old batch names a call only when that ID occurs once. */
export function callsByAddress<Call extends CallIdentity>(
  calls: readonly Call[],
): ReadonlyMap<BatchAddress, Call> {
  const found = new Map<BatchAddress, Call>();
  const ambiguous = new Set<BatchAddress>();
  for (const call of calls) {
    const address = addressOf(call);
    if (found.has(address)) ambiguous.add(address);
    else found.set(address, call);
  }
  for (const address of ambiguous) found.delete(address);
  return found;
}

export const memberAddresses = (member: AskMember): readonly BatchAddress[] =>
  member.callAddresses ?? member.toolCallIds;

export const fieldAddresses = (field: AskField): ReadonlySet<BatchAddress> =>
  new Set(field.members.flatMap(memberAddresses));

/** Old checkpoints used IDs as record keys. Encode typed addresses when any
 * member carries them, so a position and a string ID cannot share a slot. */
export const windowAddressKey = (field: AskField, address: BatchAddress): string =>
  field.members.some((member) => member.callAddresses !== undefined)
    ? JSON.stringify(address)
    : String(address);

const invalidSavedCall = () => new TypeError('argumentAsk: saved field does not identify one call');

/** Read the saved working targets without reopening or restamping the public
 * question. Old fields can be upgraded only where their IDs identify one call. */
export function restoreAskAddresses(
  state: ArgumentAskState,
  calls: readonly BatchCall[],
): ArgumentAskState {
  const byAddress = callsByAddress(calls);
  const progress = [...state.progress];
  const fields = state.fields.map((field, index) => {
    const members = field.members.map((member) => {
      if (member.callAddresses !== undefined) {
        const addresses = member.callAddresses;
        if (
          !Array.isArray(addresses) ||
          new Set(addresses).size !== member.toolCallIds.length ||
          addresses.length !== member.toolCallIds.length ||
          !member.toolCallIds.every((id, i) => {
            const call = byAddress.get(addresses[i]);
            return call?.id === id && call.name === member.toolName;
          })
        )
          throw invalidSavedCall();
        return member;
      }
      const addresses = member.toolCallIds.map((id) => {
        const matches = calls.filter((call) => call.id === id && call.name === member.toolName);
        if (matches.length !== 1) throw invalidSavedCall();
        const address = addressOf(matches[0]);
        if (!byAddress.has(address)) throw invalidSavedCall();
        return address;
      });
      return addresses.some((address) => typeof address === 'number')
        ? { ...member, callAddresses: addresses }
        : member;
    });
    if (members.every((member, i) => member === field.members[i])) return field;
    const translated = { ...field, members };
    const addressesForId = (id: string) => {
      const matches = [...fieldAddresses(translated)].filter(
        (address) => byAddress.get(address)?.id === id,
      );
      if (matches.length !== 1) throw invalidSavedCall();
      return matches[0];
    };
    const progressEntry = progress[index];
    if (field.window !== undefined && progressEntry !== undefined) {
      const translate = <Value>(values: Readonly<Record<string, Value>>) =>
        Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            windowAddressKey(translated, addressesForId(id)),
            value,
          ]),
        );
      progress[index] = {
        ...progressEntry,
        ...(progressEntry.fills !== undefined && { fills: translate(progressEntry.fills) }),
        ...(progressEntry.refused !== undefined && { refused: translate(progressEntry.refused) }),
      };
    }
    if (field.window?.confirmOnlyIds === undefined) return translated;
    return {
      ...translated,
      window: {
        ...field.window,
        confirmOnlyAddresses: field.window.confirmOnlyIds.map(addressesForId),
      },
    };
  });
  return { ...state, fields, progress };
}
