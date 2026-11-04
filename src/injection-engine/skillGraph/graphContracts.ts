import type { Injection, InjectionContext } from '../types.js';
import type { SkillGraphStart, SkillGraphStep } from './graphConfig.js';
import type { DecisionNode } from './decision.js';
import type { SkillEdge, SkillNode, SkillEntryOptions, SkillRouteOptions } from './graphRoutes.js';
import type { CursorMove } from './graphCursor.js';
import type { EntryScoring, EntryScorer } from '../entryScorer.js';
import type { GraphCheckup } from '../skillGraphCheckup.js';
import type { TurnRoutingPlan } from '../skillIntent.js';
import type { Embedder } from '../../memory/embedding/types.js';
import type { IntentScorer } from '../intentScorer.js';
import type { RoutingPolicy } from '../routingPolicy.js';

/** How `.build({ check })` reacts to the graph check-up. */
export type GraphCheckMode = 'throw' | 'warn' | 'off';

/** Options for `.build()`. */
export interface BuildOptions {
  /**
   * Run the build-time check-up (see `graph.checkup()`):
   *   • `'throw'` — throw if any ERROR-level problem (unknown-skill / no-entry);
   *   • `'warn'`  — console.warn every problem in dev mode (`enableDevMode()`), silent otherwise;
   *   • `'off'`   — skip it entirely.
   *
   * **Default `'throw'` since 8.7.0** (was `'warn'`), matching the object-literal
   * form. A graph with an error-level problem cannot start a turn at all, and under
   * the old default it built silently outside dev mode and failed at run time
   * instead. `'warn'` still means exactly what it says — never throws — so an
   * explicit `check: 'warn'` keeps the old soft behavior.
   *
   * `graph.checkup()` is always available regardless.
   */
  readonly check?: GraphCheckMode;
  /**
   * Tool names the AGENT exposes to every skill (`.tool()` / `.tools()` / a baseline
   * `ToolProvider`). Without them the skill-body contract check reads a body's
   * `lookup_order(id)` as a typo, because the graph only knows the tools its own
   * skills carry. Same field as `checkup({ knownTools })` — see `SkillGraph.checkup`.
   *
   * Omitted, the body-contract checks (`body-foreign-tool` / `body-unknown-tool`)
   * are DEFERRED out of this build pass and run once at Agent build instead, where
   * the full tool registry exists — see {@link SkillGraph.deferredBodyContract}.
   */
  readonly knownTools?: readonly string[];
  /**
   * FLAT graphs: stamp `autoActivate: 'currentSkill'` on every WIRED skill (every
   * skill an entry or a route mentions), exactly as a decision `.tree()` stamps its
   * leaves — so a skill's tools reach the LLM only while the graph is on it, instead
   * of every skill's tools landing in the always-on registry from iteration 1.
   *
   * Default `false` — additive behavior. Set `true` to scope tools explicitly.
   * A skill that declared its OWN `autoActivate` in `defineSkill(...)` always keeps
   * it: this fills the default, it never overrides. A listed-but-unwired skill is
   * not stamped — the graph does not route it, so the graph does not scope it.
   *
   * A decision `.tree()` takes this dial on `.tree(root, { scopeTools })` (object
   * form: the tree arm's own `scopeTools` field); setting it here alongside a tree
   * is refused so one dial cannot live in two homes.
   */
  readonly scopeTools?: boolean;
}

/** Options for `graph.checkup()`. */
export interface CheckupOptions {
  /**
   * Tool names the AGENT exposes to every skill — `.tool()` / `.tools()`
   * registrations and any always-on `ToolProvider`. A skill body may name them
   * freely: they are callable from every skill, so they are neither `body-unknown-tool`
   * (they exist) nor `body-foreign-tool` (they are not somebody else's).
   *
   * @example
   *   graph.checkup({ knownTools: ['lookup_order', 'list_skills'] });
   */
  readonly knownTools?: readonly string[];
}

/**
 * Object-literal form, FLAT arm — `start` + `steps` declare the routing.
 * `tree` is typed `never` here so `{ tree, start }` is a COMPILE error, not just
 * a build-time refusal (see `SkillGraphConfig`).
 */
