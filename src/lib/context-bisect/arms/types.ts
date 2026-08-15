/**
 * Strategy arms — the SUBSTITUTION tier of the counterfactual engine.
 *
 * Pattern: sibling spec type, shared statistics.
 * Role:    answer "scorer A versus scorer B", "topK versus a re-ranker",
 *          "sliding-window versus token-budget" with the SAME seeded-rerun
 *          discipline the ablation tier uses — and without pretending a
 *          substitution is a removal.
 *
 * ## Why this is NOT a fifth arm on `AblationSpec`
 *
 * Ablation is REMOVAL. `AblationSpec` names inputs an agent is BUILT from and
 * `applyAblations` filters them out; the ablated agent is strictly smaller than
 * the original. Substitution is REPLACEMENT: the agent that re-ranks instead of
 * taking top-K is not smaller, it is different. Three concrete costs decided
 * this, and each one is a place a shared union would have produced a
 * confident-looking verdict for an incoherent comparison:
 *
 *  1. **`bisectCulprits` would accept it.** The union feeds a delta-debugging
 *     search (`bisect.ts`) whose premise is that probes are SUBSETS of removals:
 *     it halves the candidate set, probes each half, and returns a "minimal
 *     culprit set". Substitutions do not compose that way — swapping the scorer
 *     and swapping the window at once is a THIRD arm, not a bigger removal — and
 *     the answer it would print ("minimal culprit set = {scorer swap}") is the
 *     wrong tier of claim entirely: an arm is an alternative configuration, not
 *     a culprit. A type that lets an incoherent comparison reach a verdict is
 *     worse than the limitation it removes.
 *  2. **`rerunWithoutSources` would report it under `removed`.** Its result
 *     type, its `removableSources` vocabulary and every sentence it composes say
 *     "removing X". A substitution arriving through its `ignore` escape hatch
 *     would be described, in a field NAME, as something it is not.
 *  3. **`applyAblations` has nowhere to put it.** It returns filtered
 *     `{tools, injections, memoryEntries}`. A substitution is not a filter of
 *     those inputs; it is a construction choice made before they exist.
 *
 * The rejected third option — a `'strategy'` arm that genuinely ABLATES, i.e.
 * falls back to the library default — was rejected because "no retrieval at
 * all" and "re-rank instead of top-K" are different experiments and only the
 * second is what a researcher means. The manifest already treats `memories: []`
 * as an arm of its own; an arm that silently meant "the default" would answer a
 * question nobody asked while looking like it supported the one they did.
 *
 * So: sibling TYPE, shared STATISTICS. `AblationRunStats`, `SimilarityStats`,
 * `resolveSamples`, `similarityStats`, `costStatsFrom`, `probeFlipped` and
 * `defaultOutcomeComparator` are reused verbatim; nothing in `ablation.ts`,
 * `bisect.ts`, `rerun.ts` or `cost.ts` changed, so the four existing spec arms
 * behave identically (pinned by test/lib/context-bisect/ablation-union-pinned).
 *
 * ## What the library can and cannot DO with an arm
 *
 * For a removal the library can perform the intervention: `applyAblations`
 * filters the inputs. For a substitution it cannot — construction is the
 * consumer's code, and no library can reach into it and replace a scorer. What
 * it can do instead is DECLARE the arm and then VERIFY it took effect, because
 * 9.41.0 made configuration self-describing: `agentfootprint.agent.run_configured`
 * names the provider, model, react mode, window, each memory's strategy /
 * retrieval / embedder, the graph's posture and classifier, and the evidence
 * posture. {@link ArmFacets} is deliberately that same vocabulary, so a run's
 * own manifest — not the experimenter's bookkeeping — says which arm it belonged
 * to, and an arm whose runs contradict its declaration gets no verdict at all.
 *
 * An arm may ALSO carry `ablations`: removals ride inside an arm through the
 * unchanged removal machinery (`applyArm` → `applyAblations`). Composition, not
 * union — each type still means exactly one thing.
 */

