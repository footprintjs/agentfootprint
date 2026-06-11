/**
 * llmEdgeWeigher — influence-scored `EdgeWeigher` for LLM-call slice edges
 * (RFC-003 Part B, block D7).
 *
 * The gap this fills: footprintjs's causal slice treats every parent of an
 * LLM call equally — a 12-parent hairball (system prompt, history, tool
 * results, cache markers, counters …) gives a debugger 12 equally-plausible
 * leads. D7 turns the hairball into a RANKED shortlist by weighing each
 * parent edge with influence-core's composite (D6): the parent's WRITTEN
 * content vs the LLM call's OUTPUT.
 *
 * Pattern: two-pass adapter over footprintjs's synchronous `EdgeWeigher`
 *          hook (A3). Embedding is async, the hook is sync — so the handle
 *          PRIMES first (walk an unweighted slice, embed every needed text
 *          in deduplicated batches, memoize composites), and `weigh` then
 *          answers synchronously from the primed map. `localizeContextBug`
 *          drives the two passes; standalone consumers call
 *          `prime(dag)` themselves and re-run `causalChain({ weigh })`.
 * Role:    `src/lib/context-bisect/` leaf. The engine stays zero-dep — the
 *          weigher is consumer-injected exactly as A3 intended.
 *
 * ## Honest claim (§B2)
 *
 * Weights are CORRELATIONAL proxies: deterministic embedding geometry
 * between texts the run already committed — never model internals, never
 * causal attribution (ablation is the causal tier). A weight of 0.93 means
 * "this parent's content is semantically close to what the LLM produced",
 * not "the LLM used it".
 *
 * ## Determinism
 *
 * Same artifacts + same (deterministic) embedder → same weights and same
 * ranking, run after run: texts are built from the commit log in commit
 * order, embedded via influence-core's deduplicated batch, and ties in
 * `rankedParents` keep first-seen (slice BFS) order. Wrap the embedder in
 * `embeddingCache(...)` to also make repeat localizations embed nothing.
 *
 * ## What is weighed
 *
 * DATA edges whose CHILD is an LLM call (`llmCallIds`). Everything else —
 * non-LLM children, control edges (a routing decision's influence is not a
 * semantic-content question) — returns `undefined`, which footprintjs
 * stamps as the default 1.0.
 *
 * ## Redaction posture
 *
 * Texts come exclusively from the COMMIT LOG, which footprintjs scrubs at
 * commit time — a redacted key's committed value IS the placeholder, so
 * the embedder never sees the raw secret.
 */

import type { CommitBundle } from 'footprintjs/advanced';
import type { CausalNode, EdgeWeigher } from 'footprintjs/trace';
import { commitValueAt, flattenCausalDAG } from 'footprintjs/trace';

import {
  scoreInfluence,
  type Embedder,
  type EvidenceInput,
  type InfluenceWeights,
} from '../influence-core/index.js';
import { safeStringify } from '../trace-toolpack/bounded.js';
import { CONTEXT_BISECT_DEFAULTS } from './types.js';

// ─── Options / handle ────────────────────────────────────────────────

export interface LlmEdgeWeigherOptions {
  /**
   * Injected embedder (D6 contract). Wrap in `embeddingCache(...)` so the
   * weigher, the suspect refinement, and any margin/lint consumer share
   * one embedding spend.
   */
  readonly embedder: Embedder;
  /**
   * runtimeStageIds of LLM-call executions — the children whose parent
   * edges get weighed. Provide explicitly, or extract from captured
   * events with `llmCallIdsFromEvents` (the `stream.llm_start` ids).
   */
  readonly llmCallIds: Iterable<string>;
  /** The run's commit log — where edge texts are read from. */
  readonly commitLog: readonly CommitBundle[];
  /** Char cap per embedded text. Default 2000. */
  readonly maxTextChars?: number;
  /** Composite weights forwarded to influence-core. Default: paper priors. */
  readonly weights?: InfluenceWeights;
  /**
   * Override the CHILD text (the LLM call's output). Default: the values
   * the child committed, serialized `key=value` in trace order, capped.
   */
  readonly childTextOf?: (runtimeStageId: string) => string | undefined;
  /**
   * Override the PARENT text for one edge. Default: the value the parent
   * committed for the edge's key, serialized + capped.
   */
  readonly parentTextOf?: (runtimeStageId: string, key: string) => string | undefined;
}