export interface SkillGraphFlatConfig {
  /** Every skill in the graph (wired or not). */
  readonly skills: readonly Injection[];
  /** Where a turn starts. */
  readonly start?: SkillGraphStart;
  /** Tool-result transitions; `from`/`to` are skill ids resolved against `skills`. */
  readonly steps?: readonly SkillGraphStep[];
  readonly tree?: never;
  /**
   * Stamp `autoActivate: 'currentSkill'` on every WIRED skill (every skill an
   * entry or a step mentions), exactly as the tree arm already stamps its leaves —
   * a skill's tools reach the LLM only while the graph is on it. **Default `false`**
   * (today's additive behavior — every skill's tools visible from iteration 1);
   * A skill whose author set its own
   * `autoActivate` keeps it: the graph level is a default, never an override.
   * See {@link BuildOptions.scopeTools}.
   */
  readonly scopeTools?: boolean;
  /**
   * Phrasings this graph must claim NOWHERE — the negative routing rows. Same
   * machine as `.neverRoutes([...])`; see that method for what the check
   * proves and what it deliberately does not. A row a declared start rule
   * claims is an ERROR (`never-routes-claimed`), naming the rule.
   *
   * @example
   *   skillGraph({ skills, start: { rules }, neverRoutes: ['what is the weather'] });
   */
  readonly neverRoutes?: readonly string[];
  readonly check?: GraphCheckMode;
  /** Baseline agent tool names — see {@link BuildOptions.knownTools}. */
  readonly knownTools?: readonly string[];
}

/**
 * Object-literal form, TREE arm — a decision tree owns the routing, so there is
 * no entry menu and no cursor for `start`/`steps` to describe. Both are typed
 * `never` so the contradiction is a compile error.
 */
export interface SkillGraphTreeConfig {
  /** Every skill in the graph. Under `tree` this must be exactly the leaf set —
   *  a listed skill that is not a leaf would never load, and is refused. */
  readonly skills: readonly Injection[];
  /** A decision tree (instead of `start` + `steps`). */
  readonly tree: DecisionNode | Injection;
  /**
   * Scope each leaf's tools to the routed leaf. The object form's half of
   * `.tree(root, { scopeTools })` — added in 8.7.0, because until then this form
   * hard-coded `true` and the fluent form's only opt-out had no object-form twin.
   * Default `true`. See {@link TreeOptions.scopeTools}.
   */
  readonly scopeTools?: boolean;
  readonly start?: never;
  readonly steps?: never;
  /** A tree has no start RULES for a negative row to be judged against, so the
   *  type refuses it here and `build()` refuses it at runtime (see
   *  {@link SkillGraphBuilder.neverRoutes}). */
  readonly neverRoutes?: never;
  readonly check?: GraphCheckMode;
  /** Baseline agent tool names — see {@link BuildOptions.knownTools}. */
  readonly knownTools?: readonly string[];
}

/**
 * Object-literal form of a skill graph — an alternative to the fluent builder.
 * Listing `skills` INDEPENDENTLY of the wiring is the point: the check-up can then
 * flag a skill that was listed but never wired (the fluent builder only ever sees
 * skills that appear in an edge). Compiles to the SAME `SkillGraph`. `check`
 * defaults to `'throw'` here (a new surface, fail-loud).
 *
 * A UNION of two arms, because `tree` and `start`/`steps` are two ways to declare
 * the same thing and only one of them compiles: `{ tree, start }` is a type error
 * for a TypeScript consumer and a build-time refusal for everyone else (8.4.0 —
 * before, the tree silently won and the flat wiring was discarded). Valid tree-only
 * and flat-only configs typecheck exactly as they did.
 */
export type SkillGraphConfig = SkillGraphFlatConfig | SkillGraphTreeConfig;

/** Options for a decision `tree()`. */
export interface TreeOptions {
  /**
   * Scope the tool list to the routed leaf (the on-demand-tools default).
   *
   * A decision tree routes to EXACTLY ONE skill per iteration, so each leaf is
   * stamped `autoActivate: 'currentSkill'` — its `inject.tools` reach the LLM
   * ONLY when the tree routes there, instead of every skill's tools landing in
   * the always-on static registry on every call.
   *
   * `read_skill` cannot reach another LEAF mid-run (8.5.0): a tree has no cursor to
   * move, and this "exactly one leaf" property is one of the reasons — admitting a
   * second leaf would put two leaves' tools on the wire and make the dev-mode
   * exactly-one monitor warn. It said otherwise until 8.5.0, and the pick was
   * accepted and then silently dropped. The escape hatch is a skill registered
   * BESIDE the graph (`.skill(x)`, `.selfExplain()`), which really does activate by
   * `read_skill` and is admitted from anywhere.
   *
   * Default `true`. Set `false` for the legacy additive behavior (all leaves'
   * tools always visible). A leaf that sets its OWN `autoActivate` in
   * `defineSkill(...)` is always respected — this only fills the default.
   */
  readonly scopeTools?: boolean;
}

