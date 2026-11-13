import type { EventMeta } from '../../../events/types.js';

/** The value-table port; foottrace's createValueTable() implements this shape. */
export interface ContextValueWriter {
  /** Values are ALREADY served. The adapter must preserve that value exactly. */
  intern(
    label: string,
    value: unknown,
  ): Promise<
    | { readonly status: 'stored'; readonly reference: { readonly ref: string } }
    | { readonly status: 'omitted'; readonly reason: string }
  >;
  record<T>(record: T): {
    readonly format: 'foottrace.value-record.v1';
    readonly record: T;
    readonly valueTable: unknown;
  };
}

/** A content change in ONE native run/component, not a provider attempt. */
export interface ContextCallChange {
  readonly meta: EventMeta;
  readonly iteration: number;
  /** Original retained event position of the captured logical call. */
  readonly eventIndex: number;
  readonly call: number;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: number;
  /** Only present for an order change; indexes into kept-previous + added. */
  readonly order?: readonly number[];
  readonly counts: Readonly<Record<string, number>>;
}

export type ValuePath = readonly (string | number)[];

/** Only the positions listed here are references. Literal {ref: ...} is data. */
export interface ContextRecordingBody {
  readonly format: 'agentfootprint.context-recording.v1';
  readonly recording: unknown;
  readonly referencePaths: readonly ValuePath[];
  readonly calls: readonly ContextCallChange[];
  readonly droppedEvents: number;
  readonly firstRetainedEventIndex: number;
}

export interface ContextValueRecording {
  readonly format: 'foottrace.value-record.v1';
  readonly record: ContextRecordingBody;
  readonly valueTable: unknown;
}

export interface ContextValueReader {
  /** Resolve ONE explicit reference; never reinterpret the stored value. */
  resolve(reference: unknown): unknown;
}

/** foottrace's readValueRecord is the adapter for this port. */
export type OpenContextValues = (input: unknown) => Promise<{
  readonly record: unknown;
  readonly values?: ContextValueReader;
}>;

export interface ReadContextRecording {
  /** Decoded wire data. The consuming recording reader validates its semantics. */
  readonly recording: unknown;
  readonly calls: readonly ContextCallChange[];
  readonly values?: ContextValueReader;
  /** Absent for an old record that never carried capture/drop evidence. */
  readonly droppedEvents?: number;
  readonly firstRetainedEventIndex?: number;
}

/** Fixed, payload-free refusal. An incomplete table never produces a record. */
export class ContextRecordingError extends Error {
  constructor(
    readonly reason: 'value-omitted' | 'invalid-record' | 'limit' | 'capture-unavailable',
  ) {
    super(`Context recording refused: ${reason}`);
    this.name = 'ContextRecordingError';
  }
}

/** Never rethrow an adapter's Error instance or read its arbitrary message. */
export function contextRefusal(error: unknown): ContextRecordingError {
  let reason: ContextRecordingError['reason'] = 'invalid-record';
  try {
    if (error !== null && typeof error === 'object') {
      const own = Object.getOwnPropertyDescriptor(error, 'reason');
      if (
        own &&
        'value' in own &&
        (own.value === 'limit' ||
          own.value === 'value-omitted' ||
          own.value === 'capture-unavailable')
      )
        reason = own.value;
    }
  } catch {
    /* A hostile adapter remains a fixed refusal. */
  }
  return new ContextRecordingError(reason);
}
