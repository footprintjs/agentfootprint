/**
 * context-bisect types — RFC-003 Part B: the contextual-bug localizer
 * ("git bisect for context").
 *
 * Pattern: assembly contract. Part B is pure ASSEMBLY over shipped pieces:
 *          footprintjs 9.8.0's complete causal DAG (control edges, honesty
 *          markers, `EdgeWeigher` hook) × influence-core scoring (D6) ×
 *          consumer-run counterfactual ablation. No new engine features,
 *          no new typed events.
 * Role:    `src/lib/context-bisect/` leaf. Exported via
 *          `agentfootprint/observe`.
 *
 * ## The two-tier honest-claims discipline (RFC-003 §B2)
 *
 * Every number in these types belongs to exactly ONE of two tiers, and the
 * docs say which:
 *
 *   - **CORRELATIONAL** — edge weights, suspect scores, rankings. These are
 *     deterministic embedding-geometry PROXIES (influence-core composite:
 *     semantic alignment between what a source wrote and what the LLM step
 *     produced). They mean "high semantic alignment", never "the model
 *     answered BECAUSE of this". A report without reruns stops here and is
 *     marked `mode: 'correlational'`.
 *
 *   - **CAUSAL** — ablation verdicts ONLY. A suspect earns `verdict:
 *     'confirmed'` exclusively by counterfactual evidence: the consumer's
 *     `AblationRunner` re-ran the scenario WITHOUT the suspect N seeded
 *     times and the outcome flipped (with baseline stability checked and
 *     variance reported — never a single-run verdict).
 *
 * Slice completeness is bounded by tracking — and SAYS so: untracked reads
 * (`$getArgs()` / env / silent reads), missing control-dependence lookups,
 * missing read tracking, and depth/node truncation all surface as
 * `honestyFlags` on the report, mirrored from footprintjs's own A2/A4
 * markers.
 */

import type { CommitBundle, RuntimeSnapshot, StageSnapshot } from 'footprintjs/advanced';
import type { ControlDepLookup } from 'footprintjs/trace';
import type { Embedder, InfluenceWeights } from '../influence-core/index.js';

// ─── Artifacts (input contract) ──────────────────────────────────────

/**
 * Minimal structural envelope for captured typed events — satisfied by
 * `AgentfootprintEvent` (collect with `agent.on('*', e => events.push(e))`).
 * Structural so a consumer can hand in any array shaped like this.
 */
export interface CapturedEventLike {
  readonly type: string;
  readonly payload: unknown;
  readonly meta: { readonly runtimeStageId: string };
}

/**
 * Minimal per-step quality lookup for trigger derivation — satisfied by
 * footprintjs's `QualityRecorder` (structural, decoupled).
 */
export interface QualityTriggerLookup {
  getLowest(): { runtimeStageId: string; entry: { score: number; stageName: string } } | undefined;
}

/**
 * The frozen evidence of one completed run — a structural SUPERSET of the
 * trace-toolpack's `TraceToolpackArtifacts`, so the same bag literal can
 * serve `traceToolpack(...)` and `localizeContextBug(...)`: every
 * runtimeStageId in the report drills straight into the toolpack tools.
 *
 * - `snapshot` — `executor.getSnapshot()` / `agent.getLastSnapshot()`.
 * - `controlDeps` — OPTIONAL `controlDepRecorder().asLookup()` from the
 *   run. With it, the slice includes `[control: <rule label>]` edges to
 *   the deciders that routed execution. Without it, the report carries the
 *   `no-control-deps` honesty flag.
 * - `quality` — OPTIONAL `QualityRecorder` from the run; its
 *   lowest-scoring step is the default trigger when `atStep` is absent.
 * - `events` — OPTIONAL captured typed events; used to extract LLM-call
 *   step ids (`stream.llm_start`) when `llmCallIds` is not given.
 * - `llmCallIds` — explicit override: the runtimeStageIds of LLM-call
 *   executions (the steps whose parent edges D7 weighs).
 */