/** The metadata key carrying a skill's routing provenance. */
export const SKILL_GRAPH_METADATA_KEY = 'skillGraph' as const;

/**
 * The note a graph leaves for Agent build when its own build pass DEFERRED the
 * skill-body ↔ tool-contract checks (`body-foreign-tool` / `body-unknown-tool`) —
 * see {@link SkillGraph.deferredBodyContract}.
 */
export interface DeferredBodyContract {
  /** The graph's `check` mode — the severity the deferred run respects
   *  (`'off'` never defers: it stays off at agent build too). */
  readonly mode: 'throw' | 'warn';
}

/**
 * The metadata key carrying the {@link DeferredBodyContract} note on each COMPILED
 * skill. The graph-level `graph.deferredBodyContract` note names the deferral, but
 * skills reach an agent through more than one door — `.skillGraph(graph)` sees the
 * graph, `.skills({ list: () => graph.skills })` sees only the skills — so the note
 * also rides each skill's own metadata. Agent build collects it from the final
 * injection list, whichever door the skills came through, and runs the deferred
 * checks exactly once (skills found by BOTH the metadata and the graph note are
 * deduped by id).
 */
export const SKILL_GRAPH_DEFERRED_CONTRACT_KEY = 'skillGraphDeferredBodyContract' as const;