/** One ranked parent edge of an LLM call (descending weight). */
export interface RankedParentEdge {
  readonly parentId: string;
  readonly stageName: string;
  readonly key: string;
  /** Influence composite clamped to [0, 1] — a correlational proxy (§B2). */
  readonly weight: number;
}

export interface LlmEdgeWeigherHandle {
  /**
   * Pass 1 — walk an (unweighted) causal DAG, embed every LLM-edge text in
   * one deduplicated batch, and memoize composite weights. Idempotent;
   * call again with a different DAG to extend the map.
   */
  prime(root: CausalNode): Promise<void>;
  /**
   * Pass 2 — the synchronous footprintjs `EdgeWeigher`. Returns the primed
   * weight for (LLM child, parent, data key); `undefined` (→ engine
   * default 1.0) for control edges, non-LLM children, and unprimed pairs.
   */
  readonly weigh: EdgeWeigher;
  /**
   * The D7 acceptance view: an LLM call's parents ranked by weight,
   * descending; ties keep first-seen (slice BFS) order. Empty until
   * `prime` ran over a DAG containing the call.
   */
  rankedParents(llmCallId: string): readonly RankedParentEdge[];
  /** Texts the embedder was given — exposed for security audits/tests. */
  embeddedTexts(): readonly string[];
}

// ─── Text builders (commit-log-only — redaction-respecting) ──────────

/** Last commit-log index of a step (steps may commit more than once). */
function buildLastIdxMap(commitLog: readonly CommitBundle[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < commitLog.length; i++) map.set(commitLog[i].runtimeStageId, i);
  return map;
}

