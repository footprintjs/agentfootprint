/**
 * trajectory — the per-loop trajectory assembler (proposal 005).
 *
 * Slices a recorded ReAct run's commit log into ordered LoopFrames — one per
 * iteration — so the two-score localizer (L2), the recall scorer (L3), and the
 * backtracking debugger (L4) read the same per-loop substrate instead of one
 * flattened bag. PURE + read-only (NOT a recorder, Convention 1): the loop-level
 * peer of `causalChain` / `commitValueAt` / `stepOutputText`.
 *
 * Pieces:
 *   - `bucketByAnchors` — the domain-agnostic HEAD-range partition (pure, total);
 *   - `findLoopHeads`   — the flat-chart loop-head detector (one head per injection-engine entry);
 *   - `assembleTrajectory` — the agent-flavored projection (call-llm pointer + intermediate
 *                            text + live contextSources via findLastWriter/commitValueAt).
 *
 * Handles BOTH chart shapes:
 *   - FLAT (`buildAgentChart`, default `reactMode: 'dynamic'`): `call-llm` is a parent-level
 *     stage; frames are bucketed over the RUN commit log by injection-engine loop heads.
 *   - GROUPED (`buildDynamicAgentChart`, `reactMode: 'dynamic-grouped'`): the LLM turn runs in
 *     an `sf-llm-call` subflow whose inner commits live in `subflowResults['sf-llm-call#k']`,
 *     retained PER-ITERATION by footprintjs subflow-commit-visibility (≥ d458898). Each loop is
 *     projected PER-SCOPE over its own inner commit log — no cross-scope merge, so the slice
 *     primitives run correctly over the isolated log. Such frames carry `subflowScope`.
 */
import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import { commitValueAt, findLastWriter, parseRuntimeStageId, splitStageId } from 'footprintjs/trace';
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
  /**
   * GROUPED chart only: the `sf-llm-call` mount runtimeStageId this frame was projected from.
   * When set, ALL array indices on this frame (`headArrayIdx`, `llmCallArrayIdx`,
   * `bodyIds`, each `contextSource.writerArrayIdx`) are relative to that subflow's OWN inner
   * commit log (`subflowResults[subflowScope].treeContext.history`), NOT the run commit log.
   * Absent for FLAT-chart frames (indices are run-commit-log relative).
   */
  readonly subflowScope?: string;
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

/** Structural view of a footprintjs SubflowResult's treeContext (grouped path). */
interface GroupedSubflowResult {
  readonly treeContext?: {
    readonly history?: readonly unknown[];
    readonly stageContexts?: unknown;
  };
}

/**
 * Project ONE loop frame from a given commit log + readsOf — the shared core used by BOTH
 * the flat path (over the run commit log) and the grouped path (over a subflow's OWN inner
 * commit log). `headArrayIdx`/`bodyIds` bound the frame WITHIN `log`; `subflowScope`, when
 * set, records that all indices are relative to that subflow's inner log.
 */
