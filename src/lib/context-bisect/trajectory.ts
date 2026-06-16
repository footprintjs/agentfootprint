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
 * v1 scope: the FLAT agent chart (`buildAgentChart`) — the DEFAULT reactMode. The
 * grouped chart (`buildDynamicAgentChart`, opt-in `reactMode: 'dynamic-grouped'`) runs
 * each LLM turn in a NESTED traverser whose inner commits never merge into the run commit
 * log, and `subflowResults` keeps only the last loop (re-entry overwrites) — so per-loop
 * contextSources are unrecoverable from a grouped snapshot. Detected and degraded with an
 * honesty flag, never silently mis-bucketed. Full grouped support needs a footprintjs root
 * fix (aggregate nested commit logs into the run log) — tracked as a follow-up proposal.
 */
import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import { commitValueAt, findLastWriter, splitStageId } from 'footprintjs/trace';
import type { UntrackedSource } from 'footprintjs/trace';
import { STAGE_IDS, SUBFLOW_IDS } from '../../conventions.js';
import type { EvidenceInput } from '../influence-core/index.js';
import { stepOutputText } from './llmEdgeWeigher.js';
import { CONTEXT_BISECT_DEFAULTS, type ContextBugArtifacts, type HonestyFlag } from './types.js';

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
 *
 * A head is anchored at the FIRST commit bearing its runtimeStageId — a single stage
 * execution can flush MORE THAN ONE commit bundle under one runtimeStageId (parallel
 * fork merges, multi-flush stages), and those repeats stay INSIDE the frame they open
 * rather than each spawning a spurious one-commit frame.
 */