export interface SkillGraph {
  /** Skills with graph-derived triggers — feed to the Agent (`.skillGraph()` or
   *  `.skills({ list: () => graph.skills })`). */
  readonly skills: readonly Injection[];
  /** The declared edges (for tooling, overlays, tests). */
  readonly edges: readonly SkillEdge[];
  /** Drawn nodes: skill boxes for the flat entry/route model; predicate diamonds
   *  + skill leaves for a decision `tree`. Always present. */
  readonly nodes: readonly SkillNode[];
  /** A Mermaid flowchart of the declared graph — declared === drawn. */
  toMermaid(): string;
  /**
   * The CURSOR resolver — given an iteration context, where is the graph next?
   * Returns the skill id the graph should be *in* after this iteration:
   *   • cold start (`ctx.currentSkillId` unset) → the first matching `entry`,
   *     else the entry the model picked with `read_skill`;
   *   • a `from`-gated route whose predicate matches a result of the previous
   *     iteration's tool batch (`ctx.toolResults`, in call order; falls back to
   *     the singular `ctx.lastToolResult`) → its target;
   *   • else the model's `read_skill` pick (`ctx.pendingSkillPick`), which the
   *     runtime sets only after the reachability gate accepted it;
   *   • otherwise the current cursor unchanged (sticky stay).
   * A declared edge that fires always beats a same-turn model pick.
   * Pure + deterministic — the single source of truth shared by the compiled
   * route triggers and the agent loop's cursor-update stage, so the two can never
   * disagree. Flat entry/route graphs only; a decision `tree()` routes per-iteration
   * by predicate (no cursor) and returns the unchanged `ctx.currentSkillId`.
   *
   * **The cursor is PER RUN.** It describes where the graph is inside ONE
   * `agent.run()`, across that run's iterations. A second `run()` on the same agent
   * starts cold — at the entry — whatever skill the first run ended on: a skill graph
   * is a per-turn state machine, not conversation memory, and `currentSkillId` lives
   * in the run's own state. To resume where the last turn stopped, persist the id
   * yourself and start the next turn's graph from it (`start: { rules: [...] }`);
   * nothing in the graph will carry it across for you.
   */
  nextSkill(ctx: InjectionContext): string | undefined;
  /**
   * The same answer as `nextSkill`, plus WHICH CLAUSE produced it — the resolver
   * reporting its own reasoning instead of a consumer inferring it from the drawn
   * provenance (8.5.0). `explainNextSkill(ctx).to === nextSkill(ctx)`, always: there
   * is one resolver and `nextSkill` is a thin projection of this one, so the two can
   * never drift.
   *
   * The agent threads this into the injection engine, which stamps the result on
   * `agentfootprint.context.evaluated` as `cursorMove` — that is what lets
   * `routeRecorder()` mark a model-pick hop as a model pick instead of borrowing the
   * label of a declared edge that never fired.
   */
  explainNextSkill(ctx: InjectionContext): CursorMove;
  /**
   * The entries whose OWN `when` matched this iteration but which the cursor
   * SUPERSEDED — declaration order, ids only (8.15.0). Empty for a graph with no
   * conditional entries, for a decision `tree()`, and whenever the graph has no
   * cursor at all.
   *
   * A conditional entry is active exactly while the cursor is on it. That is a
   * suppression, and a suppression the run must not swallow: the agent threads this
   * into the injection engine, which stamps it on `agentfootprint.context.evaluated`
   * as `supersededIds`, beside the `cursorMove` that says where the graph went
   * instead. Reading the two together answers "why isn't my entry loading?" without
   * anyone having to re-run a predicate to guess.
   *
   * It rides the per-iteration event rather than `skill.reroute_superseded` on
   * purpose: this is a CONTINUOUS condition (an entry whose rule stays true while
   * the cursor is parked elsewhere is suppressed every iteration), while that event
   * means a discrete broken promise — a `read_skill` pick the gate accepted and
   * something else outranked. Per-iteration state belongs on the per-iteration event.
   *
   * Pure + deterministic. A predicate that throws is reported by the evaluator as
   * `skipped: 'predicate-threw'`, not here.
   */
  supersededEntries(ctx: InjectionContext): readonly string[];
  /**
   * The REACHABLE set — which skills the model may `read_skill`-jump to from the
   * current cursor. The agent's runtime gate rejects any `read_skill('id')` whose
   * `id` is not in this set (so the model can't leave the graph mid-run).
   *   • cold start (`currentSkillId` undefined) → the entry skills;
   *   • otherwise → the current skill's direct successors ∪ the entry skills, minus
   *     the current skill itself (deliberate "stay" is the no-tool-call ReAct stop).
   *
   * A decision `tree()` returns EMPTY (8.5.0). A tree routes by predicate on every
   * iteration and has no cursor to jump: its leaves compile to `rule` triggers, and a
   * `read_skill` call writes only `activatedInjectionIds`, which a `rule` trigger does
   * not read. Until 8.5.0 this returned all the leaves, so the gate accepted a leaf
   * pick, the tool answered "activated for the next iteration", and the leaf never
   * activated. That is the same clause 8.4.0 already applies everywhere else — a skill
   * is open only when its trigger is `llm-activated` — reaching the one set that had
   * escaped it. The escape hatch under a tree is the OPEN skills (anything registered
   * beside the graph: `.skill(x)`, `.selfExplain()`), which the agent's gate still
   * admits from any cursor.
   *
   * Pure + deterministic.
   */
  reachableSkills(currentSkillId?: string): readonly string[];
  /**
   * Score the entry candidates by relevance to the user's message — present ONLY
   * when the graph was built with `.entryByRelevance(embedder)`. Embeds
   * `ctx.userMessage` and each `when`-passing entry's `description`, cosine-scores
   * them, and softmaxes into a `relevance` share. The agent's PickEntry stage uses
   * `chosen` as the starting cursor (LLM-free, off the hot loop). Flat graphs only.
   */
  scoreEntries?(ctx: InjectionContext, signal?: AbortSignal): Promise<EntryScoring>;
  /**
   * Build-time check-up — inspect the declared graph for wiring mistakes (a skill
   * nobody can reach, an edge to an unknown skill, two un-prioritized edges from one
   * skill, no entry, a self-loop, an entry menu with no way to choose from it, a
   * transition the cold-start cursor can never take). Pure + side-effect-free; call
   * it whenever. `ok` is false iff there's an error-level problem (`unknown-skill` /
   * `no-entry`) — everything else is a warning, because a graph the model can still
   * navigate is not a broken graph.
   *
   * Pass `knownTools` when the agent registers baseline tools with `.tool()`: the
   * graph only knows the tools its own skills carry, so without them a body that
   * says `lookup_order(id)` is reported as naming a tool that exists nowhere.
   *
   * @example
   *   const report = graph.checkup({ knownTools: ['lookup_order'] });
   *   if (!report.ok) throw new Error(formatCheckup(report));
   */
  checkup(options?: CheckupOptions): GraphCheckup;
  /**
   * The turn-routing plan (SG-C) — what the agent's RouteTurn stage consumes:
   * the configured classifier (if any), the resolved tie policy, tier-1 rule
   * evaluation and the intent-candidate projection. Present on every FLAT
   * graph (a decision `tree()` routes by predicate and has no turn start to
   * route). Consumers never call it directly; `.skillGraph()` threads it.
   */
  readonly turnRouting?: TurnRoutingPlan;
  /**
   * How a turn's starting entry is chosen (SG-C) — `'scorer'`
   * (`.entryBy()`/`.entryByRelevance()`), `'model-read'` (`.entryByRead()`),
   * `'classify'` (`.classify()`), absent = the declaration-order cold walk.
   * Read by the agent mount for exactly one refusal: `strictness: 'rails'`
   * cannot honor `'model-read'` (that mode's entire entry mechanism is a
   * model pick).
   */
  readonly entrySelection?: 'scorer' | 'model-read' | 'classify';
  /**
   * The ASYNC intent audit (SG-C) — present ONLY when a classifier is
   * configured. Leave-one-out over the declared example corpus with the
   * CONFIGURED scorer (the router that will actually run — auditing with a
   * different scorer would prove nothing about production): each example is
   * scored against every intent, its own intent represented by its remaining
   * examples; a cross-match or near-tie is an `overlapping-intents` warning
   * naming the example, both intents and both numbers.
   *
   * Costs one scorer call per declared example — on `llmClassifier` that is
   * one MODEL call per example, so run it in CI, not per request. Honesty
   * boundaries ride every message: only the configured scorer's view is
   * checked, `when` predicates are opaque and never claimed checked, and
   * tier-1 rules that fire before the classifier are named as unaudited
   * shadowers. Absent without a classifier rather than answering
   * `{ ok: true }` for a question it cannot ask.
   */
  checkupIntents?(signal?: AbortSignal): Promise<GraphCheckup>;
  /**
   * Present when this graph's own build pass DEFERRED the skill-body ↔
   * tool-contract checks (`body-foreign-tool` / `body-unknown-tool`): built
   * WITHOUT `knownTools`, the graph cannot tell a typo from a baseline tool the
   * agent registers later — `lookup_order(id)` in a body and `lokup_order(id)`
   * look identical to it — so instead of reporting what it cannot prove, it
   * leaves this note and Agent build runs those checks exactly once, against the
   * agent's full tool registry. The note also rides each compiled skill's own
   * metadata ({@link SKILL_GRAPH_DEFERRED_CONTRACT_KEY}), so it is honored
   * whichever way the skills arrive — `.skillGraph(graph)` or
   * `.skills({ list: () => graph.skills })`.
   *
   * Absent when the checks already ran at graph build (`knownTools` was given —
   * the manual override stays an override) or were switched off (`check: 'off'`);
   * the agent then never re-runs them, so one problem is reported at one build
   * point, never both. `graph.checkup()` is unaffected — it always runs every
   * check over what it can see, and remains the graph-only lint surface.
   */
  readonly deferredBodyContract?: DeferredBodyContract;
}

