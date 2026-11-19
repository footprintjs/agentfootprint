import { isCommitBundle } from 'foottrace';
import { isDeniedSegment, pathSegments } from 'foottrace/paths';
import {
  arrayIndex,
  classify,
  deleted,
  lookup,
  missing,
  prefix,
  unknown,
  type ContextShapeOptions,
  type Path,
  type Shape,
  type ShapeEntry,
} from './value.js';

import { ShapeRedactions } from './redactions.js';

interface Node {
  shape?: Shape;
  parent?: Node;
  key?: string;
  children: Map<string, Node>;
}
const node = (parent?: Node, key?: string): Node => ({ parent, key, children: new Map() });
const known = (shape: Shape) => shape[0] !== 'unknown' && shape[0] !== 'deleted';

/** Tracks only shapes, never a second copy of the heap. A path replacement also
 * invalidates previously captured descendants at that same slider position. */
export class ShapeBook {
  private readonly root = node();
  private readonly present = new Set<string>();
  private readonly masks = new ShapeRedactions();
  private pending = new Map<Node, { path: Path; before?: Shape }>();
  constructor(private readonly options: ContextShapeOptions) {}

  private at(path: Path): Node {
    let current = this.root;
    for (const key of path) {
      let child = current.children.get(key);
      if (!child) current.children.set(key, (child = node(current, key)));
      current = child;
    }
    return current;
  }
  private set(path: Path, shape: Shape, target = this.at(path)): void {
    if (target.shape?.[0] === shape[0] && target.shape?.[1] === shape[1]) return;
    if (!this.pending.has(target)) this.pending.set(target, { path, before: target.shape });
    target.shape = shape;
  }
  private forgetChildren(path: Path, target: Node): void {
    for (const [key, child] of target.children) {
      const next = [...path, key];
      if (child.shape) this.set(next, unknown, child);
      this.forgetChildren(next, child);
    }
  }
  private sample(path: Path, value: unknown, ancestry: Set<object>): void {
    const shape = this.masks.hides(path) ? unknown : classify(value);
    this.set(path, shape);
    if (
      this.options.scan !== 'full' ||
      (shape[0] !== 'object' && shape[0] !== 'array') ||
      this.masks.hidesChildren(path)
    )
      return;
    const object = value as object;
    if (ancestry.has(object)) return;
    ancestry.add(object);
    for (const key of Object.keys(object)) {
      if (Array.isArray(object) && arrayIndex(key) === undefined) continue;
      this.sample([...path, key], lookup(object, [key]), ancestry);
    }
    ancestry.delete(object);
  }
  private observe(path: Path, value: unknown): void {
    this.sample(path, value, new Set());
    if (this.options.scan === 'full') return;
    for (const watched of this.options.paths ?? []) {
      if (watched.length > path.length && prefix(path, watched))
        this.set(
          watched,
          this.masks.hides(watched) ? unknown : classify(lookup(value, watched.slice(path.length))),
        );
    }
  }
  seed(base: object): void {
    for (const key of Object.keys(base)) {
      this.present.add(key);
      this.observe([key], lookup(base, [key]));
    }
  }
  /** Account for the parents a native write traverses. Return the target only
   * if its shape can be observed at this path. */
  private prepareWrite(path: Path, deleting: boolean, absentRoot: boolean): Node | undefined {
    if (deleting && path.length === 1) this.present.delete(path[0]);
    else if (!deleting) this.present.add(path[0]);
    for (let i = 1; i < path.length; i++) {
      const parent = path.slice(0, i);
      const holder = this.at(parent);
      if (holder.shape?.[0] === 'array') {
        const index = arrayIndex(path[i]);
        if (index === undefined) {
          if (path[i] === 'length' && !deleting) {
            this.forgetChildren(parent, holder);
            this.set(parent, unknown, holder);
          }
          return undefined;
        }
        if (!deleting) this.set(parent, ['array', Math.max(holder.shape[1]!, index + 1)], holder);
      } else if (!deleting) {
        // A named property written onto an unmeasured container could be an
        // array decoration, which does not survive JSON. Numeric paths work
        // for both arrays and objects; other paths need a proven container.
        if (
          !absentRoot &&
          (!holder.shape || holder.shape[0] === 'unknown') &&
          arrayIndex(path[i]) === undefined
        ) {
          const target = this.at(path);
          this.forgetChildren(path, target);
          this.set(path, unknown, target);
          return undefined;
        }
        if (this.masks.hides(parent)) this.set(parent, unknown, holder);
        else if (
          absentRoot ||
          (holder.shape && known(holder.shape) && holder.shape[0] !== 'object')
        )
          this.set(parent, ['object'], holder);
      }
    }
    const target = this.at(path);
    if (!this.masks.hides(path)) return target;
    this.forgetChildren(path, target);
    this.set(path, unknown, target);
    return undefined;
  }
  private append(path: Path, target: Node, absentRoot: boolean, tail: unknown): void {
    const before = target.shape;
    if (before?.[0] !== 'array' || !Array.isArray(tail)) {
      this.forgetChildren(path, target);
      // The native append concatenates only when both operands are arrays.
      // An unmeasured predecessor leaves an array tail's final positions unknown.
      if (Array.isArray(tail) && !absentRoot && (!before || before[0] === 'unknown'))
        this.set(path, unknown, target);
      else this.observe(path, tail);
      return;
    }
    const start = before[1]!;
    this.set(path, ['array', start + tail.length], target);
    if (this.masks.hidesChildren(path)) return;
    if (this.options.scan === 'full') {
      for (const key of Object.keys(tail)) {
        const index = arrayIndex(key);
        if (index !== undefined)
          this.sample([...path, String(start + index)], lookup(tail, [key]), new Set());
      }
    } else {
      for (const watched of this.options.paths ?? []) {
        if (watched.length <= path.length || !prefix(path, watched)) continue;
        const index = arrayIndex(watched[path.length]);
        if (index !== undefined && index >= start && index < start + tail.length)
          this.set(
            watched,
            this.masks.hides(watched)
              ? unknown
              : classify(lookup(tail, [String(index - start), ...watched.slice(path.length + 1)])),
          );
      }
    }
  }
  commit(bundle: unknown, folded: () => object): boolean {
    if (!isCommitBundle(bundle)) return false;
    if (
      bundle.redactedPaths !== undefined &&
      (!Array.isArray(bundle.redactedPaths) ||
        !bundle.redactedPaths.every((path) => typeof path === 'string'))
    )
      return false;
    for (const mask of this.masks.advance(bundle.trace, bundle.redactedPaths ?? [])) {
      const at = this.at(mask.path);
      this.forgetChildren(mask.path, at);
      if (!mask.childrenOnly) this.set(mask.path, unknown, at);
    }
    // A full scan resolves merged array cardinality against the native fold.
    // Its rows still pass through the same switch before we trust the result.
    const foldedRoots =
      this.options.scan === 'full' && bundle.trace.some((row) => row.verb === 'merge')
        ? new Set<string>()
        : undefined;
    for (const { path: encoded, verb } of bundle.trace) {
      const path = pathSegments(encoded);
      const valid = path.length > 0 && !path.some(isDeniedSegment);
      if (valid && foldedRoots) foldedRoots.add(path[0]);
      const absentRoot = !this.present.has(path[0]);
      const target =
        valid && !foldedRoots ? this.prepareWrite(path, verb === 'delete', absentRoot) : undefined;
      if (target && verb !== 'append') this.forgetChildren(path, target);
      switch (verb) {
        case 'set':
          // The recorded value is complete. Read its type without cloning it.
          if (target) this.observe(path, lookup(bundle.overwrite, path));
          break;
        case 'delete':
          if (target) this.set(path, deleted, target);
          break;
        case 'append':
          if (target) this.append(path, target, absentRoot, lookup(bundle.overwrite, path));
          break;
        case 'merge':
          if (target) {
            const delta = classify(lookup(bundle.updates, path));
            const before = target.shape;
            // Deduplication against an unknown base requires an array scan.
            this.set(
              path,
              delta[0] === 'array' &&
                delta[1] !== 0 &&
                !absentRoot &&
                (!before || before[0] === 'array' || before[0] === 'unknown')
                ? unknown
                : delta,
              target,
            );
          }
          break;
        default:
          verb satisfies never;
          return false;
      }
    }
    if (foldedRoots?.size) {
      const state = folded();
      for (const root of foldedRoots) {
        const path = [root];
        this.forgetChildren(path, this.at(path));
        const value = lookup(state, path);
        if (value === missing) this.present.delete(root);
        else this.present.add(root);
        this.observe(path, value);
      }
    }
    return true;
  }
  take(): readonly ShapeEntry[] {
    const entries: ShapeEntry[] = [];
    for (const [target, { path, before }] of this.pending) {
      const shape = target.shape!;
      if ((!before || !known(before)) && !known(shape)) continue;
      if (before?.[0] === shape[0] && before[1] === shape[1]) continue;
      entries.push(
        Object.freeze(
          shape[0] === 'array'
            ? ([Object.freeze([...path]), shape[0], shape[1]!] as const)
            : ([Object.freeze([...path]), shape[0]] as const),
        ),
      );
    }
    // An invalidated subtree must stop costing memory and future replacement
    // work. Prune after the commit so repeated writes share one timeline entry.
    for (let child of this.pending.keys()) {
      while (child.parent && child.children.size === 0 && (!child.shape || !known(child.shape))) {
        child.parent.children.delete(child.key!);
        child = child.parent;
      }
    }
    this.pending.clear();
    return Object.freeze(entries);
  }
}
