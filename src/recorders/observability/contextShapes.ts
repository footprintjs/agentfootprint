import { stateAt, type FoldSource } from 'foottrace';
import { ShapeBook } from './contextShapes/book.js';
import type { ContextShapeIndex, ContextShapeOptions, ShapeEntry } from './contextShapes/value.js';
export type { ContextShapeIndex, ContextShapeOptions, ShapeEntry } from './contextShapes/value.js';

interface Source {
  readonly runId?: string;
  readonly initialState?: unknown;
  readonly commitLog?: readonly unknown[];
  readonly contextShapes?: unknown;
}
function strip<T>(source: T): T {
  if (
    !source ||
    typeof source !== 'object' ||
    !Object.prototype.hasOwnProperty.call(source, 'contextShapes')
  )
    return source;
  const { contextShapes: _discard, ...rest } = source as T & Source;
  return rest as T;
}

// Only a native serving boundary can vouch for append-only, detached history.
// Object.freeze on a consumer-constructed snapshot says nothing about children.
const nativeSources = new WeakSet<object>();
export function markNativeShapeSource<T>(snapshot: T): T {
  if (snapshot && typeof snapshot === 'object') nativeSources.add(snapshot);
  return snapshot;
}

/** Capture additions to the native, policy-served commit log as snapshots are
 * produced. A stopped, replaced, or mutable log never borrows another log's facts. */
export function createContextShapeCapture(options: ContextShapeOptions | false = {}) {
  let cached:
    | {
        base: object;
        runId: string;
        log: readonly unknown[];
        book: ShapeBook;
        index: ContextShapeIndex;
      }
    | undefined;
  function capture<T>(
    snapshot: T,
    source?: unknown,
  ): T extends object ? T & { readonly contextShapes?: ContextShapeIndex } : T;
  function capture(snapshot: unknown, source: unknown = snapshot): unknown {
    if (!options || !snapshot || typeof snapshot !== 'object') return strip(snapshot);
    const { initialState: base, commitLog: log, runId } = snapshot as Source;
    if (!base || typeof base !== 'object' || Array.isArray(base) || !Array.isArray(log))
      return strip(snapshot);
    const native = source !== null && typeof source === 'object' && nativeSources.has(source);
    const resume =
      native &&
      cached &&
      Object.isFrozen(base) &&
      cached.base === base &&
      cached.runId === runId &&
      cached.log.length <= log.length &&
      (cached.log === log || cached.log.every((row, i) => row === log[i]));
    if (resume && cached!.log === log) return { ...snapshot, contextShapes: cached!.index };
    let cacheable =
      native && typeof runId === 'string' && Object.isFrozen(base) && Object.isFrozen(log);
    const book = resume ? cached!.book : new ShapeBook(options);
    if (!resume) book.seed(base);
    const initial = resume ? cached!.index.initial : book.take();
    const additions: (readonly [number, readonly ShapeEntry[]])[] = [];
    for (let i = resume ? cached!.log.length : 0; i < log.length; i++) {
      if (cacheable && !Object.isFrozen(log[i])) cacheable = false;
      if (!book.commit(log[i], () => stateAt(snapshot as FoldSource, i).state)) {
        cached = undefined;
        return strip(snapshot);
      }
      const changed = book.take();
      if (changed.length) additions.push(Object.freeze([i, changed] as const));
    }
    const index: ContextShapeIndex =
      resume && !additions.length
        ? cached!.index
        : Object.freeze({
            version: 1,
            initial,
            changes: Object.freeze([...(resume ? cached!.index.changes : []), ...additions]),
          });
    cached = cacheable && typeof runId === 'string' ? { base, runId, log, book, index } : undefined;
    return { ...snapshot, contextShapes: index };
  }
  return capture;
}
