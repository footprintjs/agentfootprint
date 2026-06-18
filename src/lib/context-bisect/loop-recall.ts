/**
 * loop-recall — L3: the per-loop RECALL shortlist (proposal 006, the validated subset of 003).
 *
 * A per-loop influence scorer that RESCUES early-entered culprits into the top-k shortlist so
 * ablation has the right candidates to convict — a **recall booster that narrows before ablation,
 * NOT a #1 ranker** (H2 measured the #1-ranker as a loss; recall as a win: top-3 10/10 vs 9/10).
 *
 * Home: `context-bisect` (NOT influence-core — it consumes the `Trajectory` + `defaultSuspectClassifier`,
 * and influence-core is a leaf; context-bisect already depends on influence-core). Sibling to the
 * `contrastive` opt-in scorer pattern: a separate scorer, not a mutation of `scoreInfluence`.
 *
 * Mechanism (per loop, in order):
 *   1. Reuse `defaultSuspectClassifier` on the frame's contextSources → the SAME suspect identity
 *      the localizer emits (injectionId / toolName) — so a candidate joins 1:1 with a `Suspect`.
 *   2. Score each suspect's content vs the loop's OWN output (`intermediateText`, the per-loop
 *      anchor — NOT the final answer) via `scoreInfluence`. This per-loop signal is the win over
 *      plain final-answer influence: it catches a source in the loop it actually fed.
 *   3. Recency-weighted SUM: `score(s) = Σ_N recencyDecay^(lastLoop − N) · perLoop_N(s)`. Recent
 *      loops weigh more; rank descending for recall, return top-k.
 *
 * MECHANISM NOTE (the gate earned this): proposal 006 first proposed a FORWARD eligibility sum.
 * The recall@k gate measured it against the H2 prototype and it FAILED (forward up-weights early
 * loops → top-3 4/10). The H2 winner was a BACKWARD recency-weighted sum (top-3 10/10) — so that is
 * what ships. Measure-before-promote in action.
 *
 * HONESTY (must-read — folded in from review):
 * - **Correlational only.** Every `recallScore` is an embedding-geometry PROXY, never "because".
 *   The causal claim stays in ablation (`localizeContextBug`).
 * - **FA-dominated, not four-signal.** Per-loop sources carry `ancestorTexts: []`, so `adaptWeights`
 *   zeroes AVG+PERSIST (DEPTH constant) — the per-loop score is in practice cosine-to-the-loop-output.
 * - **Gate-validated mechanism.** The shipped recency sum reproduces H2 (top-3 10/10 vs plain 9/10)
 *   at the default recencyDecay; the gate FAILS promotion otherwise.
 * - **Thin, single-setup.** The recall win is 10/10 vs 9/10 (n=10, one fixture, one embedder/model).
 */
import type { Embedder, EvidenceInput, InfluenceWeights } from '../influence-core/index.js';
import { scoreInfluence } from '../influence-core/index.js';
import {
  defaultSuspectClassifier,
  type ClassifyContext,
  type SuspectClassifier,
} from './localize.js';
import type { LoopFrame, Trajectory } from './trajectory.js';
import type { HonestyFlag, SuspectKind } from './types.js';

/**
 * Default recency decay for the per-loop aggregation. A loop N's per-suspect score is weighted by
 * `recencyDecay^(lastLoop − N)` — recent loops weigh more. H2 swept `{0.5, 0.7, 0.9, 1.0}`; the
 * recall@k gate (running THIS shipped scorer) confirmed `0.5` and `0.7` reproduce top-3 10/10 vs
 * plain 9/10, while `≥0.9` does not — so the validated band is `[0.5, 0.7]` and the default is the
 * lowest measured winner, `0.5`. (We do NOT ship an unmeasured value.) `1` = uniform; `0` = last-loop-only.
 */
export const DEFAULT_RECENCY_DECAY = 0.5;

