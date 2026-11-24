import { isExecutionKey } from 'foottrace';
import { walkSubflowSpec } from 'footprintjs/trace';
import { ALL_EVENT_TYPES } from '../../events/registry.js';
import { measureBoundedJson, ownData, type JsonSizeBranch } from '../../lib/boundedJson.js';
import type { Recording } from './recordRun.js';

/** Bytes of the value body, excluding its enclosing key and separators. */
export interface RecordingSizeRow {
  readonly name: string;
  readonly bytes: number;
  /** Immediate array items or object fields, or one scalar. Event rows count occurrences. */
  readonly count: number;
}

/** Flat snapshot fields. Framing accounts for their keys, commas and enclosing braces. */
export interface RecordingSizeFields {
  readonly bytes: number;
  readonly framingBytes: number;
  readonly fields: readonly RecordingSizeRow[];
}

/** A physically stored subflow entry. A latest-path alias can duplicate a mount. */
export interface RecordingSizeMount extends RecordingSizeRow {
  readonly kind: 'mount' | 'path-alias';
  /** Commit history length, or null when the stored entry has no history array. */
  readonly commitCount: number | null;
}

/** Compact UTF-8 size of the served recording, including JSON framing. */
export interface RecordingSizeReport {
  readonly bytes: number;
  readonly framingBytes: number;
  readonly snapshot?: RecordingSizeFields & {
    readonly sharedState?: RecordingSizeFields;
    readonly subflows?: {
      readonly bytes: number;
      readonly framingBytes: number;
      readonly entries: readonly RecordingSizeMount[];
    };
  };
  readonly events: {
    readonly bytes: number;
    readonly framingBytes: number;
    readonly count: number;
    readonly types: readonly RecordingSizeRow[];
  };
  /** Number of stages in a built chart, or null when the structure has no recognizable root. */
  readonly structure?: { readonly bytes: number; readonly count: number | null };
}

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 256;
const MAX_ROWS = 16_384;
const MAX_NAME_LENGTH = 1024;
const knownEventTypes = new Set<string>(ALL_EVENT_TYPES);

/**
 * Measure a plain, already-served recording such as a parsed `recording/run`
 * artifact. The input is JSON data, and a packed recording must first be read
 * with `unpackRecording`. Sizes are for compact UTF-8 JSON, independent
 * of whitespace or compression in storage. Each section's bytes include its
 * own framing. A nested breakdown describes bytes already counted by its
 * parent. Latest-path aliases count separately because the JSON stores them.
 *
 * The report returns structural names, counts and sizes. It contains no
 * recorded values. Names can be application-defined, so use this diagnostic
 * on a recording you are authorized to inspect before deciding what to share.
 * It refuses non-JSON data, more than 64 MiB of expanded JSON, nesting past
 * 256 levels, or an oversized names table, without returning partial totals.
 *
 * @param recording - Plain JSON data from a served recording.
 */
export function recordingSizeReport(recording: Recording): RecordingSizeReport {
  try {
    return measureRecording(recording);
  } catch {
    // The caller may handle an invalid record's error outside its privacy boundary.
    throw new TypeError(
      'Expected plain recording JSON within 64 MiB, 256 levels and the diagnostic names table limits.',
    );
  }
}

const members = ['snapshot', 'events', 'structure'] as const;

