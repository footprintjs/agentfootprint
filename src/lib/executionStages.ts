/**
 * executionStages.ts — the ONE reader of a run's execution tree shape.
 *
 * WHY TWO SHAPES. A footprintjs snapshot's `executionTree` (and a subflow's
 * `treeContext.stageContexts`, and `getSubtreeSnapshot(...).executionTree`)
 * comes in two forms, and this library reads both:
 *
 * - LIST form (footprintjs 13): an array of stages in the order they ran. A
 *   fork's children are `branches` — one array per child, each in run order —
 *   and the stage after the fork is the next item of the same array.
 * - LINKED form (footprintjs 12 and older, and every run saved by them): one
 *   stage object whose `next` holds the following stage and whose `children`
 *   holds a fork's children, each the head of its own `next` links.
 *
 * Every reader of the tree in this library goes through here, so no other file
 * checks the shape. Both forms give the same stages in the same order: a stage,
 * then each of its branches (children) in full, then what ran after it.
 *
 * The walk uses an explicit stack, never recursion: a linked tree is one level
 * deeper per stage, so a long run would overflow the call stack.
 */

/** A stage as this library reads it: an object; every field is optional and unchecked. */
export type ExecutionStage = Readonly<Record<string, unknown>>;

/** A stage with the literal path that reaches it from the tree's root. */
export interface LocatedStage {
  readonly stage: ExecutionStage;
  /** Segments below the tree, e.g. `['0']`, `['2','branches','0','1']` (list) or `['next','children','0']` (linked). */
  readonly path: readonly string[];
}

/** Bounds for a tree read from storage, where the shape is not trusted. */
export interface SavedTreeLimits {
  /** Most stages read before the tree is refused. */
  readonly maxStages: number;
  /** Most items in one `branches`, `children` or list array. */
  readonly maxItems: number;
}

/** Thrown by {@link savedExecutionStages} when a saved tree is not a tree it can read. */
export class ExecutionTreeShapeError extends Error {
  constructor() {
    super('execution tree: not a readable list or linked tree');
    this.name = 'ExecutionTreeShapeError';
  }
}

/** Own DATA only: a getter on a saved tree never runs. */
function ownField(object: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (field === undefined) return undefined;
  if (!('value' in field)) throw new ExecutionTreeShapeError();
  return field.value;
}

const NO_PATH: readonly string[] = Object.freeze([]);

interface Pending {
  readonly node: unknown;
  readonly path: readonly string[];
}

function walk(
  tree: unknown,
  strict: SavedTreeLimits | undefined,
  visit: (stage: ExecutionStage, path: readonly string[]) => void,
): void {
  const refuse = (): never => {
    throw new ExecutionTreeShapeError();
  };
  const items = (value: unknown): readonly unknown[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return strict ? refuse() : undefined;
    if (strict && value.length > strict.maxItems) refuse();
    return value;
  };
  const read = (object: object, key: string): unknown =>
    strict ? ownField(object, key) : (object as Record<string, unknown>)[key];
  // Paths only for a saved (bounded) tree: on a long linked run they would grow with every stage.
  const at = (path: readonly string[], ...segments: string[]): readonly string[] =>
    strict ? [...path, ...segments] : NO_PATH;

  // A chain is a list (array) or a linked head (object); both push their stages here.
  const stack: Pending[] = [];
  const pushChain = (chain: unknown, path: readonly string[]): void => {
    if (Array.isArray(chain)) {
      const list = items(chain) ?? [];
      for (let index = list.length - 1; index >= 0; index--)
        stack.push({ node: list[index], path: at(path, String(index)) });
    } else stack.push({ node: chain, path });
  };

  pushChain(tree, NO_PATH);
  let visited = 0;
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      if (strict) refuse();
      continue;
    }
    if (strict && ++visited > strict.maxStages) refuse();
    visit(node as ExecutionStage, path);
    // Pushed in reverse, so popped as: branches/children in order, then `next`.
    const next = read(node, 'next');
    if (next !== undefined) stack.push({ node: next, path: at(path, 'next') });
    const children = items(read(node, 'children'));
    if (children)
      for (let index = children.length - 1; index >= 0; index--)
        stack.push({ node: children[index], path: at(path, 'children', String(index)) });
    const branches = items(read(node, 'branches'));
    if (branches)
      for (let index = branches.length - 1; index >= 0; index--) {
        if (strict && !Array.isArray(branches[index])) refuse();
        pushChain(branches[index], at(path, 'branches', String(index)));
      }
  }
}

/**
 * Every stage of a run's execution tree, in the order they ran, from either form.
 * Tolerant: an absent tree gives `[]`, and anything that is not a stage object is skipped.
 */
export function executionStages(tree: unknown): ExecutionStage[] {
  const stages: ExecutionStage[] = [];
  walk(tree, undefined, (stage) => stages.push(stage));
  return stages;
}

/**
 * Every stage of a SAVED execution tree with its path from the root, from either form.
 * Strict: own data fields only, bounded by `limits`, and a malformed tree throws
 * {@link ExecutionTreeShapeError} rather than being read in part.
 */
export function savedExecutionStages(tree: unknown, limits: SavedTreeLimits): LocatedStage[] {
  if (tree === null || typeof tree !== 'object') throw new ExecutionTreeShapeError();
  const stages: LocatedStage[] = [];
  walk(tree, limits, (stage, path) => stages.push({ stage, path }));
  return stages;
}