/** One recall-shortlist candidate — joins 1:1 with a localizer `Suspect` via `suspectId`. */
export interface LoopCandidate {
  /** The suspect identity the default classifier emits — `injectionId` / `toolName`. The join key. */
  readonly suspectId: string;
  /** Suspect kind (injection / memory / tool) — from the classifier. */
  readonly kind: SuspectKind;
  /** Normalized recall score in [0, 1] (= eligibility / max across candidates) — the display/threshold headline. */
  readonly recallScore: number;
  /** RAW backward recency-weighted sum (pre-normalization) — `Σ_N recencyDecay^(lastLoop−N)·perLoop_N`, the actual computed proxy magnitude. (Field name kept for back-compat; the shipped mechanism is the BACKWARD sum, not the original forward-eligibility proposal — see module doc.) */
  readonly eligibility: number;
  /** First loop index this suspect fed — why recall rescues early-entered culprits. */
  readonly enteredLoop: number;
  /** Per-loop track: the clamped per-loop score in each loop the suspect appeared. */
  readonly perLoop: readonly { readonly loopIndex: number; readonly recallScore: number }[];
  /** True if a loop it fed read untracked sources, or the trajectory was frame-truncated. */
  readonly incomplete: boolean;
}

/** The recall shortlist — ranked recall-first; `candidates` is already top-`k`. */
export interface LoopRecallShortlist {
  readonly candidates: readonly LoopCandidate[];
  readonly k: number;
  readonly recencyDecay: number;
  /** Standing caveats passed through from the trajectory (literal — review must-fix #4). */
  readonly honestyFlags: readonly HonestyFlag[];
}

export interface ShortlistEarlyCulpritsOptions {
  /** Embedder; wrap in an `EmbeddingCache` (scoring is O(frames × suspects)). */
  readonly embedder: Embedder;
  /** Recency decay; default {@link DEFAULT_RECENCY_DECAY}. Loop N weighted `recencyDecay^(lastLoop−N)`
   *  (1 = uniform, 0 = last-loop-only). Validated band `[0.5, 0.7]`. */
  readonly recencyDecay?: number;
  /** Shortlist size. Default 5. recall@k is the headline metric. */
  readonly k?: number;
  /** Override the suspect classifier (default `defaultSuspectClassifier`). */
  readonly classifier?: SuspectClassifier;
  /** Composite weights forwarded to `scoreInfluence`. */
  readonly weights?: InfluenceWeights;
  readonly signal?: AbortSignal;
}

interface ResolvedSuspect {
  readonly suspectId: string;
  readonly kind: SuspectKind;
  readonly text: string;
}

/** Build a ClassifyContext from a loop frame's contextSources (the localizer's view, per loop). */
function classifyContextFor(frame: LoopFrame): ClassifyContext {
  const byKey = new Map(frame.contextSources.map((s) => [s.key, s.value]));
  return {
    node: { incompleteSources: frame.incompleteSources } as unknown as ClassifyContext['node'],
    keysWritten: frame.contextSources.map((s) => s.key),
    valueOf: (key) => byKey.get(key),
  };
}

/** Resolve a frame to its content-bearing suspects (injection / memory / tool), dedup'd by suspectId. */
function suspectsOf(frame: LoopFrame, classify: SuspectClassifier): ResolvedSuspect[] {
  const seeds = classify(classifyContextFor(frame)) ?? [];
  const out: ResolvedSuspect[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const suspectId = seed.detail?.injectionId ?? seed.detail?.toolName;
    if (suspectId === undefined) continue; // skip 'stage' / 'arg' fallbacks — no content identity
    if (seen.has(suspectId)) continue;
    seen.add(suspectId);
    out.push({ suspectId, kind: seed.kind, text: seed.detail?.text ?? '' });
  }
  return out;
}

/**
 * Score a recorded agent run into a per-loop RECALL shortlist (L3). Works on BOTH flat and grouped
 * trajectories (it reads each frame's contextSources + intermediateText regardless of shape).
 *
 * Returns the top-`k` candidates ranked recall-first, each joinable 1:1 with a localizer `Suspect`
 * via `suspectId`. Feed it to `localizeContextBug({ shortlist })` to REORDER suspects before the
 * ablation budget is spent — narrow (recall), then convict (causal).
 */