import type { Embedder } from '../../influence-core/index.js';
import type {
  AblationRunStats,
  AblationSpec,
  AblationVerdict,
  OutcomeComparator,
  RunCost,
  SimilarityStats,
} from '../types.js';

// ─── The manifest, structurally ──────────────────────────────────────

/**
 * One mounted memory as the run manifest describes it — structurally satisfied
 * by `RunConfiguredMemoryPayload`.
 */
export interface ManifestMemoryLike {
  readonly id?: string;
  readonly type?: string;
  readonly strategy?: string;
  readonly retrieval?: string;
  readonly embedderId?: string;
  readonly flavor?: string;
}

/**
 * The run-configuration manifest, structurally — satisfied by
 * `AgentRunConfiguredPayload` (the payload of
 * `agentfootprint.agent.run_configured`, 9.41.0).
 *
 * Declared structurally, and every member optional, for the same reason
 * `CapturedEventLike` and `QualityTriggerLookup` are: `context-bisect` is a
 * LEAF. It must not import the event registry to read one payload, and a
 * consumer replaying manifests out of a saved recording must be able to hand in
 * any bag shaped like this.
 */
export interface RunManifestLike {
  readonly agentId?: string;
  readonly llm?: { readonly provider?: string; readonly model?: string };
  readonly reactMode?: string;
  readonly memories?: readonly ManifestMemoryLike[];
  readonly window?: string;
  readonly skillGraph?: {
    readonly routing?: string;
    readonly continuity?: string;
    readonly scorer?: string;
  };
  readonly evidenceGate?: string;
}

// ─── The arm ─────────────────────────────────────────────────────────

/** The memory facet of an arm — matched against the manifest's memory rows. */
export interface ArmMemoryFacet {
  /** Narrow the match to ONE mounted memory by `defineMemory({ id })`. Without
   *  it, ANY mounted memory satisfying the other fields counts as a match. */
  readonly id?: string;
  readonly type?: string;
  /** The compiled strategy KIND (`'window'`, `'topK'`, …). */
  readonly strategy?: string;
  /** `RetrievalStrategy.name` — the spelled-out retrieval rule. This is the
   *  field a "topK versus re-rank" study varies. */
  readonly retrieval?: string;
  readonly embedderId?: string;
  readonly flavor?: string;
}

/**
 * What ONE arm holds constant, in the vocabulary the run manifest speaks.
 *
 * Every field here has a counterpart in `AgentRunConfiguredPayload`, and that
 * is the whole point: a facet a consumer declares is a facet the engine can
 * CHECK against the run that actually happened. A configuration difference the
 * manifest cannot name (a prompt tweak, a temperature) is not expressible here
 * on purpose — declaring it would produce an arm label nothing can verify.
 */
export interface ArmFacets {
  /** `LLMProvider.name` of the effective provider. */
  readonly provider?: string;
  readonly model?: string;
  readonly reactMode?: 'classic' | 'dynamic' | 'dynamic-grouped';
  /** `WindowStrategy.name` — the "sliding-window versus token-budget" axis. */
  readonly window?: string;
  /** `IntentScorer.name` — the "scorer A versus scorer B" axis. */
  readonly scorer?: string;
  readonly routing?: 'assist' | 'guard' | 'rails';
  readonly continuity?: 'turn' | 'conversation';
  readonly evidenceGate?: 'assist' | 'guard' | 'rails';
  readonly memory?: ArmMemoryFacet;
}

/**
 * One configuration under test.
 *
 * `facets` is what the run manifest should say about this arm; `ablations` is
 * anything this arm additionally REMOVES, applied by the unchanged removal
 * machinery (`applyArm`). An arm needs at least one of the two — except the
 * baseline arm, which may declare nothing at all and mean "the configuration as
 * it stands".
 */
