/**
 * trajectory — the per-loop trajectory assembler (proposal 005).
 *
 * Slices a recorded ReAct run's commit log into ordered LoopFrames — one per
 * iteration — so the two-score localizer (L2), the recall scorer (L3), and the
 * backtracking debugger (L4) read the same per-loop substrate instead of one
 * flattened bag. PURE + read-only (NOT a recorder, Convention 1): the loop-level
 * peer of `causalChain` / `commitValueAt` / `stepOutputText`.
 *
 * This file ships the SEGMENTATION CORE (proposal 005, phase 1):
 *   - `bucketByAnchors` — the domain-agnostic HEAD-range partition (pure, total);
 *   - `findLoopHeads`   — the flat-chart loop-head detector (one head per
 *                         injection-engine entry).
 * The agent-flavored `assembleTrajectory` projection (contextSources via
 * findLastWriter/commitValueAt + stepOutputText + honesty flags) layers on these
 * and lands next, calibrated against a real flat-agent commit log.
 *
 * v1 scope: the FLAT agent chart (`buildAgentChart`). The grouped chart
 * (`buildDynamicAgentChart`) keeps slot keys in the `sf-llm-call` subflow scope,
 * not the parent log — detected and degraded with an honesty flag, never
 * silently mis-bucketed (grouped subtree-join is a v2 follow-up).
 */
import type { CommitBundle } from 'footprintjs/advanced';
import { splitStageId } from 'footprintjs/trace';
import type { UntrackedSource } from 'footprintjs/trace';
import { SUBFLOW_IDS } from '../../conventions.js';
import type { EvidenceInput } from '../influence-core/index.js';
import type { HonestyFlag } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────

/** One source the loop's `call-llm` read, traced back to its live writer for THAT loop. */
export interface ContextSource {
  /** The state key call-llm#k read (e.g. 'systemPromptInjections'). */
  readonly key: string;
  /** runtimeStageId of the live writer (findLastWriter); undefined when never committed before. */
  readonly writerId: string | undefined;
  /** The writer's commitLog ARRAY position — NOT the optional CommitBundle.idx. */
  readonly writerArrayIdx: number | undefined;
  /** Materialized live value (commitValueAt); undefined under the pre-run-initial blind spot. */
  readonly value: unknown;
  /** The bridge handed to scorers: { id, text, ancestorTexts }. */
  readonly evidence: EvidenceInput;
}

/** One ReAct iteration — bounded by the loop HEAD, pointing at the call-llm inside it. */
export interface LoopFrame {
  /** Anchor ordinal 0,1,2… DERIVED from the commit log (NOT TraversalContext.loopIteration). */
  readonly loopIndex: number;
  /** The call-llm#k runtimeStageId — the LLM-step pointer WITHIN the frame. */
  readonly llmCallId: string | undefined;
  /** call-llm#k's commitLog array index — the EXCLUSIVE beforeIdx for findLastWriter. */
  readonly llmCallArrayIdx: number | undefined;
  /** The loop-HEAD commit's array index — the body's lower bound. */
  readonly headArrayIdx: number;
  /** Every runtimeStageId in [head[k], head[k+1]) — the full multi-stage body of round k, in commit order. */
  readonly bodyIds: readonly string[];
  /** stepOutputText over the call-llm commit (assistant content + tool-call intents). */
  readonly intermediateText: string | undefined;
  /** One per key call-llm#k read. */
  readonly contextSources: readonly ContextSource[];
  /** Pass-through of the call-llm bundle's untrackedSources ('args'|'env'|'silent'). */
  readonly incompleteSources?: ReadonlyArray<UntrackedSource>;
  /** True when incompleteSources is non-empty — "this step read untracked; slice may be
   *  incomplete here". NOT a model-internalized claim (that is undetectable — see Trajectory). */
  readonly untrackedReadsPresent: boolean;
}

/** The run input, re-injected as a synthetic node — a PROXY (args is untracked), never a recorded edge. */
export interface SyntheticQuestionNode {
  readonly text: string;
  readonly incompleteSources: readonly ['args'];
  readonly injected: true;
}

