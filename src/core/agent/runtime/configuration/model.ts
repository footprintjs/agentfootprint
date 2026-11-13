import type { CachePolicy, CacheStrategy } from '../../../../cache/types.js';

import type { LLMProvider } from '../../../../provider-contract/types.js';

import type { ResolvedEvidenceGate } from '../../evidence/types.js';
import type { ResolvedScriptTravel } from '../../scripts/types.js';
import type { Injection, InjectionContext } from '../../../../injection-engine/types.js';
import type {
  CursorMove,
  EntryScoring,
  TurnRoutingPlan,
} from '../../../../injection-engine/skillGraph.js';

import type { ToolRegistryEntry } from '../../../../tools/tools.js';

/** Static model, cache and skill declarations. */
export interface ModelConfiguration {
  readonly provider: LLMProvider;

  readonly model: string;

  readonly temperature?: number;

  readonly maxTokens?: number;

  readonly maxIterations: number;

  readonly systemPromptValue: string;

  /**
   * Cache policy for the base system prompt (set via
   * `.system(text, { cache })`). Default `'always'` — base prompt is
   * stable per-turn, ideal cache anchor. CacheDecision subflow reads
   * this when computing the SystemPrompt slot's cache markers.
   */
  readonly systemPromptCachePolicy: CachePolicy;

  /**
   * Global cache kill switch from `Agent.create({ caching: 'off' })`.
   * Threaded into agent scope at seed-time as `scope.cachingDisabled`;
   * read by the CacheGate decider every iteration (highest-priority rule).
   */
  readonly cachingDisabledValue: boolean;

  /**
   * The CacheStrategy this agent runs. Chosen at build time from the
   * provider's declared `promptCaching` (`cacheStrategyFor`) unless the
   * consumer passes one explicitly.
   */
  readonly cacheStrategy: CacheStrategy;

  readonly cacheStrategyIsOverride: boolean;

  readonly cacheUnsupported: 'explicit' | 'default' | undefined;

  readonly registry: readonly ToolRegistryEntry[];

  /**
   * The Injection list — Skills, Steering, Instructions, Facts (and
   * RAG, Memory). Evaluated each iteration by the
   * InjectionEngine subflow; active set is filtered by slot subflows.
   */
  readonly injections: readonly Injection[];

  /** Skill-graph cursor resolver (`graph.nextSkill`), set when built via
   *  `.skillGraph(graph)`. Plumbed into the Injection Engine so route triggers
   *  are `from`-gated against the persisted `currentSkillId`. */
  readonly skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;

  /** Skill-graph reachable-set resolver (`graph.reachableSkills`), set when built
   *  via `.skillGraph(graph)`. Plumbed into the tool-calls handler so `read_skill`
   *  is gated to in-graph jumps. Undefined → gate off. */
  readonly skillGraphReachable?: (currentSkillId?: string) => readonly string[];

  /** Skill-graph relevance entry scorer (`graph.scoreEntries`), set when built via
   *  `.skillGraph(graph)` with `.entryByRelevance()`. Drives the PickEntry stage.
   *  Undefined → no relevance entry routing (cold-start entry as before). */
  readonly skillGraphScoreEntries?: (
    ctx: InjectionContext,
    signal?: AbortSignal,
  ) => Promise<EntryScoring>;

  /** The `to` end of every edge the mounted graph declares — which skills the graph
   *  WIRES. Empty for a graph-less agent. Read only by `openSkillIds()`. */
  readonly skillGraphEdgeTargets: ReadonlySet<string>;

  /** Skill-graph cursor resolver that also reports WHICH CLAUSE won
   *  (`graph.explainNextSkill`, 8.5.0). Threaded to the Injection Engine, which
   *  stamps the result on `context.evaluated` as `cursorMove`. Optional — a graph
   *  built before it existed falls back to `nextSkill` and emits no `cursorMove`. */
  readonly skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove;

  /** Skill-graph suppression reporter (`graph.supersededEntries`, 8.15.0) — the
   *  conditional entries whose `when` matched while the cursor was elsewhere.
   *  Threaded to the Injection Engine, which stamps them on `context.evaluated` as
   *  `supersededIds`. Optional — a graph built before it existed routes identically
   *  and simply emits no `supersededIds`. */
  readonly skillGraphSupersededEntries?: (ctx: InjectionContext) => readonly string[];

  /** Is the mounted graph a decision `tree()`? Derived at build time from
   *  `graph.nodes` (a tree is the only shape with `predicate` nodes) — no new
   *  public field on `SkillGraph`. Read for ONE thing: the read_skill gate's
   *  refusal has to explain that a tree has no cursor to jump (8.5.0). */
  readonly skillGraphIsTree: boolean;

  /** The turn-start cascade wiring (SG-C, 9.17.0) — the graph's routing plan,
   *  the mount's posture/continuity, and the node-id set droppedResume checks
   *  against. Absent (every graph without the new options) → RouteTurn never
   *  mounts, the gate never postures, seed never restores a cursor, and the
   *  checkpoint shape is byte-identical. */
  /** The folded per-skill brains + escalation + decider (9.19.0) —
   *  validated at `AgentBuilder.build()`. Undefined = no brain anywhere:
   *  callLLM, the gate, seed and RouteTurn wire nothing new. */
  readonly skillBrains?: import('../../skillBrains.js').FoldedSkillBrains;

  /**
   * The evidence gate (9.35.0) — `.namesAndNumbersFromEvidence()`, resolved by
   * the builder. Undefined for every agent that did not ask for it, and that
   * undefined is the whole zero-cost guarantee: no decider change, no branch,
   * no scope key, no event.
   */
  readonly evidenceGate?: ResolvedEvidenceGate;

  /**
   * `.limitsTravelWithTheAnswer()` — whether the run's declared coverage
   * travels with the final answer: appended as a block to a prose answer, or,
   * when an output schema makes the answer TYPED, committed beside it as data
   * (`answerCoverage()`), because JSON followed by prose is not JSON. False for
   * every agent that did not ask for it; the RECORDING half of the coverage
   * primitives does not consult it.
   */
  readonly limitsTravelWithTheAnswerValue: boolean;

  /**
   * `.scriptTravelsWithTheAnswer()` — the resolved arm, or undefined for every
   * agent that did not ask. With `code: 'match'` on the gate it arms the
   * script record (`scriptRecordArmed`); alone it also picks the final stage.
   */
  readonly scriptTravel?: ResolvedScriptTravel;

  readonly skillGraphCascade?: {
    readonly turnRouting?: TurnRoutingPlan;
    readonly strictness: 'assist' | 'guard' | 'rails';
    readonly continuity: 'turn' | 'conversation';
    readonly nodeIds: ReadonlySet<string>;
  };
}
