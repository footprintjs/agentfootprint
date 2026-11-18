import { copyJson, ownData, readOwnList } from '../lib/boundedJson.js';
import { checkpointOwnSlot } from './privateCaller.js';

export const INNER_CALL_POLICY_KEY = 'innerCallPolicyArgs';
export type InnerCallPolicyCarrier = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export class InnerCallPolicyUnavailableError extends Error {
  constructor() {
    super('Policy arguments from an earlier inner call are unavailable.');
  }
}

function malformed(): never {
  throw new TypeError('Invalid checkpoint inner-call policy arguments.');
}

function isReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
  );
}

/** Read the private store as own JSON data. Never include rejected input in the error. */
export function innerCallPolicyOf(state: unknown): InnerCallPolicyCarrier | undefined {
  if (state === undefined || state === null) return undefined;
  try {
    const slot = checkpointOwnSlot(state, INNER_CALL_POLICY_KEY);
    if (!slot.present) return undefined;
    // Calls admit arguments up to copyJson's default depth. The private store adds one level.
    const data = ownData(copyJson(slot.value, Number.MAX_SAFE_INTEGER, true, 101));
    for (const [ref, args] of Object.entries(data)) {
      if (!isReference(ref)) malformed();
      ownData(args);
    }
    return Object.freeze(data) as InnerCallPolicyCarrier;
  } catch {
    return malformed();
  }
}

/** Stored shape admits legacy data. Policy requires an affirmative argument marker. */
export function innerCallPolicyReferences(history: unknown): ReadonlySet<string> {
  const refs = new Set<string>();
  if (!Array.isArray(history)) return refs;
  try {
    const messages = readOwnList(history, Number.MAX_SAFE_INTEGER) ?? malformed();
    for (const message of messages.entries) {
      const calls = checkpointOwnSlot(message, 'calls');
      if (!calls.present) continue;
      const role = checkpointOwnSlot(message, 'role');
      if (
        !Array.isArray(calls.value) ||
        Object.getPrototypeOf(calls.value) !== Array.prototype ||
        !role.present ||
        role.value !== 'tool'
      )
        malformed();
      for (let index = 0; index < calls.value.length; index += 1) {
        const call = Object.getOwnPropertyDescriptor(calls.value, String(index));
        if (call === undefined || !('value' in call) || !call.enumerable) malformed();
        for (const key of ['toolCallId', 'toolName']) {
          const slot = checkpointOwnSlot(call.value, key);
          if (!slot.present || typeof slot.value !== 'string' || slot.value.length === 0)
            malformed();
        }
        const args = checkpointOwnSlot(call.value, 'args');
        if (!args.present) malformed();
        ownData(copyJson(args.value, Number.MAX_SAFE_INTEGER, false));
        const ref = checkpointOwnSlot(call.value, 'policyArgsRef');
        if (!ref.present || ref.value === null) continue;
        if (!isReference(ref.value)) malformed();
        refs.add(ref.value);
      }
    }
  } catch {
    return malformed();
  }
  return refs;
}

/** Keep the private values for the history this checkpoint actually carries. */
export function innerCallPolicyFor(
  state: unknown,
  history: unknown,
): InnerCallPolicyCarrier | undefined {
  const refs = innerCallPolicyReferences(history);
  const stored = innerCallPolicyOf(state);
  if (stored === undefined) return undefined;
  const retained = Object.entries(stored).filter(([ref]) => refs.has(ref));
  return retained.length === 0 ? undefined : Object.freeze(Object.fromEntries(retained));
}

export function admitFoldedInnerCallPolicy(spans: unknown): void {
  if (spans === undefined) return;
  try {
    const folded = readOwnList(spans, Number.MAX_SAFE_INTEGER) ?? malformed();
    for (const span of folded.entries) {
      const messages = checkpointOwnSlot(span, 'messages');
      if (messages.present) innerCallPolicyReferences(messages.value);
    }
  } catch {
    malformed();
  }
}
