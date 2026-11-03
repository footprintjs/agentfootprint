import type { MemoryFlavor, MemoryStrategyKind, MemoryType } from './dependencyTypes.js';

/**
 * The model this run STARTS with, and what may replace it mid-run.
 *
 * `model` is the agent's resolved default — the one `callLLM` sends unless
 * something overrides it. It is deliberately not the "final" model: a
 * `.configure()` resolver reads the run's input in the seed stage (AFTER this
 * event), and per-skill brains pick per iteration. Resolving `.configure()`
 * here to make this field "effective" would call a consumer's resolver twice
 * per run, and two calls can disagree — so the manifest names the starting
 * choice and {@link RunConfiguredLlmPayload.modelOverrides} names who is
 * allowed to change it. What each call REALLY used is on
 * `agentfootprint.stream.llm_start`, per call, as it always was.
 */
export interface RunConfiguredLlmPayload {
  /** `LLMProvider.name` — the effective provider, decorators included. */
  readonly provider: string;
  /** The agent's resolved default model. */
  readonly model: string;
  /**
   * Which mounted mechanisms may replace `model` during this run, by NAME —
   * `'configure'` (a `.configure()` resolver) and `'skill-brains'` (per-skill
   * providers/models, escalation included). Absent when nothing can: then
   * `model` is what every call of this run used, and an experiment can group
   * on it alone.
   */
  readonly modelOverrides?: readonly ('configure' | 'skill-brains')[];
}

/**
 * One mounted memory, by the names it DECLARED.
 *
 * The store itself is not named: `MemoryStore` declares no id and no kind, so
 * naming which backend was in play would mean inventing a label (a class name
 * that survives no bundler, say) and an invented label is exactly what an arm
 * must not be grouped on. What IS declared is here.
 */
export interface RunConfiguredMemoryPayload {
  /** The `defineMemory({ id })` — the same id `memory.*` events carry. */
  readonly id: string;
  /** `'episodic' | 'semantic' | 'narrative' | 'causal'`. */
  readonly type: MemoryType;
  /** The strategy KIND it was compiled from (`'window'`, `'topK'`, …).
   *  Absent for a hand-built definition, which declares none. */
  readonly strategy?: MemoryStrategyKind;
  /** `RetrievalStrategy.name`, when the memory was given a spelled-out
   *  retrieval rule. Absent for the `{ topK, threshold }` shorthand — which
   *  is a rule with no name, not the default one. */
  readonly retrieval?: string;
  /** The embedder in play, by its own `Embedder.id` (or the declared
   *  `embedderId` when the store embeds server-side and no embedder was
   *  passed). Absent when neither side named one. */
  readonly embedderId?: string;
  /** `'memory'` (conversation recall) or `'rag'` (corpus retrieval), when the
   *  definition declared which claim it makes. */
  readonly flavor?: MemoryFlavor;
}

/**
 * The mounted skill graph's routing posture. The OBJECT's presence means a
 * graph is mounted; each absent field means that half was not declared.
 */
export interface RunConfiguredSkillGraphPayload {
  /** The mount's `strictness` — how much authority the graph has over the
   *  model's own picks. Absent for a graph mounted without the turn-start
   *  cascade options (routing then works exactly as it did in 9.16). */
  readonly routing?: 'assist' | 'guard' | 'rails';
  /** Whether the cursor survives the turn. Absent for the same reason. */
  readonly continuity?: 'turn' | 'conversation';
  /**
   * `IntentScorer.name` — the `.classify()` scorer that routes turn starts.
   * Absent when the graph declares no classifier, INCLUDING a graph routed by
   * `entryBy()` / `entryByRelevance()`: those hand the agent a bound
   * `scoreEntries` function and never the strategy that owns it, so there is
   * no name here to report. `skill.turn_routed.scorer` names the scorer that
   * really ran, whichever door it came through.
   */
  readonly scorer?: string;
}

/**
 * The artifacts wiring. Presence means a store is configured; like
 * `MemoryStore`, `ArtifactStore` declares no id, so WHICH store is not named.
 */
export interface RunConfiguredArtifactsPayload {
  /** True when the placement dial is on — oversized tool results travel to
   *  the model as a claim ticket instead of inline text. The threshold is a
   *  number, not a name, so it is not carried. */
  readonly placement?: true;
  /** True when each run is filed as a recording artifact. */
  readonly recordings?: true;
}

/**
 * One applied recipe — the declared, versioned composition that produced part
 * of this agent (9.48.0).
 *
 * The pair is what makes the row worth reading: two runs of `support-desk` that
 * answered differently are a mystery until the record says one was `1.2.0` and
 * the other `1.3.0`. The recipe's `description` is deliberately not here — it
 * is prose about the composition, and the manifest carries what a consumer
 * BRANCHES on.
 */
export interface RunConfiguredRecipePayload {
  /** The composition's plain name, e.g. `'support-desk'`. */
  readonly id: string;
  /** Its SemVer version, e.g. `'1.2.0'`. Kept a SEPARATE field from `id` —
   *  a composed `'support-desk@1.2.0'` would be one string that two different
   *  pairs could produce as soon as either half may contain the separator. */
  readonly version: string;
}