export interface StrategyArm {
  /** Stable label. Appears in every verdict sentence and keys the readout. */
  readonly id: string;
  readonly facets?: ArmFacets;
  /** Removals this arm also applies — the four `AblationSpec` kinds, unchanged. */
  readonly ablations?: readonly AblationSpec[];
}

// ─── The runner ──────────────────────────────────────────────────────

/**
 * What one seeded run of one arm reported back.
 *
 * `manifest` is the connection to 9.41.0: capture it with
 * `agent.on('agentfootprint.agent.run_configured', e => …)` inside the runner
 * (or hand the run's captured events to `manifestFromEvents`). Supplying it
 * turns "the experimenter says this run was arm B" into a checked fact.
 */
export interface ArmRunResult {
  readonly output: string;
  readonly cost?: RunCost;
  readonly manifest?: RunManifestLike;
}

/**
 * Consumer-supplied arm runner: BUILD the agent under `arm`'s configuration,
 * run the same scenario, return the output.
 *
 * The engine takes a factory, not an instance — the same shape `AblationRunner`
 * already has, and the reason a strategy comparison fits here at all. Contract,
 * identical in spirit to `AblationRunner`:
 * - `run.seed` varies 0..N-1 within ONE arm. Thread it into any stochastic
 *   knob so reruns are deterministic-but-distinct.
 * - Build a FRESH agent/provider per call (scripted mock providers are
 *   stateful).
 * - Apply `arm.ablations` with `applyArm` at construction.
 * - Returning a bare string is fine; the object form additionally unlocks the
 *   cost readout and the manifest check.
 */
export type ArmRunner = (
  arm: StrategyArm,
  run: { readonly seed: number },
) => Promise<string | ArmRunResult>;

// ─── Arm application (the manifest check) ────────────────────────────

/** One declared facet the run manifest contradicted. */
export interface ArmFacetMismatch {
  /** Dotted facet path — `'model'`, `'memory.retrieval'`, `'skillGraph.scorer'`. */
  readonly facet: string;
  readonly declared: string;
  /** What the manifest said. ABSENT means the manifest did not declare that
   *  field at all — which, per the manifest's own rule, means "not configured"
   *  and is therefore still a contradiction of a declared arm. */
  readonly observed?: string;
}

/** Did the arm the consumer DECLARED match the runs that actually happened? */
export interface ArmApplication {
  /** How many of this arm's seeded runs reported a manifest. */
  readonly manifestsSeen: number;
  /**
   * The declared facets were really compared against a manifest. FALSE when the
   * runner reported none, or when the arm declares only `ablations` (no
   * manifest names a tool catalog). Read this BEFORE `applied`.
   */
  readonly checked: boolean;
  /** Every seen manifest agreed with every declared facet. Meaningless when
   *  `checked` is false. */
  readonly applied: boolean;
  readonly mismatches: readonly ArmFacetMismatch[];
}

// ─── The null band (what "placebo" means for a substitution) ─────────

/**
 * The inert-intervention control for an arm comparison.
 *
 * The cost tier's leave-one-out placebo does NOT transfer: it works by holding
 * out one member of a POPULATION of peer suspects, and a comparison of two arms
 * has no such population — leaving an arm out leaves an experiment, not a
 * control. What does transfer is the placebo IDEA, in a stronger form: the
 * inert intervention is RE-RUNNING THE SAME CONFIGURATION, and the engine
 * already pays for it (the baseline arm's own seeded runs). Its similarity
 * spread against the reference is the null distribution a challenger must fall
 * outside of; `floor` is the strictest point of it.
 *
 * Two axes, two controls, and they are not interchangeable:
 *  - the COMPARATOR axis's control is the baseline arm's own flip count, which
 *    must be ZERO (the stability gate — same zero-tolerance rule `bisect.ts`
 *    and `localize.ts` use);
 *  - the SIMILARITY axis's control is this band.
 * The band only participates in a verdict when the flip comparator IS the
 * similarity comparator (`gates`). With a domain comparator the two axes are
 * different instruments, and vetoing a genuine decision flip with an embedding
 * statistic would suppress a true finding — so it is reported and not applied.
 */
