import type { Injection, InjectionContext } from '../../../../injection-engine/types.js';
import type {
  CursorMove,
  EntryScoring,
  TurnRoutingPlan,
} from '../../../../injection-engine/skillGraph.js';
import { buildSkillGraphDeclared, type SkillGraphDeclaredMap } from '../../skillGraphDeclared.js';
import type { AgentOptions } from '../../types.js';
import type { SkillGraphOptions } from './options.js';

export type MountedGraph = {
  skills: readonly Injection[];
  nextSkill: (ctx: InjectionContext) => string | undefined;
  reachableSkills?: (currentSkillId?: string) => readonly string[];
  scoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>;
  /** The declared edges. Read for ONE thing: which skills the graph wires, so the
   *  read_skill gate can tell a skill the graph routes from one it never mentions
   *  (see `openSkillIds` in `build()`). Optional for forward-compat with graphs
   *  built before `edges` existed; absent → the graph wires nothing. */
  edges?: ReadonlyArray<{
    readonly to: string;
    /** The declared source (`null` = the synthetic START) — read since
     *  9.50.0 for the `skill.graph_declared` record. Optional for
     *  forward-compat; an edge that omits it is routed exactly as before
     *  but stays OFF the declared-map event (never completed by a guess). */
    readonly from?: string | null;
    /** The declared `SkillEdgeKind` — same 9.50.0 record, same posture. */
    readonly kind?: string;
    /** The author's caption — same 9.50.0 record, same posture. */
    readonly label?: string;
    /** The edge's declared DATA guard (9.51.0) — read for the
     *  `skill.graph_declared` record only, carried verbatim when it has
     *  the compiled shape and skipped otherwise (never completed). */
    readonly guard?: { readonly conditions?: unknown };
  }>;
  /** The same cursor resolver, reporting the clause that won (8.5.0). Optional for
   *  forward-compat; absent → no `cursorMove` on `context.evaluated`. */
  explainNextSkill?: (ctx: InjectionContext) => CursorMove;
  /** The entries the cursor law superseded this iteration (8.15.0). Optional for
   *  forward-compat; absent → no `supersededIds` on `context.evaluated`. */
  supersededEntries?: (ctx: InjectionContext) => readonly string[];
  /** The drawn nodes. Read for TWO things: a `predicate` node means this graph is
   *  a decision `tree()` (the gate's refusal says so out loud), and the node-id
   *  set is what a continuity cursor is validated against (`droppedResume`).
   *  Derived here rather than added to `SkillGraph` as a mode field — the shape
   *  is already public, and one fact should not be declared twice. */
  nodes?: ReadonlyArray<{
    readonly kind: string;
    readonly id?: string;
    /** The drawn caption (predicate diamonds) — read since 9.50.0 for the
     *  `skill.graph_declared` record only. */
    readonly label?: string;
  }>;
  /** The graph's turn-routing plan (SG-C) — tier-1 rules, intent candidates,
   *  the classifier and the resolved tie policy. Optional for forward-compat
   *  with graphs built before it existed; absent → the cascade cannot run
   *  (classify needs it; continuity degrades to nothing rather than guess). */
  turnRouting?: TurnRoutingPlan;
  /** How the graph picks a turn's starting entry (SG-C). Read for one
   *  refusal: `strictness: 'rails'` cannot honor `'model-read'`. */
  entrySelection?: 'scorer' | 'model-read' | 'classify';
  /** The graph's note that it deferred its body-contract checks to agent build
   *  (built without `knownTools` — see `SkillGraph.deferredBodyContract`).
   *  Optional for forward-compat; absent → the checks already ran at graph build
   *  (or were off), so this agent never re-runs them. Library-built graphs also
   *  stamp the note on each compiled skill's metadata, which `build()` prefers —
   *  this field is the fallback for a structurally-typed graph without the
   *  per-skill stamps (skills found by both are deduped by id). */
  deferredBodyContract?: { readonly mode: 'throw' | 'warn' };
};

export interface GraphMountPort {
  readonly opts: Pick<AgentOptions, 'reactMode'>;
  skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;
  skillGraphReachable?: (currentSkillId?: string) => readonly string[];
  skillGraphScoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>;
  skillGraphEdgeTargets?: readonly string[];
  skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove;
  skillGraphSupersededEntries?: (ctx: InjectionContext) => readonly string[];
  skillGraphIsTree: boolean;
  skillGraphNodeIds?: ReadonlySet<string>;
  skillGraphDeclared?: SkillGraphDeclaredMap;
  skillGraphBrainOptions?: Pick<SkillGraphOptions, 'providers' | 'escalation' | 'decider'>;
  skillGraphCascade?: {
    readonly turnRouting?: TurnRoutingPlan;
    readonly strictness: 'assist' | 'guard' | 'rails';
    readonly continuity: 'turn' | 'conversation';
    readonly nodeIds: ReadonlySet<string>;
  };
  skillGraphDeferredBodyContract?: {
    readonly mode: 'throw' | 'warn';
    readonly skills: readonly Injection[];
  };
  injection(injection: Injection): unknown;
}

