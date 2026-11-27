import type { StructureRecorder } from 'footprintjs';
import type { GroupTranslator } from '../../core/translator.js';
import type { Runner } from '../../core/runner.js';
import type { RunnerCoreValues } from '../../core/RunnerBase.js';
import type { MemoryIdentity } from '../../memory/identity/types.js';
import type { LLMProvider } from '../../provider-contract/types.js';

export interface ParallelOptions {
  readonly name?: string;
  readonly id?: string;
  /**
   * Optional build-time recorders passed through to footprintjs's
   * `flowChart()` factory. Each recorder observes per-node build
   * events (`onStageAdded` / `onSubflowMounted` / etc.) for this
   * composition's internal chart (Seed + each branch mount + Merge).
   *
   * Cascade: each branch runner attaches its OWN recorders at its
   * own construction time. footprintjs does NOT propagate
   * StructureRecorders into mounted subflows — so for full coverage,
   * attach the same recorders to every nested composition. See the
   * core-flow README's "StructureRecorder cascade" section.
   *
   * When omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). When attached,
   * `runner.getUIGroup()` invokes it with the Parallel's
   * `GroupMetadata` (kind, id, name, branches list, merge strategy)
   * and returns whatever shape the translator produces.
   *
   * Independent of `structureRecorders` — those observe per-node spec
   * events, this shapes whole-composition UI groups. Common case is to
   * thread the SAME `GroupTranslator` reference through every nested
   * composition so `member.uiGroup` is populated recursively; L1c
   * per-method overrides add finer control.
   *
   * When omitted, `getUIGroup()` returns `undefined`.
   */
  readonly groupTranslator?: GroupTranslator;
}

export interface ParallelInput {
  readonly message: string;
  /**
   * WHO this run is for — the same tuple as `AgentInput.identity`. Every
   * member runs for it: its memory, its tools' `ctx.identity`. Omitted, every
   * member runs under this run's own conversation (`{ conversationId: runId }`),
   * never a namespace another run shares (`core/memberRun.ts`).
   */
  readonly identity?: MemoryIdentity;
}

export type ParallelOutput = string;

export type BranchChild = Runner<{ message: string }, string>;

export type MergeFn = (branchResults: Readonly<Record<string, string>>) => string;

/**
 * Outcome per branch in tolerant mode. One of:
 *   - `{ ok: true, value: string }` — branch succeeded; `value` is the returned string
 *   - `{ ok: false, error: string }` — branch threw; `error` is the error message
 *
 * Consumers in tolerant mode receive `Record<branchId, BranchOutcome>` and
 * decide how to handle partial failure (e.g., fall back to a default,
 * log, retry, or surface a user-facing message).
 */
export type BranchOutcome =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

export type MergeOutcomesFn = (outcomes: Readonly<Record<string, BranchOutcome>>) => string;

export interface MergeWithLLMOptions {
  readonly provider: LLMProvider;
  readonly model: string;
  /** Prompt prepended to the branch results when feeding the merge LLM. */
  readonly prompt: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface BranchEntry {
  readonly id: string;
  readonly name: string;
  readonly runner: BranchChild;
  /**
   * Optional per-method translator override for THIS branch only.
   * When set, the branch's `member.uiGroup` is produced by invoking
   * this translator against the runner's own `GroupMetadata`, instead
   * of calling `branch.runner.getUIGroup()` (which would use the
   * runner's own constructor-level translator).
   */
  readonly groupTranslator?: GroupTranslator;
  /** This branch's failure rejects the whole run. See `ParallelBranchOptions.required`. */
  readonly required?: boolean;
}

/**
 * Options bag accepted by `ParallelBuilder.branch()` for per-method
 * overrides. Backwards-compatible with the legacy
 * `.branch(id, runner, name?)` signature: when the third arg is a
 * string it's still treated as `name`.
 */
export interface ParallelBranchOptions {
  /** Human-friendly name for this branch. Default: the branch id. */
  readonly name?: string;
  /** Per-method translator override. See `BranchEntry.groupTranslator`. */
  readonly groupTranslator?: GroupTranslator;
  /**
   * Mark this branch as REQUIRED: its failure rejects the whole Parallel
   * run — even under a tolerant `.mergeOutcomesWithFn()` merge — with an
   * error that names the branch. Default `false` (existing semantics:
   * strict merges aggregate failures at the join; tolerant merges receive
   * them as `BranchOutcome` entries).
   *
   * Fail-fast wiring: when EVERY branch is required, footprintjs's
   * fork-level `failFast` is engaged (`Promise.all`) so the first failure
   * aborts the fan-out immediately — siblings are not awaited and the
   * Merge stage never runs. When only SOME branches are required, the
   * fan-out stays best-effort (`Promise.allSettled`) and required
   * failures are enforced at the Merge join instead — footprintjs's
   * `failFast` is all-or-nothing per fork node, so engaging it for a
   * mixed set would wrongly abort the run when an OPTIONAL sibling
   * throws. See https://agentfootprint.dev/docs/getting-started/key-concepts/ (Parallel).
   *
   * Pause semantics under fail-fast: with every branch required, a branch
   * that PAUSES (`pauseHere()`) pre-empts its siblings the same way a
   * failure does — `Promise.all` settles on the first non-success, so
   * still-running siblings are not awaited before the run surfaces the
   * `RunnerPauseOutcome`. The checkpoint reflects the paused branch;
   * `resume()` continues from there and re-attributes any post-resume
   * required-branch failure just like `run()` does. Under the default
   * best-effort fork, a pause is only surfaced after every sibling
   * settles.
   *
   * Nested-mounting limitation: required-branch attribution and the
   * synthetic `composition.exit` are wired through `Parallel.run()` /
   * `Parallel.resume()`. When the Parallel's chart is instead MOUNTED
   * into an outer composition (e.g. `Sequence.step('s', parallel)`), the
   * outer runner's executor runs the chart — the fork-level `failFast`
   * still aborts the fan-out, but the rejection surfaces RAW (no
   * `required branch 'x' failed` wrapping) and the nested Parallel's
   * `composition.enter` is left without a matching `exit`. See README
   * Decision 8.
   */
  readonly required?: boolean;
}

/**
 * Per-branch first-error record captured during a run.
 *
 * `raw` is the ORIGINAL thrown value (footprintjs's
 * `FlowErrorEvent.structuredError.raw`) — the identity key used by
 * `rethrowWithBranchAttribution()` to correlate a fail-fast rejection back
 * to its branch regardless of the error's class name. `message` is the
 * BARE message (no `TypeError:` / `RateLimitError:` prefix) used in merge
 * aggregates, tolerant `BranchOutcome.error` strings, and the attributed
 * error text.
 *
 * @internal Exported only for `wrapBranchOutputMapper`'s signature — not
 * part of the public API (not re-exported from the package barrel).
 */
export interface BranchErrorRecord {
  readonly message: string;
  readonly raw: unknown;
}

export type MergeStrategy =
  | { readonly kind: 'fn'; readonly fn: MergeFn }
  | { readonly kind: 'llm'; readonly opts: MergeWithLLMOptions }
  | { readonly kind: 'outcomes-fn'; readonly fn: MergeOutcomesFn };

export interface ParallelState {
  [k: string]: unknown;
}

export interface ParallelRunValues extends RunnerCoreValues {
  readonly branchErrors: Map<string, BranchErrorRecord>;
}