export interface ContextBugArtifacts {
  readonly snapshot: RuntimeSnapshot;
  readonly controlDeps?: ControlDepLookup;
  readonly quality?: QualityTriggerLookup;
  readonly events?: readonly CapturedEventLike[];
  readonly llmCallIds?: readonly string[];
}

// ─── Suspects ────────────────────────────────────────────────────────

/**
 * What kind of context source a suspect is — picks which ablation adapter
 * applies. `'stage'` is the honest fallback for slice nodes the classifier
 * cannot map to an ablatable source (pipeline plumbing, plain stages).
 */
export type SuspectKind = 'tool' | 'injection' | 'memory' | 'arg' | 'stage';

/** Kind-specific identity + the text the semantic refinement embedded. */
export interface SuspectDetail {
  /** Tool name (kind 'tool'). */
  readonly toolName?: string;
  /** Injection id (kind 'injection' / 'memory') — `Injection.id`. */
  readonly injectionId?: string;
  /** Injection flavor (fact / skill / rag / memory / …), when known. */
  readonly flavor?: string;
  /**
   * The suspect's own content text (tool result / injection rawContent),
   * already redaction-scrubbed by footprintjs at commit time. This is
   * what the embedder saw for `semanticScore`.
   */
  readonly text?: string;
}

/**
 * One hop of a suspect's evidence path — the argmax-weight chain from the
 * trigger step back to the suspect. Control edges carry `kind: 'control'`
 * and (when decide() supplied one) the rule label in `key`.
 */
export interface EdgePathStep {
  /** Child (downstream) step. The first hop's `from` is the trigger. */
  readonly from: string;
  readonly fromName: string;
  /** Parent (upstream) step. The last hop's `to` is the suspect. */
  readonly to: string;
  readonly toName: string;
  readonly kind: 'data' | 'control';
  /** State key (data) or decide() rule label (control), when present. */
  readonly key?: string;
  /** Edge weight — 1.0 unless D7 weighed it (child was an LLM call). */
  readonly weight: number;
}

/** Per-run similarity statistics — variance ALWAYS reported (D9). */
export interface SimilarityStats {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  /** Population standard deviation across the N seeded reruns. */
  readonly stdev: number;
}

/** Evidence from N seeded ablation reruns of one probe. */
export interface AblationRunStats {
  /** Seeded reruns performed (the consumer's runner was called N times). */
  readonly samples: number;
  /** Runs where `outcomeChanged(original, ablated)` was true. */
  readonly flips: number;
  /** Embedding similarity of each ablated output to the original. */
  readonly similarity: SimilarityStats;
}

export type AblationVerdictKind = 'confirmed' | 'not-confirmed' | 'inconclusive';

/**
 * The ONLY causal claim in the report (§B2). `'confirmed'` = ablating the
 * suspect flipped the outcome in a MAJORITY of N seeded reruns while the
 * un-ablated baseline stayed stable. `'inconclusive'` = mixed flips, or an
 * unstable baseline (the scenario itself doesn't reproduce — no ablation
 * verdict is trustworthy then). `'not-confirmed'` = no flip observed; the
 * suspect's score remains a correlational proxy only.
 */
export interface AblationVerdict {
  readonly verdict: AblationVerdictKind;
  /** Human-readable claim, phrased at the right tier (causal vs proxy). */
  readonly claim: string;
}