function cap(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Default child text: everything the step committed, `key=value` in trace
 * order. For an agent's LLM call this carries the assistant content +
 * tool-call intents — the step's observable OUTPUT.
 */
export function stepOutputText(
  commitLog: readonly CommitBundle[],
  lastIdxOf: Map<string, number>,
  runtimeStageId: string,
  maxChars: number,
): string | undefined {
  const idx = lastIdxOf.get(runtimeStageId);
  if (idx === undefined) return undefined;
  const paths = new Set<string>();
  for (const bundle of commitLog) {
    if (bundle.runtimeStageId !== runtimeStageId) continue;
    for (const entry of bundle.trace) paths.add(entry.path);
  }
  if (paths.size === 0) return undefined;
  const parts: string[] = [];
  for (const path of paths) {
    parts.push(`${path}=${safeStringify(commitValueAt(commitLog as CommitBundle[], idx, path))}`);
  }
  const text = parts.join('\n');
  return text.length === 0 ? undefined : cap(text, maxChars);
}

/** Default parent text: the value the parent committed for the edge key. */
function edgeKeyText(
  commitLog: readonly CommitBundle[],
  lastIdxOf: Map<string, number>,
  runtimeStageId: string,
  key: string,
  maxChars: number,
): string | undefined {
  const idx = lastIdxOf.get(runtimeStageId);
  if (idx === undefined) return undefined;
  const value = commitValueAt(commitLog as CommitBundle[], idx, key);
  if (value === undefined) return undefined;
  return cap(safeStringify(value), maxChars);
}

// ─── The factory ─────────────────────────────────────────────────────

/**
 * Build the D7 weigher. See module docs for the two-pass contract, the
 * determinism guarantee, and the §B2 honest claim (weights = proxies).
 */
export function llmEdgeWeigher(options: LlmEdgeWeigherOptions): LlmEdgeWeigherHandle {
  const llmCallIds = new Set(options.llmCallIds);
  const maxTextChars = options.maxTextChars ?? CONTEXT_BISECT_DEFAULTS.maxTextChars;
  const lastIdxOf = buildLastIdxMap(options.commitLog);

  /** `${childId}→${parentId}@${key}` → clamped composite. */
  const weightOf = new Map<string, number>();
  /** First-seen order of edges per LLM call (slice BFS — the tiebreaker). */
  const edgeOrder = new Map<string, { parentId: string; stageName: string; key: string }[]>();
  const embedded: string[] = [];

  const edgeKey = (childId: string, parentId: string, key: string): string =>
    `${childId} ${parentId} ${key}`;

  const childText = (id: string): string | undefined =>
    options.childTextOf
      ? options.childTextOf(id)
      : stepOutputText(options.commitLog, lastIdxOf, id, maxTextChars);

  const parentText = (id: string, key: string): string | undefined =>
    options.parentTextOf
      ? options.parentTextOf(id, key)
      : edgeKeyText(options.commitLog, lastIdxOf, id, key, maxTextChars);

  async function prime(root: CausalNode): Promise<void> {
    // Group the LLM-edge work per child so each child scores against ITS
    // own output in one influence-core call (one deduplicated embed batch
    // per child; the cache dedups across children).
    for (const node of flattenCausalDAG(root)) {
      if (!llmCallIds.has(node.runtimeStageId)) continue;
      const output = childText(node.runtimeStageId);
      if (output === undefined) continue;

      const evidence: EvidenceInput[] = [];
      const evidenceMeta: { parentId: string; stageName: string; key: string }[] = [];
      for (const edge of node.parentEdges) {
        if (edge.kind !== 'data' || edge.key === undefined) continue;
        const id = edgeKey(node.runtimeStageId, edge.parent.runtimeStageId, edge.key);
        if (weightOf.has(id)) continue; // already primed (idempotent)
        const text = parentText(edge.parent.runtimeStageId, edge.key);
        if (text === undefined) continue;
        evidence.push({ id, text, ancestorTexts: [] });
        evidenceMeta.push({
          parentId: edge.parent.runtimeStageId,
          stageName: edge.parent.stageName,
          key: edge.key,
        });
      }
      if (evidence.length === 0) continue;

      embedded.push(output, ...evidence.map((item) => item.text));
      const scores = await scoreInfluence({
        evidence,
        finalAnswerText: output,
        embedder: options.embedder,
        ...(options.weights !== undefined ? { weights: options.weights } : {}),
      });
      const scoreById = new Map(scores.map((item) => [item.id, item.score]));
      const order = edgeOrder.get(node.runtimeStageId) ?? [];
      for (let i = 0; i < evidence.length; i++) {
        const composite = scoreById.get(evidence[i].id) ?? 0;
        // Clamp to [0, 1]: negative cosine alignment is "no influence
        // signal", not "negative influence" — path products stay monotone.
        weightOf.set(evidence[i].id, Math.max(0, Math.min(1, composite)));
        order.push(evidenceMeta[i]);
      }
      edgeOrder.set(node.runtimeStageId, order);
    }
  }

  const weigh: EdgeWeigher = (child, parent, key, kind) => {
    if (kind !== 'data' || key === undefined) return undefined;
    if (!llmCallIds.has(child.runtimeStageId)) return undefined;
    return weightOf.get(edgeKey(child.runtimeStageId, parent.runtimeStageId, key));
  };

  function rankedParents(llmCallId: string): readonly RankedParentEdge[] {
    const order = edgeOrder.get(llmCallId);
    if (!order) return [];
    const ranked = order.map((meta) => ({
      parentId: meta.parentId,
      stageName: meta.stageName,
      key: meta.key,
      weight: weightOf.get(edgeKey(llmCallId, meta.parentId, meta.key)) ?? 0,
    }));
    // Stable sort: ties keep first-seen order — deterministic across runs.
    return ranked.sort((a, b) => b.weight - a.weight);
  }

  return {
    prime,
    weigh,
    rankedParents,
    embeddedTexts: () => [...embedded],
  };
}
