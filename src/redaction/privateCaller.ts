import type { FlowchartCheckpoint } from 'footprintjs';
import { copyJson, ownData } from '../lib/boundedJson.js';
import { carriedRunPolicy } from './conversation.js';
import type { RedactionCoverage } from './coverage.js';
import type { PrivateRecordFields } from './privateFields.js';
import type { CarriedRedactionPolicy } from './policy.js';

/** A positive consistency declaration, never proof of checkpoint authenticity. */
export const PRIVATE_CALLER_NONE = Object.freeze({ version: 1, caller: 'none' } as const);
export type CarriedCallerPolicy = CarriedRedactionPolicy | typeof PRIVATE_CALLER_NONE;
export type PrivateCallerDeclaration =
  | { readonly state: 'absent' }
  | { readonly state: 'none' }
  | { readonly state: 'policy'; readonly value: Record<string, unknown> };

/** Read a relevant ordinary own data property without reading unrelated values. */
export function checkpointOwnSlot(
  record: unknown,
  key: string,
): { readonly present: false } | { readonly present: true; readonly value: unknown } {
  if (
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(record))
  )
    throw new TypeError('Unreadable checkpoint redaction state.');
  const own = Object.getOwnPropertyDescriptor(record, key);
  if (own === undefined) return { present: false };
  if (!own.enumerable || !('value' in own))
    throw new TypeError('Unreadable checkpoint redaction state.');
  return { present: true, value: own.value };
}

export function checkpointOwnValue(record: unknown, key: string): unknown {
  const slot = checkpointOwnSlot(record, key);
  return slot.present ? slot.value : undefined;
}

export function checkpointStateValue(checkpoint: FlowchartCheckpoint, key: string): unknown {
  const state = checkpointOwnValue(checkpoint, 'sharedState');
  return state === undefined || state === null ? undefined : checkpointOwnValue(state, key);
}

export function checkpointStateSlot(checkpoint: FlowchartCheckpoint, key: string) {
  const state = checkpointOwnValue(checkpoint, 'sharedState');
  return state === undefined || state === null
    ? ({ present: false } as const)
    : checkpointOwnSlot(state, key);
}

/**
 * The union is closed: a real policy, or the exact private-only declaration.
 * A missing/null policy stays absent. It NEVER means the explicit none branch.
 * copyJson is used for own-data admission, not a new caller-policy byte bound.
 */
export function readPrivateCaller(
  value: unknown,
  fields: PrivateRecordFields | undefined,
): PrivateCallerDeclaration {
  if (value === undefined || value === null) return { state: 'absent' };
  const data = ownData(copyJson(value, Number.MAX_SAFE_INTEGER, false, 8));
  if (Object.hasOwn(data, 'caller') || Object.hasOwn(data, 'version')) {
    const none = ownData(data, ['version', 'caller']);
    if (
      fields === undefined ||
      Object.keys(none).length !== 2 ||
      none.version !== 1 ||
      none.caller !== 'none'
    )
      throw new TypeError('Unreadable checkpoint caller declaration.');
    return { state: 'none' };
  }
  ownData(data, ['keys', 'patterns', 'fields', 'diagnostics', 'emitPatterns', 'vocabulary']);
  return { state: 'policy', value: data };
}

/** Called only at the trusted writer which knows the actual run's coverage. */
export function privateCallerFor(coverage: RedactionCoverage): unknown {
  if (coverage.state === 'unknown') throw new TypeError('Unknown checkpoint caller coverage.');
  return coverage.state === 'declared-none'
    ? PRIVATE_CALLER_NONE
    : carriedRunPolicy(coverage.policy);
}

/** Copy native checkpoint/state containers without invoking any accessor. */
export function withCheckpointData<T extends object>(
  value: T,
  updates: Readonly<Record<string, unknown>>,
): T {
  const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(value);
  for (const [key, item] of Object.entries(updates))
    descriptors[key] = {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true,
    };
  return Object.create(Object.getPrototypeOf(value), descriptors) as T;
}