export interface Trajectory {
  readonly frames: readonly LoopFrame[];
  /** Commits BEFORE the first head (seed, memory-read) — run setup, not a loop body. */
  readonly prelude: readonly string[];
  /** Only populated when the contrastive path is wired (proposal 005 L2 note). */
  readonly question?: SyntheticQuestionNode;
  /** Degrade-never-throw. STANDING caveat on EVERY trajectory: contextSources show only
   *  sources re-committed to tracked state; context the model retained internally (carried
   *  in its own reasoning, never re-committed) leaves no read→write edge and is NOT here. */
  readonly honestyFlags: readonly HonestyFlag[];
  /** Set only when maxFrames cut the run. */
  readonly truncated?: { readonly byFrames: boolean };
}

// ─── bucketByAnchors — the pure HEAD-range partition (domain-agnostic) ─

/** One frame's raw partition: the head's array index + the runtimeStageIds in its half-open range. */
export interface AnchorBucket {
  readonly headArrayIdx: number;
  readonly bodyIds: readonly string[];
}

/**
 * Partition a commit log by a list of HEAD runtimeStageIds (taken as data — no agent
 * knowledge). Each frame is the half-open range `[head[k], head[k+1])`; commits before
 * the first head are the `prelude`. TOTAL: every commit lands in exactly one frame OR
 * the prelude. Heads not found in the log are ignored; ordering follows the log, not the
 * input list (an out-of-order or duplicate head list cannot reorder/duplicate commits).
 */
export function bucketByAnchors(
  commitLog: readonly CommitBundle[],
  headRuntimeStageIds: readonly string[],
): { frames: AnchorBucket[]; prelude: string[] } {
  const headSet = new Set(headRuntimeStageIds);
  const headIdx: number[] = [];
  for (let i = 0; i < commitLog.length; i++) {
    if (headSet.has(commitLog[i].runtimeStageId)) headIdx.push(i);
  }
  if (headIdx.length === 0) {
    return { frames: [], prelude: commitLog.map((b) => b.runtimeStageId) };
  }
  const prelude = commitLog.slice(0, headIdx[0]).map((b) => b.runtimeStageId);
  const frames: AnchorBucket[] = headIdx.map((head, k) => {
    const end = k + 1 < headIdx.length ? headIdx[k + 1] : commitLog.length;
    return { headArrayIdx: head, bodyIds: commitLog.slice(head, end).map((b) => b.runtimeStageId) };
  });
  return { frames, prelude };
}

// ─── findLoopHeads — flat-chart loop-head detection ──────────────────

/** True when a commit lives inside the injection-engine subflow (the loop head region). */
function inInjectionEngine(bundle: CommitBundle): boolean {
  const { localStageId, subflowPath } = splitStageId(bundle.stageId);
  if (localStageId === SUBFLOW_IDS.INJECTION_ENGINE) return true; // the mount commit, if any
  if (subflowPath === undefined) return false;
  // a commit nested anywhere under sf-injection-engine (handles nested subflow prefixes)
  return subflowPath === SUBFLOW_IDS.INJECTION_ENGINE || subflowPath.startsWith(SUBFLOW_IDS.INJECTION_ENGINE + '/');
}

/**
 * The flat-chart loop heads: the FIRST commit of each injection-engine ENTRY (one per
 * ReAct iteration, since the loop is branch-sourced back to the injection engine). A head
 * is a commit that is in the injection engine while the previous commit was not — so a
 * multi-commit injection-engine body yields exactly one head per loop.
 *
 * Returns the runtimeStageIds to feed `bucketByAnchors`. Empty when the run never enters
 * the injection engine (e.g. the grouped chart, where the loop lives in sf-llm-call —
 * the caller degrades with an honesty flag).
 */
export function findLoopHeads(commitLog: readonly CommitBundle[]): string[] {
  const heads: string[] = [];
  let wasIn = false;
  for (const bundle of commitLog) {
    const isIn = inInjectionEngine(bundle);
    if (isIn && !wasIn) heads.push(bundle.runtimeStageId);
    wasIn = isIn;
  }
  return heads;
}