export function mountSkillGraph<TReceiver extends GraphMountPort>(
  self: TReceiver,
  graph: MountedGraph,
  options: SkillGraphOptions | undefined,
  original: object,
): object {
  // Classic ReAct caches the system-prompt and tools slots after turn 1 (the
  // Context selector's `includeStatic`), while the injection engine — the loop
  // target — keeps running every iteration. A graph mounted on that mode
  // ADVANCES: routes fire, the cursor moves, `context.evaluated` honestly
  // reports skills activating — and none of it ever reaches the model,
  // because the slots that would carry the activated body and unlocked tools
  // were composed once and never again. Config that lies. Refused at build
  // (9.16.0), like `.selfExplain()` under classic and for the same caching
  // reason; `reactMode` is fixed at `Agent.create`, so this check is
  // order-safe wherever `.skillGraph()` appears in the chain.
  if (self.opts.reactMode === 'classic') {
    throw new Error(
      "AgentBuilder.skillGraph: reactMode 'classic' cannot honor a skill graph. " +
        'Classic caches the system-prompt and tools slots after turn 1, so a route-driven ' +
        "activation moves the cursor and shows up in the trace but the activated skill's " +
        'body and tools never reach the model — the run would record routing that the wire ' +
        "never saw. Use the default 'dynamic' mode (or 'dynamic-grouped'), which recomposes " +
        'the slots every iteration. Classic remains fine WITHOUT a graph: a fixed system ' +
        'prompt, fixed tools, and always-on steering all compose on turn 1 and stay valid.',
    );
  }
  // One agent routes with ONE graph. The second call used to replace the cursor,
  // the reachable set and the entry scorer while the FIRST graph's skills stayed
  // registered and active — so graph 1's route targets could never activate again
  // (their ids are absent from graph 2's reachable set, so even a model pick is
  // refused) and only its unconditional entries survived, as always-on bodies with
  // dead wiring. Nothing about that is recoverable at runtime, so it is refused
  // here (8.4.0).
  if (self.skillGraphNextSkill !== undefined) {
    throw new Error(
      'Agent.skillGraph(): a skill graph is already mounted, and one agent routes with ' +
        'ONE graph. The second call replaces the cursor, the reachable set and the entry ' +
        "scorer — the first graph's skills stay registered and active, so its own routes " +
        'could never fire again. Merge the two graphs into one skillGraph(...) ' +
        'declaration, or build one agent per graph.',
    );
  }
  for (const skill of graph.skills) self.injection(skill);
  // Capture the cursor resolver so the Injection Engine can `from`-gate route
  // triggers against the persisted `currentSkillId`. `nextSkill` is REQUIRED
  // (every `skillGraph().build()` supplies it). Pass the full `build()` result
  // here; for a bare skill list use `.skills({ list })` instead.
  self.skillGraphNextSkill = graph.nextSkill;
  // The reachable-set resolver gates read_skill to in-graph jumps (optional for
  // forward-compat with graphs built before reachableSkills existed).
  self.skillGraphReachable = graph.reachableSkills;
  // The relevance entry scorer (present only with `.entryByRelevance()`).
  self.skillGraphScoreEntries = graph.scoreEntries;
  // Which skills the graph WIRES (any declared incoming edge, deterministic or
  // bare). The gate uses it to leave a bare model edge `A → M` from-gated while
  // opening skills the graph never mentions.
  self.skillGraphEdgeTargets = (graph.edges ?? []).map((e) => e.to);
  // The clause-reporting resolver (8.5.0) and the one fact the gate's refusal
  // needs beyond the reachable set: is this a tree?
  self.skillGraphExplainNextSkill = graph.explainNextSkill;
  // The suppression reporter (8.15.0) — what the cursor law kept off the wire.
  self.skillGraphSupersededEntries = graph.supersededEntries;
  self.skillGraphIsTree = (graph.nodes ?? []).some((n) => n.kind === 'predicate');
  // The node-id set (9.19.0) — the brains check-up's map. Captured on every
  // mount; undefined when the graph object carries no `nodes` (a
  // structurally-typed graph), in which case declaring brains is refused
  // at build rather than validated against a map that does not exist.
  if (graph.nodes !== undefined) {
    self.skillGraphNodeIds = new Set(
      graph.nodes.flatMap((n) => (typeof n.id === 'string' ? [n.id] : [])),
    );
  }
  // The DECLARED map (9.50.0) — nodes + edges verbatim, descriptions from the
  // compiled skills. Projected ONCE here (the graph object is in hand only at
  // mount) so `createExecutor` can file it per run without holding the graph.
  self.skillGraphDeclared = buildSkillGraphDeclared(graph, graph.skills);
  // The brains options (9.19.0) — captured verbatim; folded + validated at
  // build(), where the final injection list (the other home) exists.
  if (
    options?.providers !== undefined ||
    options?.escalation !== undefined ||
    options?.decider !== undefined
  ) {
    self.skillGraphBrainOptions = {
      ...(options.providers !== undefined && { providers: options.providers }),
      ...(options.escalation !== undefined && { escalation: options.escalation }),
      ...(options.decider !== undefined && { decider: options.decider }),
    };
  }
  // ── The mount options (SG-C): posture + cursor span ────────────────────
  const strictness = options?.strictness ?? 'assist';
  const continuity = options?.continuity ?? 'turn';
  if (!['assist', 'guard', 'rails'].includes(strictness)) {
    throw new Error(
      `Agent.skillGraph: strictness '${String(strictness)}' is not a posture this library ` +
        `has. The three are 'assist' (today's gate — reachable picks admitted, divergence ` +
        `recorded), 'guard' (picks only from an offered menu) and 'rails' (the model never ` +
        `routes; rules/scorer/routes do).`,
    );
  }
  if (!['turn', 'conversation'].includes(continuity)) {
    throw new Error(
      `Agent.skillGraph: continuity '${String(continuity)}' is not a span this library ` +
        `has. 'turn' (default) — the cursor is per-run, exactly as always; ` +
        `'conversation' — the turn's final cursor rides the conversation checkpoint and ` +
        `becomes the default entry when that conversation is continued.`,
    );
  }
  if (continuity === 'conversation' && self.skillGraphIsTree) {
    throw new Error(
      "Agent.skillGraph: continuity: 'conversation' cannot be honored by a decision " +
        '.tree() — a tree routes by predicate on every iteration and has no cursor to ' +
        "carry between turns. Use the flat entry/route form, or keep continuity: 'turn'.",
    );
  }
  if (strictness === 'rails' && graph.entrySelection === 'model-read') {
    throw new Error(
      "Agent.skillGraph: strictness: 'rails' cannot honor .entryByRead() — that mode's " +
        'entire entry mechanism IS a model pick, and rails refuses model routing. Rank the ' +
        'entries with .entryBy(keywordScorer()) / .classify(...), declare start rules, or ' +
        "drop to strictness: 'guard' (the model picks only from an offered menu).",
    );
  }
  // The cascade needs the graph's turn-routing plan — a graph built by this
  // version always carries one. A structurally-typed graph without it cannot
  // be judged, and accepting the option while wiring nothing would be config
  // that lies, so it is refused by name.
  const needsPlan = graph.entrySelection === 'classify' || continuity === 'conversation';
  if (needsPlan && graph.turnRouting === undefined) {
    throw new Error(
      `Agent.skillGraph: ${
        graph.entrySelection === 'classify'
          ? 'this graph declares a classifier'
          : "continuity: 'conversation' was declared"
      }, but the graph object carries no \`turnRouting\` plan — the turn-start cascade ` +
        `cannot run without it. Build the graph with this version's skillGraph() (every ` +
        `flat graph it builds carries the plan), or drop the option.`,
    );
  }
  if (strictness !== 'assist' || continuity !== 'turn' || graph.entrySelection === 'classify') {
    // Wired only when something NEW was asked for — a bare `.skillGraph(g)`
    // on a scorer/read/plain graph stores nothing and changes nothing.
    self.skillGraphCascade = {
      ...(graph.turnRouting !== undefined && { turnRouting: graph.turnRouting }),
      strictness,
      continuity,
      nodeIds: new Set(
        (graph.nodes ?? []).flatMap((n) => (typeof n.id === 'string' ? [n.id] : [])),
      ),
    };
  }
  // The deferred body-contract note: the graph built without `knownTools`, so its
  // typo-vs-baseline-tool checks wait for `build()`, where the registry is real.
  // Library-built graphs also stamp the note on each skill's metadata (that is
  // what serves the `.skills({ list })` door); this capture is the fallback for
  // a structurally-typed graph without the stamps — `build()` dedupes by id.
  if (graph.deferredBodyContract) {
    self.skillGraphDeferredBodyContract = {
      mode: graph.deferredBodyContract.mode,
      skills: graph.skills,
    };
  }
  return original;
}
