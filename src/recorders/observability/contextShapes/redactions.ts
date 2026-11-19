import { isDeniedSegment, pathSegments } from 'foottrace/paths';
import { arrayIndex, prefix, type Path } from './value.js';

type Mask = { path: Path; childrenOnly: boolean };
type Write = { readonly path: string; readonly verb: string };

/** Redactions describe retained operands. A later partial write does not make
 * earlier hidden data public. An explicit replacement/deletion starts a new
 * value at its own path. This book lives for one recorded log. */
export class ShapeRedactions {
  private masks: Mask[] = [];

  hides(path: Path): boolean {
    return this.masks.some(
      (mask) => prefix(mask.path, path) && (!mask.childrenOnly || mask.path.length < path.length),
    );
  }

  hidesChildren(path: Path): boolean {
    return this.masks.some((mask) => prefix(mask.path, path));
  }

  advance(rows: readonly Write[], redacted: readonly string[]): readonly Mask[] {
    if (!this.masks.length && !redacted.length) return [];
    const writes = rows
      .map((row) => ({ path: pathSegments(row.path), verb: row.verb }))
      .filter((write) => write.path.length && !write.path.some(isDeniedSegment));
    this.masks = this.masks.filter(
      (mask) =>
        !writes.some(
          (write) =>
            (write.verb === 'set' || write.verb === 'delete') && prefix(write.path, mask.path),
        ),
    );
    const newMasks = redacted.map((path) => ({ path: pathSegments(path), childrenOnly: false }));
    // Append operands use tail-relative indexes. Merging arrays may reorder or
    // deduplicate values. A masked position in either operand cannot vouch
    // for one particular final element. Keep the container shape when allowed.
    const uncertain: Mask[] = [];
    for (const write of writes) {
      const affecting =
        write.verb === 'append'
          ? newMasks
          : write.verb === 'merge'
          ? [...this.masks, ...newMasks]
          : [];
      for (const mask of affecting) {
        if (!prefix(write.path, mask.path) || write.path.length === mask.path.length) continue;
        const index = mask.path.findIndex(
          (segment, i) => i >= write.path.length && arrayIndex(segment) !== undefined,
        );
        if (index !== -1) uncertain.push({ path: mask.path.slice(0, index), childrenOnly: true });
      }
    }
    const added: Mask[] = [];
    for (const mask of [...uncertain, ...newMasks]) {
      if (this.hides(mask.path) || (mask.childrenOnly && this.hidesChildren(mask.path))) continue;
      this.masks = this.masks.filter(
        (old) =>
          !prefix(mask.path, old.path) ||
          (mask.childrenOnly && mask.path.length === old.path.length && !old.childrenOnly),
      );
      this.masks.push(mask);
      added.push(mask);
    }
    return added;
  }
}