function measureRecording(recording: Recording): RecordingSizeReport {
  const root = ownData(recording, members);
  if (!Array.isArray(root.events)) throw new TypeError('Expected a recording event array.');
  // A recordRun handle can have no snapshot yet. JSON omits that root field.
  const data = {
    ...(root.snapshot !== undefined && { snapshot: root.snapshot }),
    events: root.events,
    ...(root.structure !== undefined && { structure: root.structure }),
  };
  const snapshotFields = sizeTable<RecordingSizeRow>();
  const state = sizeTable<RecordingSizeRow>();
  const subflows = sizeTable<RecordingSizeMount>();
  const eventTypes = new Map<string, { name: string; bytes: number; count: number }>();
  let eventBytes = 0;
  let structure: RecordingSizeReport['structure'];
  let reportRows = 0;

  const named = (key: string | number): string => {
    if (typeof key !== 'string' || key.length > MAX_NAME_LENGTH || ++reportRows > MAX_ROWS) {
      throw new RangeError('Recording size report has too many or oversized names.');
    }
    return key;
  };

  const events: JsonSizeBranch = {
    child: (_index, value) => ({
      measured: (bytes) => {
        const type = ownField(value, 'type');
        const name = typeof type === 'string' && knownEventTypes.has(type) ? type : 'other';
        const group = eventTypes.get(name);
        if (group === undefined) eventTypes.set(name, { name, bytes, count: 1 });
        else {
          group.bytes += bytes;
          group.count++;
        }
      },
    }),
    measured: (bytes) => {
      eventBytes = bytes;
    },
  };

  const snapshot = snapshotFields.branch((key, value) => {
    const name = named(key);
    const breakdown = snapshotBreakdown(name, value);
    return {
      child: breakdown?.child,
      measured: (bytes) => {
        breakdown?.measured?.(bytes);
        snapshotFields.rows.push(row(name, value, bytes));
      },
    };
  });

  function snapshotBreakdown(name: string, value: unknown): JsonSizeBranch | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if (name === 'sharedState') {
      return state.branch((key, value) => {
        const name = named(key);
        return {
          measured: (bytes) => {
            state.rows.push(row(name, value, bytes));
          },
        };
      });
    }
    if (name === 'subflowResults') {
      return subflows.branch((key, value) => {
        const name = named(key);
        return {
          measured: (bytes) => {
            const history = ownField(ownField(value, 'treeContext'), 'history');
            subflows.rows.push({
              ...row(name, value, bytes),
              kind: isExecutionKey(name) ? 'mount' : 'path-alias',
              commitCount: Array.isArray(history) ? history.length : null,
            });
          },
        };
      });
    }
    return undefined;
  }

  const bytes = measureBoundedJson(data, MAX_BYTES, MAX_DEPTH, {
    child: (key, value) => {
      if (key === 'events') return events;
      if (key === 'snapshot') return snapshot;
      return {
        measured: (bytes) => {
          structure = { bytes, count: stageCount(value) };
        },
      };
    },
  });

  const types = [...eventTypes.values()];
  return {
    bytes,
    framingBytes: bytes - snapshotFields.bytes - eventBytes - (structure?.bytes ?? 0),
    ...(data.snapshot !== undefined && {
      snapshot: {
        ...snapshotFields.size(),
        fields: snapshotFields.rows,
        ...(state.bytes > 0 && { sharedState: { ...state.size(), fields: state.rows } }),
        ...(subflows.bytes > 0 && { subflows: { ...subflows.size(), entries: subflows.rows } }),
      },
    }),
    events: {
      bytes: eventBytes,
      framingBytes: eventBytes - valueBytes(types),
      count: root.events.length,
      types,
    },
    ...(structure !== undefined && { structure }),
  };
}

function valueBytes(rows: readonly RecordingSizeRow[]): number {
  return rows.reduce((total, row) => total + row.bytes, 0);
}

function sizeTable<Row extends RecordingSizeRow>() {
  const rows: Row[] = [];
  let bytes = 0;
  return {
    rows,
    get bytes() {
      return bytes;
    },
    branch(child: NonNullable<JsonSizeBranch['child']>): JsonSizeBranch {
      return {
        child,
        measured: (size) => {
          bytes = size;
        },
      };
    },
    size() {
      return { bytes, framingBytes: bytes - valueBytes(rows) };
    },
  };
}

function row(name: string, value: unknown, bytes: number): RecordingSizeRow {
  const count = Array.isArray(value)
    ? value.length
    : value !== null && typeof value === 'object'
    ? Object.keys(value).length
    : 1;
  return { name, bytes, count };
}

function ownField(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

function stageCount(value: unknown): number | null {
  if (typeof ownField(value, 'id') !== 'string' || typeof ownField(value, 'name') !== 'string') {
    return null;
  }
  let count = 0;
  for (const item of walkSubflowSpec(value as Parameters<typeof walkSubflowSpec>[0], '')) {
    if (item.kind === 'stage') count++;
  }
  return count;
}
