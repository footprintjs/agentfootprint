import { toWireJson } from '../../../lib/wireJson.js';
import type { Recording } from '../recordRun.js';
import { contextChange, contextOwner } from './changes.js';
import { exportContext } from './chart.js';
import { contextMeta } from './meta.js';
import {
  ContextRecordingError,
  type ContextCallChange,
  type ContextValueRecording,
  type ContextValueWriter,
  type ValuePath,
} from './types.js';

/** A deterministic lookup key, NOT a digest or a claim of canonical JSON. */
const lookup = (value: unknown): string => JSON.stringify(value);

/**
 * Format a captured run. The only call facts read are complete source-time
 * frames; there is no join against a latest runner, slot timing or replay.
 * The adapter is the sole owner of hashing, admission, redaction and limits.
 */
export async function writeContextRecording(
  input: Recording,
  values: ContextValueWriter,
  droppedEvents: number,
  firstRetainedEventIndex: number,
): Promise<ContextValueRecording> {
  // Exactly the existing recording's wire semantics (including Errors).
  // Snapshot before the first await: later runner/caller mutation cannot change it.
  const recording = JSON.parse(toWireJson(input)) as Recording;
  return exportContext(() =>
    encodeContext(recording, values, droppedEvents, firstRetainedEventIndex),
  );
}

async function encodeContext(
  recording: Recording,
  values: ContextValueWriter,
  droppedEvents: number,
  firstRetainedEventIndex: number,
): Promise<ContextValueRecording> {
  const targets = new Map<string, string>();
  const texts = new Map<string, string>();
  const schemaNames = new Set<string>();
  const calls: ContextCallChange[] = [];
  const previous = new Map<string, { ids: string[]; call: number }>();
  const captured = new Map<string, number>();
  const callAddress = (event: Recording['events'][number], iteration: number): string =>
    JSON.stringify([event.meta.runId, event.meta.runtimeStageId, iteration]);
  for (const [eventIndex, event] of recording.events.entries()) {
    if (event.type !== 'agentfootprint.context.recorded') continue;
    if (
      event.payload.omission !== undefined ||
      !Number.isSafeInteger(event.payload.iteration) ||
      event.payload.iteration === undefined ||
      event.payload.iteration < 0
    )
      throw new ContextRecordingError('capture-unavailable');
    if (!contextMeta(event.meta)) throw new ContextRecordingError('capture-unavailable');
    const address = callAddress(event, event.payload.iteration);
    captured.set(address, (captured.get(address) ?? 0) + 1);
    const ids: string[] = [];
    const counts: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const piece of event.payload.pieces) {
      const value = piece.schema !== undefined ? piece.schema : piece.rawContent;
      if (value === undefined) throw new ContextRecordingError('invalid-record');
      const key = lookup(value);
      let id = targets.get(key);
      if (id === undefined) {
        const result = await values.intern(
          piece.schema === undefined ? 'context.text' : 'tool.schema',
          value,
        );
        if (result.status === 'omitted') throw new ContextRecordingError('value-omitted');
        id = result.reference.ref;
        targets.set(key, id);
        if (typeof value === 'string') texts.set(value, id);
        else if (
          value !== null &&
          typeof value === 'object' &&
          'name' in value &&
          typeof value.name === 'string'
        )
          schemaNames.add(value.name);
      }
      ids.push(id);
      const source = piece.schema !== undefined ? 'tools' : piece.source;
      counts[source] = (counts[source] ?? 0) + 1;
    }
    // The source supplied native run identity and component ancestry. Never
    // parse a run-id spelling or borrow the currently selected runner's id.
    const owner = contextOwner(event.meta);
    const prior = previous.get(owner);
    const call = (prior?.call ?? 0) + 1;
    calls.push({
      meta: event.meta,
      iteration: event.payload.iteration,
      eventIndex,
      call,
      ...contextChange(prior?.ids ?? [], ids),
      counts,
    });
    previous.set(owner, { ids, call });
  }

  const referencePaths: ValuePath[] = [];
  for (const event of recording.events) {
    if (event.type !== 'agentfootprint.stream.llm_start') continue;
    const address = callAddress(event, event.payload.iteration);
    const count = captured.get(address) ?? 0;
    if (count === 0) throw new ContextRecordingError('capture-unavailable');
    captured.set(address, count - 1);
  }
  const encode = (value: unknown, path: ValuePath): unknown => {
    // Strings are looked up directly. Only possible schemas are serialized;
    // serializing every ancestor would make a long log quadratic to encode.
    const id =
      typeof value === 'string'
        ? texts.get(value)
        : value !== null &&
          typeof value === 'object' &&
          'name' in value &&
          typeof value.name === 'string' &&
          schemaNames.has(value.name)
        ? targets.get(lookup(value))
        : undefined;
    if (id !== undefined) {
      referencePaths.push(path);
      return { ref: id };
    }
    if (Array.isArray(value)) return value.map((item, i) => encode(item, [...path, i]));
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        Object.defineProperty(result, key, {
          value: encode(item, [...path, key]),
          enumerable: true,
        });
      }
      return result;
    }
    return value;
  };
  return values.record({
    format: 'agentfootprint.context-recording.v1' as const,
    // Frames are an ephemeral capture channel. The saved call record is the
    // change list above, rather than another full per-call list of references.
    // All pre-existing timeline events retain their original order and data.
    recording: encode(
      {
        ...recording,
        events: recording.events.filter(
          (event) => event.type !== 'agentfootprint.context.recorded',
        ),
      },
      [],
    ),
    referencePaths,
    calls,
    droppedEvents,
    firstRetainedEventIndex,
  });
}