function projectFrame(
  loopIndex: number,
  log: CommitBundle[],
  lastIdxOf: Map<string, number>,
  readsOf: Map<string, string[]>,
  headArrayIdx: number,
  bodyIds: readonly string[],
  maxTextChars: number,
  subflowScope?: string,
): LoopFrame {
  // Locate the call-llm commit WITHIN this frame's body (the LLM-step pointer).
  let llmCallId: string | undefined;
  let llmCallArrayIdx: number | undefined;
  let llmBundle: CommitBundle | undefined;
  for (let i = headArrayIdx; i < headArrayIdx + bodyIds.length; i++) {
    if (splitStageId(log[i].stageId).localStageId === STAGE_IDS.CALL_LLM) {
      llmCallId = log[i].runtimeStageId;
      llmCallArrayIdx = i;
      llmBundle = log[i];
      break;
    }
  }

  const intermediateText =
    llmCallId !== undefined ? stepOutputText(log, lastIdxOf, llmCallId, maxTextChars) : undefined;

  const keys = llmCallId !== undefined ? (readsOf.get(llmCallId) ?? []) : [];
  const contextSources: ContextSource[] = keys.map((key) => {
    // EXCLUSIVE beforeIdx — finds the PRIOR writer, never call-llm's own write-back.
    const writer = llmCallArrayIdx !== undefined ? findLastWriter(log, key, llmCallArrayIdx) : undefined;
    const writerId = writer?.runtimeStageId;
    const writerArrayIdx = writerId !== undefined ? lastIdxOf.get(writerId) : undefined;
    const value = writerArrayIdx !== undefined ? commitValueAt(log, writerArrayIdx, key) : undefined;
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
    headArrayIdx,
    bodyIds,
    intermediateText,
    contextSources,
    ...(subflowScope !== undefined ? { subflowScope } : {}),
    ...(untrackedReadsPresent ? { incompleteSources } : {}),
    untrackedReadsPresent,
  };
}

/** The sf-llm-call mount keys in `subflowResults`, in loop order (by execution index). */
function llmCallMountKeys(subflowResults: Record<string, unknown>): string[] {
  return Object.keys(subflowResults)
    .filter((k) => k.includes('#') && splitStageId(k.split('#')[0]).localStageId === SUBFLOW_IDS.LLM_CALL)
    .sort((a, b) => parseRuntimeStageId(a).executionIndex - parseRuntimeStageId(b).executionIndex);
}

/**
 * GROUPED chart projection (`reactMode: 'dynamic-grouped'`). The LLM turn runs inside an
 * `sf-llm-call` subflow, so its `call-llm` + slot writes live in the subflow's OWN commit log
 * — retained per-iteration under `subflowResults['sf-llm-call#k']` (footprintjs
 * subflow-commit-visibility). Each loop is a frame projected PER-SCOPE over its inner log; no
 * cross-scope merge, so `findLastWriter`/`commitValueAt` run correctly over the isolated log.
 */
function assembleGroupedTrajectory(
  artifacts: ContextBugArtifacts,
  mountKeys: readonly string[],
  maxTextChars: number,
  maxFrames: number | undefined,
): Trajectory {
  const sr = (artifacts.snapshot.subflowResults ?? {}) as Record<string, GroupedSubflowResult>;
  const runLog = (artifacts.snapshot.commitLog ?? []) as CommitBundle[];

  // Run-level prelude: commits before the first sf-llm-call mount (seed / memory-read setup).
  const firstMountRunIdx = runLog.findIndex((b) => b.runtimeStageId === mountKeys[0]);
  const prelude = firstMountRunIdx > 0 ? runLog.slice(0, firstMountRunIdx).map((b) => b.runtimeStageId) : [];

  const kept = maxFrames !== undefined ? mountKeys.slice(0, maxFrames) : mountKeys;
  const truncated = maxFrames !== undefined && mountKeys.length > maxFrames;

  const frames: LoopFrame[] = kept.map((key, loopIndex) => {
    const innerLog = (sr[key]?.treeContext?.history ?? []) as CommitBundle[];
    const innerReadsOf = buildReadsOf(sr[key]?.treeContext?.stageContexts as StageSnapshot | undefined);
    const innerLastIdxOf = new Map<string, number>();
    for (let i = 0; i < innerLog.length; i++) innerLastIdxOf.set(innerLog[i].runtimeStageId, i);
    const bodyIds = innerLog.map((b) => b.runtimeStageId);
    return projectFrame(loopIndex, innerLog, innerLastIdxOf, innerReadsOf, 0, bodyIds, maxTextChars, key);
  });

  return { frames, prelude, honestyFlags: [], ...(truncated ? { truncated: { byFrames: true } } : {}) };
}

/**
 * Slice a recorded agent run into a {@link Trajectory} — one {@link LoopFrame} per ReAct
 * iteration, each carrying its `call-llm` pointer, the call's output text, and the live
 * {@link ContextSource}s that fed it (traced via `findLastWriter` + `commitValueAt` from the
 * SAME commit log — zero new capture).
 *
 * Takes the SAME `ContextBugArtifacts` bag the localizer takes — adopter call is just
 * `assembleTrajectory(artifacts)`.
 *
 * Handles BOTH chart shapes:
 *  - FLAT (`reactMode: 'dynamic'`, default): `call-llm` is a parent-level stage; frames are
 *    bucketed over the run commit log by the `sf-injection-engine` loop heads.
 *  - GROUPED (`reactMode: 'dynamic-grouped'`): the LLM turn runs in an `sf-llm-call` subflow;
 *    each loop is projected PER-SCOPE over its own inner commit log (retained per-iteration by
 *    footprintjs subflow-commit-visibility). Such frames carry `subflowScope` and their array
 *    indices are inner-log-relative.
 *
 * Standing caveat on every result: contextSources show only sources re-committed to tracked
 * state; context the model retained internally (carried in its own reasoning, never
 * re-committed) leaves no read→write edge and is NOT represented.
 */
export function assembleTrajectory(
  artifacts: ContextBugArtifacts,
  opts: AssembleTrajectoryOptions = {},
): Trajectory {
  const maxTextChars = opts.maxTextChars ?? CONTEXT_BISECT_DEFAULTS.maxTextChars;

  // Grouped agent ⟺ the LLM turn is wrapped in sf-llm-call (its mounts appear in subflowResults).
  const mountKeys = llmCallMountKeys((artifacts.snapshot.subflowResults ?? {}) as Record<string, unknown>);
  if (mountKeys.length > 0) {
    return assembleGroupedTrajectory(artifacts, mountKeys, maxTextChars, opts.maxFrames);
  }

  // FLAT path: project over the run commit log, bucketed by injection-engine loop heads.
  const commitLog = (artifacts.snapshot.commitLog ?? []) as CommitBundle[];
  const lastIdxOf = new Map<string, number>();
  for (let i = 0; i < commitLog.length; i++) lastIdxOf.set(commitLog[i].runtimeStageId, i);
  const readsOf = buildReadsOf(artifacts.snapshot.executionTree as StageSnapshot | undefined);

  const heads = findLoopHeads(commitLog);
  const { frames: buckets, prelude } = bucketByAnchors(commitLog, heads);
  const kept = opts.maxFrames !== undefined ? buckets.slice(0, opts.maxFrames) : buckets;
  const truncated = opts.maxFrames !== undefined && buckets.length > opts.maxFrames;

  const frames: LoopFrame[] = kept.map((bucket, loopIndex) =>
    projectFrame(loopIndex, commitLog, lastIdxOf, readsOf, bucket.headArrayIdx, bucket.bodyIds, maxTextChars),
  );

  return { frames, prelude, honestyFlags: [], ...(truncated ? { truncated: { byFrames: true } } : {}) };
}
