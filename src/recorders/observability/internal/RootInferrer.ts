/**
 * @internal — not part of the public agentfootprint API. Imported only
 * by RunStepRecorder. Subject to change without notice.
 *
 * RootInferrer — small state machine deciding whether a run's root is
 * a single leaf primitive (Agent / LLMCall) or a composition (Sequence
 * / Parallel / Conditional / Loop).
 *
 * Extracted from RunStepRecorder per Convention 1.
 *
 * Inputs: subflow entries (with their depth + parsed primitiveKind),
 * fork events (depth 0 → Parallel root), decision events (depth 0 →
 * Conditional root), loop events (depth 0 → Loop root).
 *
 * Output: query `kind()` for the inferred root. Returns `undefined`
 * until a signal arrives.
 *
 * Inference rules:
 *   - Decisive composition signals (fork / decide / loop AT DEPTH 0)
 *     lock the root and are never overridden.
 *   - Shallowest primitive boundary IS a composition kind → root is
 *     that composition.
 *   - Two+ leaf siblings at the shallowest depth → implicit Sequence
 *     root (Sequence-as-runner case where the Sequence itself doesn't
 *     fire its own subflow.entry).
 *   - Single leaf at the shallowest depth → root is "leaf".
 */

const KNOWN_PRIMITIVES = new Set([
  'Agent',
  'LLMCall',
  'Sequence',
  'Parallel',
  'Conditional',
  'Loop',
]);

const LEAF_PRIMITIVES = new Set(['Agent', 'LLMCall']);

export type InferredRoot =
  | 'leaf'
  | 'sequence'
  | 'parallel'
  | 'conditional'
  | 'loop'
  | undefined;

export class RootInferrer {
  private inferred: InferredRoot;
  private shallowestDepth = Number.POSITIVE_INFINITY;
  private shallowestSiblings = 0;

  /** Currently-inferred root kind, or undefined if no signal yet. */
  kind(): InferredRoot {
    return this.inferred;
  }

  /** True when the root is a single leaf primitive (or unknown,
   *  which should be treated as leaf for kind-filter purposes). */
  isLeafRoot(): boolean {
    return this.inferred === 'leaf' || this.inferred === undefined;
  }

  /** Observe a subflow entry. */
  observeSubflowEntry(depth: number, primitiveKind: string | undefined): void {
    if (!primitiveKind || !KNOWN_PRIMITIVES.has(primitiveKind)) return;
    if (depth < this.shallowestDepth) {
      this.shallowestDepth = depth;
      this.shallowestSiblings = 1;
      this.tryInfer(primitiveKind);
    } else if (depth === this.shallowestDepth) {
      this.shallowestSiblings++;
      this.tryInfer(undefined);
    }
  }

  /** Observe a fork event. Locks root to Parallel if at depth 0 and
   *  no decisive root has been inferred yet. */
  observeFork(depth: number): void {
    if (depth === 0 && this.inferred === undefined) {
      this.inferred = 'parallel';
    }
  }

  /** Observe a decision event. Locks root to Conditional if at depth 0
   *  and no decisive root has been inferred yet. */
  observeDecision(depth: number): void {
    if (depth === 0 && this.inferred === undefined) {
      this.inferred = 'conditional';
    }
  }

  /** Observe a loop event. Locks root to Loop if at depth 0 and no
   *  decisive root has been inferred yet. */
  observeLoop(depth: number): void {
    if (depth === 0 && this.inferred === undefined) {
      this.inferred = 'loop';
    }
  }

  clear(): void {
    this.inferred = undefined;
    this.shallowestDepth = Number.POSITIVE_INFINITY;
    this.shallowestSiblings = 0;
  }

  private tryInfer(primitiveKind: string | undefined): void {
    // Decisive signals lock the root.
    if (
      this.inferred === 'parallel' ||
      this.inferred === 'conditional' ||
      this.inferred === 'loop'
    ) {
      return;
    }
    // Shallowest IS a composition kind → root is that composition.
    if (
      primitiveKind === 'Sequence' ||
      primitiveKind === 'Parallel' ||
      primitiveKind === 'Conditional' ||
      primitiveKind === 'Loop'
    ) {
      this.inferred = primitiveKind.toLowerCase() as Exclude<InferredRoot, undefined | 'leaf'>;
      return;
    }
    // 2+ leaf siblings at shallowest depth → Sequence-as-runner.
    if (this.shallowestSiblings >= 2) {
      this.inferred = 'sequence';
    } else if (primitiveKind && LEAF_PRIMITIVES.has(primitiveKind)) {
      this.inferred = 'leaf';
    }
  }
}