export interface NullBand {
  readonly baselineArmId: string;
  /** The baseline arm's own similarity to the reference across its seeds. */
  readonly similarity: SimilarityStats;
  /** The floor a challenger's mean similarity must fall BELOW to be
   *  distinguishable from seed-to-seed noise (`similarity.min`). */
  readonly floor: number;
  /** The baseline reproduced EXACTLY on every seed (zero spread). The band is
   *  then a hard floor that any change clears — honest for a deterministic
   *  scenario, and only as strong as that determinism (a mock provider is
   *  reproducible in a way a real one is not). */
  readonly degenerate: boolean;
  /** The band participated in the verdicts (default comparator only). */
  readonly gates: boolean;
  /** Plain-language recap. PRESENTATION ONLY — read the fields as data. */
  readonly note: string;
}

// ─── The readout ─────────────────────────────────────────────────────

/** One arm's evidence. */
export interface ArmOutcome {
  readonly armId: string;
  readonly isBaseline: boolean;
  /** The same per-probe statistics the ablation tier reports (samples, flips,
   *  similarity mean/min/max/stdev, and `cost` when the runner reported one). */
  readonly runs: AblationRunStats;
  /** Every seeded answer, in seed order. */
  readonly answers: readonly string[];
  /** Mean similarity to the reference fell below the null band's floor. Always
   *  false for the baseline arm — an arm cannot be outside its own band. */
  readonly outsideNullBand: boolean;
  readonly application: ArmApplication;
  /**
   * The CAUSAL-tier claim for this arm versus the baseline arm. Absent on the
   * baseline arm itself (it is the reference, not a challenger).
   */
  readonly verdict?: AblationVerdict;
}

/** The finished comparison. */
export interface StrategyComparison {
  /**
   * The answer every arm's similarity and flip count was measured against.
   * `'prior-run'` — the caller's `originalAnswer`, i.e. the run that actually
   * happened. `'baseline-arm'` — no prior answer was supplied, so the baseline
   * arm's seed-0 answer became the reference; that seed then contributes a
   * trivially identical comparison and stability rests on the remaining N−1.
   */
  readonly reference: { readonly from: 'prior-run' | 'baseline-arm'; readonly text: string };
  readonly baselineArmId: string;
  /** The baseline arm reproduced the reference on EVERY seed. False ⇒ every
   *  verdict is `'inconclusive'`; nothing is trustworthy on an unstable
   *  scenario. */
  readonly baselineStable: boolean;
  readonly nullBand: NullBand;
  /** One row per arm, declaration order, baseline included. */
  readonly arms: readonly ArmOutcome[];
  /** Consumer-runner invocations spent (`samples × arms`). */
  readonly runsUsed: number;
  /** Plain-language recap. PRESENTATION ONLY — read the fields as data. */
  readonly summary: string;
}

export interface CompareStrategyArmsOptions {
  /** At least two, distinct, each non-baseline arm declaring something. */
  readonly arms: readonly StrategyArm[];
  readonly runner: ArmRunner;
  /** Embedder for the similarity readout, the null band and the default
   *  comparator. `mockEmbedder()` is fine offline. */
  readonly embedder: Embedder;
  /** Which arm is the incumbent. Default: the first arm. */
  readonly baselineArmId?: string;
  /** The answer the run that actually happened produced. Omit for a fresh A/B
   *  — the baseline arm's seed-0 answer becomes the reference. */
  readonly originalAnswer?: string;
  /** Seeded runs PER ARM. Default 3; clamped to ≥ 2 (never single-run claims). */
  readonly samples?: number;
  /** Did the answer CHANGE? Default: embedding similarity < `flipThreshold`.
   *  Passing one turns the null band OFF as a gate (see {@link NullBand}). */
  readonly answerChanged?: OutcomeComparator;
  /** Similarity floor for the DEFAULT comparator. Default 0.8. */
  readonly flipThreshold?: number;
}