/**
 * The run-configuration manifest — ONE event at run start naming which
 * adapters and strategies this run is about to use.
 *
 * ## Why it exists
 *
 * Swapping a strategy in this library is easy; ATTRIBUTING an outcome to it
 * was not. Every other event carries `meta.runId`, and the numbers are already
 * there (tokens, latency, iterations, routing, refusals, evidence verdicts) —
 * what was missing was the JOIN KEY that says which of them belong to the same
 * ARM. Two ports used to name what varied (`skill.turn_routed.scorer`,
 * `memory.retrieved.strategy`); everything else was anonymous, and grouping N
 * runs into labelled arms was the experimenter's own bookkeeping, differently
 * spelled in every study. Group by this payload and the arms name themselves.
 *
 * ## Names and ids ONLY — the hard rule
 *
 * No credentials, endpoints, connection strings, keys, tenants or principals,
 * and no config VALUE that could be one. A manifest that leaks an endpoint is
 * worse than no manifest: it travels into every recording, every vendor sink
 * and every shared trace, which is precisely where a secret must not be. When
 * the only handle on a component is a value (a directory, a URL, a table), the
 * component is reported as PRESENT and left unnamed. Pinned by test.
 *
 * ## Absence is a fact, never a guess
 *
 * An absent field means "not configured" or "the strategy did not say" — never
 * `'default'` or `'unknown'` filled in on a reader's behalf, the same
 * distinction `CostTickPayload.provider` already makes. `memories: []` is the
 * explicit "no memory is mounted".
 *
 * ## What it costs
 *
 * One small event per run, by design — the manifest of a run that emitted no
 * manifest cannot be recovered afterwards. It carries names, never lists that
 * grow with the workload (tool names ride `tools.offered`, injections ride
 * `context.injected`), so its size is bounded by the agent's CONFIGURATION and
 * not by the turn. Skipped entirely when nothing is listening.
 *
 * @example Group two runs into two arms
 * ```ts
 * const arms = new Map<string, string>();          // runId → arm label
 * agent.on('agentfootprint.agent.run_configured', (e) => {
 *   arms.set(e.meta.runId, `${e.payload.llm.model}/${e.payload.memories[0]?.retrieval ?? 'no-retrieval'}`);
 * });
 * agent.on('agentfootprint.agent.turn_end', (e) => {
 *   record(arms.get(e.meta.runId), e.payload.durationMs);
 * });
 * ```
 */
export interface AgentRunConfiguredPayload {
  /** The agent's stable id — the same one `meta.compositionPath` carries.
   *  A study that runs two differently-configured agents groups on this. */
  readonly agentId: string;
  readonly llm: RunConfiguredLlmPayload;
  /** The configured cache strategy cannot apply the declared policy.
   * Configuration metadata only; absent when caching is off or supported. */
  readonly cache?: {
    readonly requested: 'explicit' | 'default';
    readonly strategy: 'none';
    readonly status: 'not-applicable';
  };
  /** Which chart shape ran the loop. A strategy choice with its own
   *  behaviour, not a cosmetic one (see `AgentOptions.reactMode`). */
  readonly reactMode: 'classic' | 'dynamic' | 'dynamic-grouped';
  /** Every mounted memory, declaration order. `[]` means none is mounted —
   *  stated rather than omitted, because "no memory" is itself an arm. */
  readonly memories: readonly RunConfiguredMemoryPayload[];
  /** `WindowStrategy.name` — the one strategy `.window()` or `.compaction()`
   *  mounted (both doors set the same strategy). Absent = no window stage. */
  readonly window?: string;
  readonly skillGraph?: RunConfiguredSkillGraphPayload;
  /** The evidence gate's posture (`.namesAndNumbersFromEvidence()`).
   *  Presence means the gate is on; absence means it is not mounted. */
  readonly evidenceGate?: 'assist' | 'guard' | 'rails';
  readonly artifacts?: RunConfiguredArtifactsPayload;
  /**
   * The recipes `.recipe()` applied, in declaration order — which declared,
   * versioned composition produced this agent (9.48.0).
   *
   * ABSENT when none was applied, and that is the one asymmetry with
   * {@link memories}: "no memory" is an arm a study compares against, while
   * "no recipe" is the state of every agent written before recipes existed,
   * and an empty list on all of them would be new bytes in every recording for
   * a feature nobody used.
   */
  readonly recipes?: readonly RunConfiguredRecipePayload[];
}

export interface AgentOutputSchemaValidationFailedPayload {
  /** Validation error message (from Zod / parser), or a fixed sentence when
   *  `draftWithheld` is true — parser text can quote the draft. */
  readonly message: string;
  /** Validation stage — JSON parse vs schema validate. Lets dashboards
   *  distinguish "model emitted prose" (`json-parse`) from "model emitted
   *  JSON but wrong shape" (`schema-validate`); they trend differently
   *  under model drift. */
  readonly stage: 'json-parse' | 'schema-validate';
  /** Failing field path when the parser exposes one (e.g. `'amount.currency'`).
   *  Only set when `stage === 'schema-validate'`. */
  readonly path?: string;
  /** The raw string output that failed — useful for narrative entries showing
   *  "what the model actually said" alongside the validation error. Absent
   *  when `draftWithheld` is true. */
  readonly rawOutput?: string;
  /** An output policy governs delivery, and this draft never passed output
   *  admission: its text (`rawOutput`, and the parser's message) is withheld
   *  from the event stream. Rules still read it on `validationError`. */
  readonly draftWithheld?: true;
  /** 1-indexed attempt counter. `1` for the first failure, `2` for the
   *  retry that also failed, etc. */
  readonly attempt: number;
  /** Total output-schema failures in this gate execution. Same as
   *  `validationErrorHistory.length`. Distinct from `attempt` because a
   *  gate can also retry on non-validation errors (5xx, etc.) — this
   *  counts ONLY the schema-driven failures. */
  readonly cumulativeRetries: number;
}