export interface SkillGraphBuilder {
  /** Mark a skill as reachable at turn start (optionally intent-conditional). */
  entry(skill: Injection, opts?: SkillEntryOptions): SkillGraphBuilder;
  /** Declare an edge: after `from`'s work, `to` activates when the edge fires. */
  route(from: Injection, to: Injection, opts?: SkillRouteOptions): SkillGraphBuilder;
  /** Declare a decision TREE (v3): predicate nodes → skill leaves. Compiles each
   *  leaf to a path-conjunction trigger; renders as diamonds → boxes. By default
   *  each leaf is tool-scoped (`autoActivate: 'currentSkill'`) so only the routed
   *  skill's tools reach the LLM — opt out with `{ scopeTools: false }`. */
  tree(root: DecisionNode | Injection, opts?: TreeOptions): SkillGraphBuilder;
  /**
   * Pick the STARTING entry with a pluggable scorer STRATEGY — `keywordScorer()`
   * (no dependency, word overlap), `embeddingScorer(embedder)` (semantic), or your
   * own `EntryScorer`. The agent's PickEntry stage runs it ONCE per turn off the
   * hot loop and starts the cursor at the winner. Like `.entryByRead()`, this makes
   * the entries EXCLUSIVE (only the chosen one loads, token-efficient). The surfaced
   * `relevance` % powers the "Why this skill?" panel. Flat graphs only (a decision
   * `tree()` already routes by predicate). Mutually exclusive with `.entryByRead()`.
   */
  entryBy(scorer: EntryScorer): SkillGraphBuilder;
  /**
   * Sugar for `.entryBy(embeddingScorer(embedder))` — pick the starting entry by
   * SEMANTIC relevance (embed the message + each entry's `description`, cosine-score,
   * softmax → best match). LLM-free (an embedder, no extra model call), reproducible.
   * For a no-embedder router, use `.entryBy(keywordScorer())`.
   */
  entryByRelevance(embedder: Embedder): SkillGraphBuilder;
  /**
   * Let the LLM pick the STARTING entry by reading the menu — no embedder, no extra
   * model call. Like `.entryByRelevance()`, the entries become EXCLUSIVE (only the
   * chosen one loads, token-efficient), but the choice is the model's: on the first
   * turn no entry auto-loads, the agent is offered the entries via `read_skill`, and
   * its pick becomes the cursor. Use this when you have NO embedder (or embeddings
   * route poorly for your domain) — the agent's own LLM understands the request.
   * Flat graphs only; mutually exclusive with `.entryByRelevance()`.
   *
   * A `when` on an entry gates the AUTOMATIC pick only: if the model explicitly
   * picks a `when`-gated entry from the menu, it loads (8.3.0 — before, the pick
   * was accepted, reported as activated, and then silently dropped). Use `when`
   * here to say "don't route here on your own", never as a lock.
   */
  entryByRead(): SkillGraphBuilder;
  /**
   * Configure the turn-start INTENT CLASSIFIER (SG-C) — the tier-2 judge of
   * `match: { intent, examples }` entries. `classify` is the honest verb: it
   * classifies the NEW message against declared intents, where `.entryBy()`
   * means "rank descriptions and pick" — a different machine (menu-exclusive
   * winner, no floor, no stay). The entries become EXCLUSIVE (only the routed
   * one loads); the cold-start declaration-order walk is suppressed (the
   * cascade decides, or offers a menu — never the first-declared entry by
   * accident).
   *
   * The cascade, per turn: tier 1 — regex/keyword/`when` rules in declaration
   * order (binary, decisive); tier 2 — `scorer` over the declared intents,
   * judged under `policy` (defaults: `NEAR_TIE_MARGIN`/`MENU_SIZE`); tier 3 —
   * a near-tie or unmatched verdict offers a MENU through `read_skill`'s own
   * description, and the model picks (or stays). Every verdict is recorded on
   * `agentfootprint.skill.turn_routed` with the losers and the thresholds.
   *
   * `policy` here is the ONE override home for the tie policy (mirrors the
   * one-dial-one-home law `scopeTools` follows). Mutually exclusive with
   * `.entryBy()` / `.entryByRelevance()` / `.entryByRead()` — one entry
   * router per graph. Flat graphs only.
   */
  classify(scorer: IntentScorer, policy?: Partial<RoutingPolicy>): SkillGraphBuilder;
  /**
   * Declare phrasings this graph must claim **NOWHERE** — the negative form of
   * a rule's `examples`, and the one that catches the expensive failure.
   *
   * An under-triggering skill costs a turn (the model tier picks instead). An
   * OVER-triggering skill costs the answer: the wrong body enters the system
   * prompt and the wrong tools enter the tools slot, and everything said after
   * that is shaped by a skill with no business in the turn.
   *
   * It is declared on the GRAPH, not on a skill, because a phrase that must
   * route nowhere belongs to no skill: the assertion is satisfied only when
   * EVERY rule declines, and a row hung on one skill would vanish the day that
   * skill was deleted — exactly when a graph is re-partitioned, which is
   * exactly when over-triggering appears.
   *
   * `graph.checkup()` runs every declared start condition over the phrase on a
   * cold-start context and reports the rule that claims it, BY NAME, as an
   * ERROR (`never-routes-claimed`) — so a default `.build()` refuses.
   *
   * **What it proves, exactly:** no declared start RULE claims the phrase. Not
   * "no routing at all": an intent rule is judged by a classifier at run time, a
   * scorer / `.entryByRead()` menu ranks descriptions, and `read_skill` can
   * always open an open skill by name. That statement rides the report itself
   * (`checkup().notes`).
   *
   * Accepts one phrase or a list; call it as often as you like (rows
   * accumulate). A duplicate row is refused — one row already asserts it
   * against every rule.
   *
   * @example
   *   skillGraph()
   *     .entry(billing, { match: { keywords: ['refund', 'charge'] } })
   *     .neverRoutes(["what's the weather in Berlin"])
   *     .build();
   */
  neverRoutes(phrases: string | readonly string[]): SkillGraphBuilder;
  build(opts?: BuildOptions): SkillGraph;
}

/** The declared graph a SkillWalker walks — a permanent alias of
 *  {@link SkillGraph}, exported forever beside it (9.51.0). */
export type SkillMap = SkillGraph;
