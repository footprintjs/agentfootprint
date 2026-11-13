import { applyContextChange, contextOwner } from './changes.js';
import { jsonBudget } from './json.js';
import { contextMeta } from './meta.js';
import {
  ContextRecordingError,
  contextRefusal,
  type ContextCallChange,
  type ContextRecordingBody,
  type OpenContextValues,
  type ReadContextRecording,
} from './types.js';

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

/**
 * Read through the value-table adapter, then resolve ONLY declared positions.
 * Ordinary old recordings are returned by identity; a user value shaped like
 * `{ref: ...}` is never a reference unless this format names its exact path.
 */
export async function readContextRecording(
  input: unknown,
  open: OpenContextValues,
): Promise<ReadContextRecording> {
  try {
    // The value-table adapter may yield while hashing. It owns the table,
    // but its record payload is opaque: own this format BEFORE that await.
    // Legacy records retain their original identity and are never traversed.
    const budget = jsonBudget();
    const owned =
      hasContextMarker(input) ||
      (ownValue(input, 'format') === 'foottrace.value-record.v1' &&
        hasContextMarker(ownValue(input, 'record')))
        ? budget.copy(input)
        : input;
    const opened = await open(owned);
    const body = opened.record;
    const marker = object(body) ? Object.getOwnPropertyDescriptor(body, 'format') : undefined;
    if (
      !object(body) ||
      !marker ||
      !('value' in marker) ||
      typeof marker.value !== 'string' ||
      !marker.value.startsWith('agentfootprint.context-recording.')
    )
      return { recording: body, calls: [] };
    if (marker.value !== 'agentfootprint.context-recording.v1' || !opened.values)
      throw new ContextRecordingError('invalid-record');
    const admitted = (owned !== input && (body === owned || body === ownValue(owned, 'record'))
      ? body
      : budget.copy(body)) as unknown as ContextRecordingBody;
    if (
      !Array.isArray(admitted.referencePaths) ||
      admitted.referencePaths.length > 100_000 ||
      !Array.isArray(admitted.calls) ||
      admitted.calls.length > 10_000 ||
      !integer(admitted.droppedEvents) ||
      !integer(admitted.firstRetainedEventIndex)
    )
      throw new ContextRecordingError('invalid-record');
    const recording = admitted.recording;
    if (!object(recording) || !Array.isArray(recording.events))
      throw new ContextRecordingError('invalid-record');
    const leaves = new Set<string>();
    const ancestors = new Set<string>();
    for (const path of admitted.referencePaths) {
      if (!Array.isArray(path) || path.length === 0 || path.length > 100)
        throw new ContextRecordingError('invalid-record');
      const spelling = JSON.stringify(path);
      if (leaves.has(spelling) || ancestors.has(spelling))
        throw new ContextRecordingError('invalid-record');
      for (let i = 0; i < path.length; i++) {
        const prefix = JSON.stringify(path.slice(0, i));
        if (leaves.has(prefix)) throw new ContextRecordingError('invalid-record');
        ancestors.add(prefix);
      }
      leaves.add(spelling);
      let parent: unknown = recording;
      for (const [i, key] of path.entries()) {
        if (
          (typeof key !== 'string' && !integer(key)) ||
          parent === null ||
          typeof parent !== 'object' ||
          (Array.isArray(parent)
            ? !integer(key) || key >= parent.length
            : typeof key !== 'string') ||
          !Object.hasOwn(parent, key)
        )
          throw new ContextRecordingError('invalid-record');
        const next: unknown = Reflect.get(parent, key);
        if (i === path.length - 1) {
          if (
            !object(next) ||
            Object.keys(next).length !== 1 ||
            !Object.hasOwn(next, 'ref') ||
            typeof next.ref !== 'string'
          )
            throw new ContextRecordingError('invalid-record');
          const resolved = budget.copy(opened.values.resolve(next));
          Object.defineProperty(parent, key, {
            value: resolved,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else parent = next;
      }
    }
    const previous = new Map<string, { ids: string[]; call: number }>();
    let lastIndex = -1;
    const changes: readonly ContextCallChange[] = admitted.calls;
    for (const change of changes) {
      validateCall(change);
      if (
        change.eventIndex <= lastIndex ||
        change.eventIndex >= recording.events.length + changes.length
      )
        throw new ContextRecordingError('invalid-record');
      lastIndex = change.eventIndex;
      const owner = contextOwner(change.meta);
      const prior = previous.get(owner);
      if (change.call !== (prior?.call ?? 0) + 1) throw new ContextRecordingError('invalid-record');
      const ids = applyContextChange(prior?.ids ?? [], change);
      if (Object.values(change.counts).reduce((a, b) => a + b, 0) !== ids.length)
        throw new ContextRecordingError('invalid-record');
      for (const id of ids) opened.values.resolve({ ref: id });
      previous.set(owner, { ids, call: change.call });
    }
    return {
      recording,
      calls: admitted.calls,
      values: opened.values,
      droppedEvents: admitted.droppedEvents,
      firstRetainedEventIndex: admitted.firstRetainedEventIndex,
    };
  } catch (error) {
    throw contextRefusal(error);
  }
}

function validateCall(change: ContextCallChange): void {
  if (
    !object(change) ||
    !contextMeta(change.meta) ||
    !integer(change.iteration) ||
    !integer(change.eventIndex) ||
    !integer(change.call) ||
    change.call === 0 ||
    !integer(change.unchanged) ||
    !strings(change.added) ||
    !strings(change.removed) ||
    !object(change.counts) ||
    !Object.values(change.counts).every(integer) ||
    (change.order !== undefined && (!Array.isArray(change.order) || !change.order.every(integer)))
  )
    throw new ContextRecordingError('invalid-record');
}

/** Only own data descriptors participate in format detection, never getters. */
function ownValue(value: unknown, key: string): unknown {
  if (!object(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function hasContextMarker(value: unknown): boolean {
  const marker = ownValue(value, 'format');
  return typeof marker === 'string' && marker.startsWith('agentfootprint.context-recording.');
}