export async function shortlistEarlyCulprits(
  trajectory: Trajectory,
  opts: ShortlistEarlyCulpritsOptions,
): Promise<LoopRecallShortlist> {
  const recencyDecay = opts.recencyDecay ?? DEFAULT_RECENCY_DECAY;
  const k = opts.k ?? 5;
  const classify = opts.classifier ?? defaultSuspectClassifier;
  const truncated = trajectory.truncated?.byFrames === true;
  // The last loop index — recency is measured back from here (weight = recencyDecay^(lastLoop − N)).
  const lastLoop = trajectory.frames.reduce((m, f) => Math.max(m, f.loopIndex), 0);

  // Per-suspect accumulators (keyed on suspectId — the no-double-count identity).
  const score = new Map<string, number>();
  const kindOf = new Map<string, SuspectKind>();
  const enteredLoop = new Map<string, number>();
  const perLoop = new Map<string, { loopIndex: number; recallScore: number }[]>();
  const incomplete = new Map<string, boolean>();

  for (const frame of trajectory.frames) {
    const suspects = suspectsOf(frame, classify);

    // Per-loop relevance: each suspect's content vs THIS loop's output (one batched call).
    let scoreById = new Map<string, number>();
    if (suspects.length > 0) {
      const evidence: EvidenceInput[] = suspects.map((s) => ({
        id: s.suspectId,
        text: s.text,
        ancestorTexts: [],
      }));
      const scored = await scoreInfluence({
        evidence,
        finalAnswerText: frame.intermediateText ?? '',
        embedder: opts.embedder,
        ...(opts.weights ? { weights: opts.weights } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      // Clamp to ≥0: a source dissimilar to the loop output contributes nothing, never subtracts.
      scoreById = new Map(scored.map((r) => [r.id, Math.max(0, r.score)]));
    }

    // Recency-weighted aggregation (the H2-VALIDATED mechanism — gate-confirmed over a forward sum):
    // weight a loop's per-suspect score by recencyDecay^(lastLoop − N), then SUM across loops. The
    // win over plain is the PER-LOOP signal (each source vs the loop it fed, not the final answer);
    // recencyDecay tunes how fast older loops fade (1 = uniform, 0 = last-loop-only).
    const weight = Math.pow(recencyDecay, lastLoop - frame.loopIndex);
    for (const s of suspects) {
      const sc = scoreById.get(s.suspectId) ?? 0;
      score.set(s.suspectId, (score.get(s.suspectId) ?? 0) + weight * sc);
      if (!kindOf.has(s.suspectId)) kindOf.set(s.suspectId, s.kind);
      if (!enteredLoop.has(s.suspectId)) enteredLoop.set(s.suspectId, frame.loopIndex);
      const track = perLoop.get(s.suspectId) ?? [];
      track.push({ loopIndex: frame.loopIndex, recallScore: sc });
      perLoop.set(s.suspectId, track);
      if (frame.untrackedReadsPresent || truncated) incomplete.set(s.suspectId, true);
    }
  }

  const max = Math.max(0, ...score.values());
  const candidates: LoopCandidate[] = [...score.entries()]
    .map(
      ([suspectId, sum]): LoopCandidate => ({
        suspectId,
        kind: kindOf.get(suspectId) ?? 'stage',
        recallScore: max > 0 ? sum / max : 0,
        eligibility: sum,
        enteredLoop: enteredLoop.get(suspectId) ?? 0,
        perLoop: perLoop.get(suspectId) ?? [],
        incomplete: incomplete.get(suspectId) ?? false,
      }),
    )
    // recall-first; ties keep earlier-entered first, then suspectId for stable determinism.
    .sort(
      (a, b) =>
        b.recallScore - a.recallScore ||
        a.enteredLoop - b.enteredLoop ||
        a.suspectId.localeCompare(b.suspectId),
    )
    .slice(0, k);

  return { candidates, k, recencyDecay, honestyFlags: trajectory.honestyFlags };
}
