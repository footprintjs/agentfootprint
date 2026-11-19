import { prefix, type Path, type ShapeKind } from './value.js';

/** The recorded JSON type, with its element count when it is an array. */
export type RecordedContextShape =
  | readonly [type: Exclude<ShapeKind, 'array' | 'deleted'>]
  | readonly [type: 'array', length: number];

const unavailable: RecordedContextShape = Object.freeze(['unknown']);

function readEntries(
  entries: unknown,
  path: Path,
  previous: RecordedContextShape,
): RecordedContextShape | undefined {
  if (!Array.isArray(entries)) return undefined;
  let result = previous;
  for (const entry of entries) {
    if (!Array.isArray(entry)) return undefined;
    const [address, kind, length] = entry;
    if (
      !Array.isArray(address) ||
      !address.length ||
      !address.every((key) => typeof key === 'string')
    )
      return undefined;
    const matches = path.length === address.length && prefix(path, address);
    if (kind === 'array') {
      if (entry.length !== 3 || !Number.isSafeInteger(length) || length < 0 || length > 0xffffffff)
        return undefined;
      if (matches) result = ['array', length];
    } else {
      if (entry.length !== 2) return undefined;
      switch (kind) {
        case 'unknown':
        case 'deleted':
          if (matches) result = unavailable;
          break;
        case 'object':
        case 'string':
        case 'number':
        case 'null':
        case 'boolean':
          if (matches) result = [kind];
          break;
        default:
          return undefined;
      }
    }
  }
  return result;
}

/**
 * Read one path from the compact versioned index without loading the recorded values.
 * Commit -1 selects the initial state. Later commits include every change through
 * that position. A missing or unreadable index yields `['unknown']`, as does
 * a missing, deleted, hidden or undescribed value.
 * Use exact path segments so a key containing a dot remains a single key.
 */
export function contextShapeAt(
  index: unknown,
  commitIdx: number,
  path: readonly string[],
): RecordedContextShape {
  if (!index || typeof index !== 'object' || !Number.isSafeInteger(commitIdx) || commitIdx < -1)
    return unavailable;
  const wire = index as { version?: unknown; initial?: unknown; changes?: unknown };
  if (wire.version !== 1 || !Array.isArray(wire.changes)) return unavailable;
  let shape = readEntries(wire.initial, path, unavailable);
  if (!shape) return unavailable;
  if (commitIdx === -1) return shape;
  let last = -1;
  for (const frame of wire.changes) {
    if (!Array.isArray(frame) || frame.length !== 2) return unavailable;
    const [position, entries] = frame;
    if (!Number.isSafeInteger(position) || position <= last) return unavailable;
    last = position;
    // Later entries need no decoding, but an out-of-order frame could hide a change.
    if (position > commitIdx) continue;
    shape = readEntries(entries, path, shape);
    if (!shape) return unavailable;
  }
  return shape;
}
