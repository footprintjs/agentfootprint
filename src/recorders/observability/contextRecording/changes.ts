import { toWireJson } from '../../../lib/wireJson.js';
import { ContextRecordingError, type ContextCallChange } from './types.js';

/** Native address tuple; sibling mounts share a run id but never this path. */
export const contextOwner = (meta: ContextCallChange['meta']): string =>
  toWireJson([meta.runId, meta.compositionPath, meta.subflowPath]);

/** Exact multiset delta. A permutation is carried only when order changed. */
export function contextChange(previous: readonly string[], current: readonly string[]) {
  const remaining = new Map<string, number>();
  for (const id of current) remaining.set(id, (remaining.get(id) ?? 0) + 1);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const id of previous) {
    const count = remaining.get(id) ?? 0;
    if (count > 0) {
      kept.push(id);
      remaining.set(id, count - 1);
    } else removed.push(id);
  }
  const additions = new Map<string, number>(remaining);
  const added: string[] = [];
  for (const id of current) {
    const count = additions.get(id) ?? 0;
    if (count > 0) {
      added.push(id);
      additions.set(id, count - 1);
    }
  }
  const candidates = [...kept, ...added];
  const positions = new Map<string, number[]>();
  candidates.forEach((id, i) => {
    const list = positions.get(id) ?? [];
    list.push(i);
    positions.set(id, list);
  });
  const order = current.map((id) => positions.get(id)!.shift()!);
  return {
    added,
    removed,
    unchanged: kept.length,
    ...(order.some((index, i) => index !== i) ? { order } : {}),
  };
}

/** Expand one delta without guessing order or losing duplicate occurrences. */
export function applyContextChange(
  previous: readonly string[],
  change: Pick<ContextCallChange, 'added' | 'removed' | 'unchanged' | 'order'>,
): string[] {
  const retained = [...previous];
  for (const id of change.removed) {
    // The writer keeps the earliest occurrences. Removing from the end
    // preserves their order when equal ids straddle a different piece.
    const i = retained.lastIndexOf(id);
    if (i < 0) throw new ContextRecordingError('invalid-record');
    retained.splice(i, 1);
  }
  if (retained.length !== change.unchanged) throw new ContextRecordingError('invalid-record');
  const candidates = [...retained, ...change.added];
  if (change.order === undefined) return candidates;
  if (
    change.order.length !== candidates.length ||
    new Set(change.order).size !== candidates.length ||
    change.order.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= candidates.length)
  )
    throw new ContextRecordingError('invalid-record');
  return change.order.map((i) => candidates[i]);
}
