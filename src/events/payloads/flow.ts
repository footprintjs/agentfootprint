import type { CompositionKind } from './dependencyTypes.js';

// ─── Tier 1+2: Core Domain (library-emitted) ──────────────────────────

// composition.* (8)
export interface CompositionEnterPayload {
  readonly kind: CompositionKind;
  readonly id: string;
  readonly name: string;
  readonly childCount: number;
}

export interface CompositionExitPayload {
  readonly kind: CompositionKind;
  readonly id: string;
  /** Display name supplied at composition build time (e.g., the
   *  `Sequence.create({ name: 'IntakePipeline' })` arg). Mirrors the
   *  `name` field on `CompositionEnterPayload` so consumers narrating
   *  the exit moment can reference the same human-readable identity
   *  used at entry — no name-cache required across the start/stop
   *  pair. Optional for back-compat with pre-v2.14.5 emitters. */
  readonly name?: string;
  readonly status: 'ok' | 'err' | 'break' | 'budget_exhausted';
  readonly durationMs: number;
}

export interface ParallelForkStartPayload {
  readonly parentId: string;
  readonly branches: readonly { id: string; name: string }[];
}

export interface ParallelBranchCompletePayload {
  readonly parentId: string;
  readonly branchId: string;
  readonly status: 'ok' | 'err';
  readonly durationMs: number;
}

export interface ParallelMergeEndPayload {
  readonly parentId: string;
  /**
   * Which merge strategy ran. `'fn'` = `mergeWithFn` (strict, plain
   * results map). `'llm'` = `mergeWithLLM` (strict, LLM synthesis).
   * `'outcomes-fn'` = `mergeOutcomesWithFn` (tolerant, full
   * `BranchOutcome` map). Distinct values so consumers can render
   * tolerant vs strict merges differently in dashboards.
   */
  readonly strategy: 'llm' | 'fn' | 'outcomes-fn';
  readonly resultSummary: string;
  /** Number of branches whose result FED the merge — i.e., succeeded
   *  (or, in tolerant mode, those the merge fn actually consumed as
   *  `{ok: true}`). Failing branches are counted in `totalBranchCount
   *  - mergedBranchCount`. */
  readonly mergedBranchCount: number;
  /** Total number of branches declared on the Parallel — equals
   *  `mergedBranchCount` on all-success runs, larger on partial. */
  readonly totalBranchCount: number;
}

export interface ConditionalRouteDecidedPayload {
  readonly conditionalId: string;
  readonly chosen: string;
  readonly rationale?: string;
  readonly evidence?: unknown;
}

export interface LoopIterationStartPayload {
  readonly loopId: string;
  readonly iteration: number;
}

export interface LoopIterationExitPayload {
  readonly loopId: string;
  readonly iteration: number;
  readonly reason: 'budget' | 'guard_false' | 'break' | 'body_complete';
}