/** One ranked suspect. */
export interface Suspect {
  /**
   * runtimeStageId of the slice node this suspect lives at — drillable
   * with the trace-toolpack tools (`trace_node(source)` etc.).
   */
  readonly source: string;
  readonly stageName: string;
  readonly kind: SuspectKind;
  readonly detail?: SuspectDetail;
  /**
   * The ranking key — CORRELATIONAL proxy (§B2):
   * `structuralScore × semanticScore` when a semantic refinement exists,
   * else `structuralScore`. Means "semantically aligned and causally
   * UPSTREAM", never "caused".
   *
   * Comparison caveat: a suspect WITHOUT content text (kind 'stage'/'arg',
   * or a path through control edges only) keeps its bare structural score
   * — an UPPER BOUND with no content evidence behind it. Plumbing can
   * legitimately rank above ablatable sources; the ablation verdicts (and
   * `semanticScore`'s presence) are what disambiguate.
   */
  readonly score: number;
  /**
   * Max-product of edge weights along the best path from the trigger to
   * this node (1.0 when no D7-weighted LLM edge is on the path).
   */
  readonly structuralScore: number;
  /**
   * Influence-core composite of the suspect's own content vs the trigger
   * step's output (clamped to [0, 1]); only for suspects with a known
   * content text. The same proxy disclaimers as D6 apply.
   */
  readonly semanticScore?: number;
  /**
   * TRUE when `score` includes a content signal (semanticScore present).
   * FALSE = path-only structural score — an UPPER BOUND that can reach 1.0
   * through control-edge paths alone; rank such suspects with care and
   * prefer ablation verdicts to disambiguate. (Machine-readable twin of
   * the "path only — no content signal" report marking.)
   */
  readonly hasContentEvidence: boolean;
  /** Evidence path, trigger → … → suspect, control edges labeled. */
  readonly edgePath: readonly EdgePathStep[];
  /** The counterfactual to run — absent for kind 'stage'. */
  readonly ablation?: AblationSpec;
  /** CAUSAL tier — present only when an `AblationRunner` was supplied. */
  readonly verdict?: AblationVerdict;
  /** The rerun evidence behind `verdict`. */
  readonly runs?: AblationRunStats;
}

// ─── Ablation (the counterfactual seam) ──────────────────────────────

/**
 * What to remove for one counterfactual rerun. The library BUILDS specs
 * (one per suspect kind) and provides `applyAblations` to apply them to
 * the inputs an agent is constructed from; the consumer's `AblationRunner`
 * re-runs the scenario with the spec applied.
 *
 * THE TOOL SEAM (documented because `AgentOptions` has no `ignoredTools`):
 * agentfootprint has no runtime tool kill-switch — tools enter an agent at
 * construction (`.tools([...])` / injection `inject.tools`). Tool ablation
 * therefore happens where tools are DECLARED: the runner rebuilds the
 * agent with `applyAblations(specs, { tools }).tools`. The same pattern
 * covers injections (rebuild without the excluded `Injection.id`s) and
 * memory (filter `MemoryEntry`s by id before attaching).
 */
export type AblationSpec =
  /** Drop these tools from the catalog the agent is built with. */
  | { readonly kind: 'tool'; readonly ignoredTools: readonly string[] }
  /** Drop these injections (facts / skills / instructions / steering / rag). */
  | { readonly kind: 'injection'; readonly excludeInjectionIds: readonly string[] }
  /** Drop these memory entries (matched by `MemoryEntry.id`). */
  | { readonly kind: 'memory'; readonly excludeMemoryIds: readonly string[] }
  /**
   * The suspect is run INPUT (`$getArgs()` / seed args) — there is nothing
   * the library can filter. The consumer's runner must override the arg
   * itself (e.g. re-run with a neutralized field). `source` names the step
   * that consumed the untracked input.
   */
  | { readonly kind: 'arg'; readonly source: string; readonly note: string };

/**
 * Consumer-supplied counterfactual runner: re-run the SAME scenario with
 * every spec in `specs` applied, and return the run's output text.
 *
 * Contract:
 * - `specs` may be empty — that is the BASELINE probe (re-run unchanged);
 *   its outputs measure the scenario's natural variance.
 * - `run.seed` varies 0..N-1 across the N samples of one probe. Thread it
 *   into any stochastic knob (sampling temperature seed, mock script
 *   selection) so reruns are deterministic-but-distinct; ignore it for
 *   fully deterministic scenarios.
 * - Build a FRESH agent/provider per call — scripted mock providers are
 *   stateful (replies consume in order).
 */
export type AblationRunner = (
  specs: readonly AblationSpec[],
  run: { readonly seed: number },
) => Promise<string>;

/**
 * Did the ablated output mean something DIFFERENT from the original?
 * Default: embedding similarity below `flipThreshold`. Override with a
 * domain comparator (e.g. compare extracted decisions) — recommended with
 * `mockEmbedder`, whose cosine compresses prose into ~0.85–0.97 (the C1
 * calibration note: absolute thresholds only with real embedders).
 */