export function bucketByAnchors(
  commitLog: readonly CommitBundle[],
  headRuntimeStageIds: readonly string[],
): { frames: AnchorBucket[]; prelude: string[] } {
  const headSet = new Set(headRuntimeStageIds);
  const headIdx: number[] = [];
  const anchored = new Set<string>();
  for (let i = 0; i < commitLog.length; i++) {
    const id = commitLog[i].runtimeStageId;
    if (headSet.has(id) && !anchored.has(id)) {
      headIdx.push(i);
      anchored.add(id); // later commits sharing this id belong to the frame it opened
    }
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

// ─── assembleTrajectory — the agent-flavored projection ──────────────

export interface AssembleTrajectoryOptions {
  /** Chars of each source value / intermediate text embedded. Default 2000. */
  readonly maxTextChars?: number;
  /** Keep only the first N frames (honesty-flagged via `truncated`). */
  readonly maxFrames?: number;
}

/** Build the per-runtimeStageId read-key map from the snapshot execution tree
 *  (same walk as the localizer's `buildArtifactIndex`). */
function buildReadsOf(executionTree: StageSnapshot | undefined): Map<string, string[]> {
  const readsOf = new Map<string, string[]>();
  const visit = (node: StageSnapshot | undefined): void => {
    if (!node) return;
    const id = node.runtimeStageId;
    if (id && !readsOf.has(id)) readsOf.set(id, node.stageReads ? Object.keys(node.stageReads) : []);
    for (const child of node.children ?? []) visit(child);
    visit(node.next);
  };
  visit(executionTree);
  return readsOf;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Slice a recorded flat-agent run into a {@link Trajectory} — one {@link LoopFrame}
 * per ReAct iteration, each carrying its `call-llm` pointer, the call's output text,
 * and the live {@link ContextSource}s that fed it (traced via `findLastWriter` +
 * `commitValueAt` from the SAME commit log — zero new capture).
 *
 * Takes the SAME `ContextBugArtifacts` bag the localizer takes (commitLog, lastIdxOf,
 * readsOf all derived from `artifacts.snapshot` internally — adopter call is just
 * `assembleTrajectory(artifacts)`).
 *
 * Honest scope: FLAT chart only. The grouped chart (`sf-llm-call`) keeps slot keys in
 * the subflow scope — detected and degraded with an honesty flag, never mis-bucketed.
 * Standing caveat on every result: contextSources show only sources re-committed to
 * tracked state; context the model retained internally is NOT represented.
 */
export function assembleTrajectory(
  artifacts: ContextBugArtifacts,
  opts: AssembleTrajectoryOptions = {},
): Trajectory {
  const maxTextChars = opts.maxTextChars ?? CONTEXT_BISECT_DEFAULTS.maxTextChars;
  const commitLog = (artifacts.snapshot.commitLog ?? []) as CommitBundle[];
  const lastIdxOf = new Map<string, number>();
  for (let i = 0; i < commitLog.length; i++) lastIdxOf.set(commitLog[i].runtimeStageId, i);
  const readsOf = buildReadsOf(artifacts.snapshot.executionTree as StageSnapshot | undefined);

  const honestyFlags: HonestyFlag[] = [];
  const grouped = commitLog.some((b) => {
    const sp = splitStageId(b.stageId).subflowPath;
    return sp === SUBFLOW_IDS.LLM_CALL || (sp?.split('/').includes(SUBFLOW_IDS.LLM_CALL) ?? false);
  });
  if (grouped) {
    honestyFlags.push({
      flag: 'untracked-sources',
      note:
        'grouped chart (sf-llm-call): the LLM turn runs in a nested traverser whose inner commits ' +
        '(call-llm + slot writes) are NOT merged into the run commit log, and subflowResults retains ' +
        'only the LAST loop (re-entry overwrites). Per-loop contextSources are unrecoverable from the ' +
        'snapshot — use the default flat chart (reactMode "dynamic") for per-loop backtracking.',
    });
  }

  const heads = findLoopHeads(commitLog);
  const { frames: buckets, prelude } = bucketByAnchors(commitLog, heads);
  const kept = opts.maxFrames !== undefined ? buckets.slice(0, opts.maxFrames) : buckets;
  const truncated = opts.maxFrames !== undefined && buckets.length > opts.maxFrames;

  const frames: LoopFrame[] = kept.map((bucket, loopIndex) => {
    // Locate the call-llm commit WITHIN this frame's body (the LLM-step pointer).
    let llmCallId: string | undefined;
    let llmCallArrayIdx: number | undefined;
    let llmBundle: CommitBundle | undefined;
    for (let i = bucket.headArrayIdx; i < bucket.headArrayIdx + bucket.bodyIds.length; i++) {
      if (splitStageId(commitLog[i].stageId).localStageId === STAGE_IDS.CALL_LLM) {
        llmCallId = commitLog[i].runtimeStageId;
        llmCallArrayIdx = i;
        llmBundle = commitLog[i];
        break;
      }
    }

    const intermediateText =
      llmCallId !== undefined ? stepOutputText(commitLog, lastIdxOf, llmCallId, maxTextChars) : undefined;

    const keys = llmCallId !== undefined ? (readsOf.get(llmCallId) ?? []) : [];
    const contextSources: ContextSource[] = keys.map((key) => {
      // EXCLUSIVE beforeIdx — finds the PRIOR writer, never call-llm's own write-back.
      const writer = llmCallArrayIdx !== undefined ? findLastWriter(commitLog, key, llmCallArrayIdx) : undefined;
      const writerId = writer?.runtimeStageId;
      const writerArrayIdx = writerId !== undefined ? lastIdxOf.get(writerId) : undefined;
      const value = writerArrayIdx !== undefined ? commitValueAt(commitLog, writerArrayIdx, key) : undefined;
      const text = value === undefined ? '' : safeStringify(value).slice(0, maxTextChars);
      return {
        key,
        writerId,
        writerArrayIdx,
        value,
        evidence: { id: `${llmCallId}::${key}`, text, ancestorTexts: [] },
      };
    });

    const incompleteSources = llmBundle?.untrackedSources;
    const untrackedReadsPresent = incompleteSources !== undefined && incompleteSources.length > 0;
    return {
      loopIndex,
      llmCallId,
      llmCallArrayIdx,
      headArrayIdx: bucket.headArrayIdx,
      bodyIds: bucket.bodyIds,
      intermediateText,
      contextSources,
      ...(untrackedReadsPresent ? { incompleteSources } : {}),
      untrackedReadsPresent,
    };
  });

  return { frames, prelude, honestyFlags, ...(truncated ? { truncated: { byFrames: true } } : {}) };
}
