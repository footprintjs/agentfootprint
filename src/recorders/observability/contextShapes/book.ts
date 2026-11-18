import { isCommitBundle } from 'foottrace';
import { isDeniedSegment, pathSegments } from 'foottrace/paths';
import {
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
  private hiddenPaths: readonly Path[] = [];
  private hidden(path: Path) {
    return this.hiddenPaths.some((mask) => prefix(mask, path));
  }
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
    const shape = this.hidden(path) ? unknown : classify(value);
    this.set(path, shape);
    if (this.options.scan !== 'full' || (shape[0] !== 'object' && shape[0] !== 'array')) return;
    const object = value as object;
    if (ancestry.has(object)) return;
    ancestry.add(object);
    for (const key of Object.keys(object))
      this.sample([...path, key], lookup(object, [key]), ancestry);
    ancestry.delete(object);
  }
  private observe(path: Path, value: unknown): void {
    this.sample(path, value, new Set());
    if (this.options.scan === 'full') return;
    for (const watched of this.options.paths ?? []) {
      if (watched.length > path.length && prefix(path, watched))
        this.set(
          watched,
          this.hidden(watched) ? unknown : classify(lookup(value, watched.slice(path.length))),
        );
    }
  }
  seed(base: object): void {
    for (const key of Object.keys(base)) {
      this.present.add(key);
      this.observe([key], lookup(base, [key]));
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
    this.hiddenPaths = bundle.redactedPaths?.map(pathSegments) ?? [];
    for (const hidden of this.hiddenPaths) {
      const at = this.at(hidden);
      this.forgetChildren(hidden, at);
      this.set(hidden, unknown, at);
    }
    if (this.options.scan === 'full' && bundle.trace.some((row) => row.verb === 'merge')) {
      // Deduplication in a native array merge depends on its contents. Only
      // the explicit full-scan mode pays for the native fold in this case.
      const state = folded();
      for (const root of new Set(bundle.trace.map((row) => pathSegments(row.path)[0]))) {
        const path = [root];
        this.forgetChildren(path, this.at(path));
        const value = lookup(state, path);
        if (value === missing) this.present.delete(root);
        else this.present.add(root);
        this.observe(path, value);
      }
      return true;
    }
    for (const row of bundle.trace) {
      const path = pathSegments(row.path);
      if (!path.length || path.some(isDeniedSegment)) continue;
      const absentRoot = !this.present.has(path[0]);
      if (row.verb === 'delete' && path.length === 1) this.present.delete(path[0]);
      else if (row.verb !== 'delete') this.present.add(path[0]);
      for (let i = 1; row.verb !== 'delete' && i < path.length; i++) {
        const parent = path.slice(0, i);
        const holder = this.at(parent);
        // A string-keyed native path creates a plain object if its
        // intermediate container was a primitive. An array index assignment
        // can extend its length; deleting a property never shrinks it.
        if (this.hidden(parent)) this.set(parent, unknown);
        else if (holder.shape?.[0] === 'array') {
          const key = path[i];
          if (key === 'length') {
            this.forgetChildren(parent, holder);
            this.set(parent, unknown);
          } else {
            const index = Number(key);
            if (
              String(index) === key &&
              Number.isInteger(index) &&
              index >= 0 &&
              index < 0xffffffff
            )
              this.set(parent, ['array', Math.max(holder.shape[1]!, index + 1)]);
          }
        } else if (
          absentRoot ||
          (holder.shape && known(holder.shape) && holder.shape[0] !== 'object')
        ) {
          this.set(parent, ['object']);
        }
      }
      const target = this.at(path);
      const before = target.shape;
      const hidden = this.hidden(path);
      if (row.verb === 'append' && !hidden && before?.[0] === 'array') {
        const tail = lookup(bundle.overwrite, path);
        if (Array.isArray(tail)) {
          const start = before[1]!;
          this.set(path, ['array', start + tail.length]);
          if (this.options.scan === 'full') {
            for (const index of Object.keys(tail))
              this.sample(
                [...path, String(start + Number(index))],
                lookup(tail, [index]),
                new Set(),
              );
          } else {
            for (const watched of this.options.paths ?? []) {
              if (watched.length <= path.length || !prefix(path, watched)) continue;
              const token = watched[path.length];
              const index = Number(token);
              if (
                String(index) === token &&
                Number.isInteger(index) &&
                index >= start &&
                index < start + tail.length
              )
                this.set(
                  watched,
                  this.hidden(watched)
                    ? unknown
                    : classify(
                        lookup(tail, [String(index - start), ...watched.slice(path.length + 1)]),
                      ),
                );
            }
          }
          continue;
        }
      }
      this.forgetChildren(path, target);
      if (hidden) {
        this.set(path, unknown);
      } else if (row.verb === 'delete') {
        this.set(path, deleted);
      } else if (row.verb === 'set') {
        // Only a set operand is a complete recorded value. Inspect its type
        // in place; folding the value here would clone its entire contents.
        this.observe(path, lookup(bundle.overwrite, path));
      } else if (row.verb === 'append') {
        const tail = lookup(bundle.overwrite, path);
        const shape = classify(tail);
        if (shape[0] !== 'array') this.set(path, shape);
        else this.set(path, absentRoot || (before && before[0] !== 'unknown') ? shape : unknown);
      } else {
        const delta = classify(lookup(bundle.updates, path));
        // A nonempty array merge deduplicates against its base. Discovering
        // that cardinality would scan both arrays, so leave it unmeasured.
        this.set(
          path,
          delta[0] === 'array' &&
            delta[1] !== 0 &&
            !absentRoot &&
            (!before || before[0] === 'array' || before[0] === 'unknown')
            ? unknown
            : delta,
        );
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