export type OutcomeComparator = (original: string, ablated: string) => boolean | Promise<boolean>;

/** The rerun configuration that upgrades the report to the causal tier. */
export interface AblationRerun {
  readonly runner: AblationRunner;
  /** The original (buggy) output the reruns are compared against. */
  readonly originalOutput: string;
  /** Seeded reruns per probe. Default 3. Never below 2 (no single-run verdicts — D9). */
  readonly samples?: number;
  /** Outcome-flip comparator. Default: similarity < `flipThreshold`. */
  readonly outcomeChanged?: OutcomeComparator;
  /** Similarity floor for the DEFAULT comparator. Default 0.8. */
  readonly flipThreshold?: number;
  /** Ablate only the top-K ranked suspects that carry a spec. Default 5. */
  readonly maxSuspects?: number;
}

// ─── The report ──────────────────────────────────────────────────────

/** Slice-shape numbers — how much evidence the ranking stands on. */
export interface SliceStats {
  readonly nodes: number;
  readonly dataEdges: number;
  readonly controlEdges: number;
  /** Edges that received a D7 (LLM-influence) weight. */
  readonly weightedEdges: number;
  /** Nodes that ALSO consumed untracked sources (args/env/silent reads). */
  readonly incompleteNodes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  /** Present when a limit actually cut the slice (footprintjs A4). */
  readonly truncated?: { readonly byDepth: boolean; readonly byNodes: boolean };
}

export type HonestyFlagKind =
  | 'slice-truncated'
  | 'untracked-sources'
  | 'no-control-deps'
  | 'no-read-tracking'
  | 'no-llm-call-ids'
  | 'baseline-unstable';

export interface HonestyFlag {
  readonly flag: HonestyFlagKind;
  readonly note: string;
}

/** The localizer's full output (D8). */
export interface ContextBugReport {
  /** The trigger step the slice was rooted at. */
  readonly step: string;
  readonly stepName: string;
  /** Where the trigger came from. */
  readonly triggerSource: 'explicit' | 'quality' | 'custom';
  /** The quality score that selected the trigger (quality source only). */
  readonly triggerScore?: number;
  /**
   * `'correlational'` — no `AblationRunner` supplied: the report STOPS at
   * the ranking; every score is a proxy and no causal claim is made.
   * `'causal'` — suspects additionally carry ablation verdicts (§B2: the
   * verdicts are the only causal claims; the scores stay proxies).
   */
  readonly mode: 'correlational' | 'causal';
  /** Ranked suspects, best (most aligned + upstream) first. */
  readonly suspects: readonly Suspect[];
  readonly sliceStats: SliceStats;
  /** ⚠ everything that bounds what this report can honestly claim. */
  readonly honestyFlags: readonly HonestyFlag[];
  /** Baseline probe stats (causal mode only). */
  readonly baseline?: AblationRunStats;
}

// ─── Defaults ────────────────────────────────────────────────────────

export const CONTEXT_BISECT_DEFAULTS = {
  /** Slice depth budget (forwarded to `causalChain`). */
  maxDepth: 12,
  /** Slice node budget (forwarded to `causalChain`). */
  maxNodes: 80,
  /** Ranked suspects kept on the report. */
  maxSuspects: 12,
  /** Chars of written content embedded per step text (D7). */
  maxTextChars: 2000,
  /** Seeded reruns per ablation probe (D9 — never single-run verdicts). */
  samples: 3,
  /** Default similarity floor for the default outcome comparator. */
  flipThreshold: 0.8,
  /** Ablation probes budget for `bisectCulprits`. */
  maxProbes: 24,
  /** Independent-culprit search rounds for `bisectCulprits`. */
  maxCulprits: 4,
} as const;

// Re-exported so consumers of the localizer can type their own helpers
// without importing influence-core / footprintjs directly.
export type {
  CommitBundle,
  ControlDepLookup,
  Embedder,
  InfluenceWeights,
  RuntimeSnapshot,
  StageSnapshot,
};
