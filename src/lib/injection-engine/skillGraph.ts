/**
 * skillGraph — a declarative, visualizable skill-dependency graph (proposal 002).
 *
 * The consumer declares skills + routing EDGES; `skillGraph()` compiles each edge
 * to the existing injection-engine TRIGGER on the target skill — so the dynamic,
 * token-efficient loading the engine already does becomes *declared* and *drawn*.
 *
 *   .entry(skill, { when? })              → trigger: `always` (or `rule` if when)
 *   .route(a, b, { onToolReturn | when }) → b compiles to a CURSOR-GATED `rule`
 *   (a skill with no declared incoming edge keeps its default `llm-activated`
 *    trigger — still reachable via `read_skill`, drawn as a dashed "model" edge)
 *
 * **v2 keystone — `from` IS enforced (a sticky cursor state machine).** A skill
 * graph is a state machine over skills; the engine tracks which node it is in via
 * `InjectionContext.currentSkillId` (the cursor). One pure resolver — `resolveCursor`
 * (see `makeResolveCursor`), of which `nextSkill(ctx)` is the `.to` projection — is the
 * single source of truth: each route target B
 * compiles to the trigger `nextSkill(ctx) === B`, which delivers `from`-gating
 * (an edge `A→B` fires only while the cursor is on A — no cross-skill edge bleed),
 * stickiness (the cursor stays on B until an edge leaves B), and a clean handoff
 * (B deactivates the same iteration C activates). The Injection Engine's Evaluate
 * stage advances the cursor with the SAME ctx (`currentSkillId = nextSkill(ctx)`),
 * so the active set and the persisted cursor never disagree. The DRAWN edge kind
 * (`on-tool-return` vs `predicate`) is preserved for rendering even though the
 * compiled trigger is always a `rule`. `toMermaid()` renders declared === drawn.
 *
 * A decision `tree()` routes per-iteration by stable `ctx` predicates (no cursor)
 * and is unaffected by `from`-gating. It has no cursor for `read_skill` to move
 * either, so `reachableSkills()` is EMPTY there and the gate refuses a leaf pick
 * (8.5.0) — see `reachableSkills` for why honouring it would break three of this
 * module's own invariants.
 *
 * **One skill's turn at a time (8.15.0).** The keystone's third property — "B
 * deactivates the same iteration C activates" — now holds for EVERY node in a flat
 * graph, including an entry that carries a `when`. Such an entry used to compile to
 * `when(ctx) || cursor === id`, and the leftover rule clause meant an entry that
 * routed onward stayed loaded beside its own successor, on that iteration and every
 * one after it. A conditional entry is active exactly while the cursor is on it;
 * `when` decides where a turn STARTS. The one declared way to be co-active beside
 * the cursor is an entry with no `when` at all (`{ kind: 'always' }`), which is
 * untouched. A rule that matched while the cursor was elsewhere is reported, not
 * swallowed — see `supersededEntries`.
 *
 * **The model moves too (`read_skill`).** Scoped `read_skill` bounds the model to
 * `reachableSkills(cursor)` — the declared successors of where it stands, plus the
 * entries. A pick the gate ACCEPTS moves the cursor exactly like a declared edge
 * does (`ctx.pendingSkillPick`, honoured in `makeResolveCursor`), so what the gate
 * allows and what actually takes effect are the same set. A declared edge that
 * fires the same turn wins (`D1 > D2`, docs/design/skill-graph.md §4A.1) and the
 * run emits `agentfootprint.skill.reroute_superseded` rather than leaving the
 * model's answered-"activated" claim quietly unmet.
 *
 * **The resolver says WHY, it is not asked to be guessed.** `explainNextSkill(ctx)`
 * returns the destination AND the winning clause (`CursorMove`), decided at the same
 * `return`. The agent stamps it on `context.evaluated` as `cursorMove`, which is how
 * `routeRecorder()` can tell a model pick from a declared edge that happens to point
 * at the same skill (8.5.0 — before, the drawn build-time provenance was read as the
 * per-hop cause, so a model pick was recorded under a declared edge's label).
 */

import { devMode, devWarn } from './devWarn.js';
import type { ToolResultStatus } from './toolOutcome.js';
import { toolResultsOf } from './types.js';
import type { Injection, InjectionContext, InjectionTrigger } from './types.js';
import type { Embedder } from '../../memory/embedding/types.js';
import type { EntryScore, EntryScoring, EntryScorer } from './entryScorer.js';
import { embeddingScorer } from './entryScorer.js';
import {
  checkupGraph,
  formatCheckup,
  type CheckupTriggerKind,
  type GraphCheckup,
  type GraphProblem,
} from './skillGraphCheckup.js';
import { checkSkillContracts } from './skillContract.js';
import { checkArtifactVocabularies } from './skillVocabulary.js';
import { checkStartRuleExamples, validateStartRuleExamples } from './skillExamples.js';
import { checkNeverRoutes, neverRouteKey, validateNeverRoutes } from './skillNeverRoutes.js';
import { checkPartition } from './skillPartition.js';
import { checkEntryEvidence } from './skillEntryEvidence.js';
import {
  compileMatch,
  mermaidMatchCaption,
  type RouteWitness,
  type SkillMatch,
  type SkillMatchData,
} from './skillMatch.js';
import {
  compileGuard,
  mermaidGuardCaption,
  plainGuardCaption,
  type CompiledGuard,
  type GuardConditionEvidence,
  type SkillGuard,
  type SkillGuardData,
} from './skillGuard.js';
import type { IntentScorer } from './intentScorer.js';
import { resolveRoutingPolicy, type RoutingPolicy } from './routingPolicy.js';
import {
  buildTurnRoutingPlan,
  findDuplicateIntentExamples,
  runCheckupIntents,
  type TurnRoutingPlan,
} from './skillIntent.js';
export { formatCheckup } from './skillGraphCheckup.js';
export type { GraphCheckup, GraphProblem, GraphProblemCode } from './skillGraphCheckup.js';
// The data-matcher domain (`match:` on start rules) — one module owns the type,
// the compiler, the comparator and the caption; see ./skillMatch.ts.
export type { SkillMatch, SkillMatchData, RouteWitness } from './skillMatch.js';
// The data-guard domain (`guard:` on route edges, 9.51.0) — one module owns the
// type, the compiler, the evidence shape and the caption; see ./skillGuard.ts.
export {
  GUARD_HOP_KEYS,
  plainGuardCaption,
  type GuardConditionData,
  type GuardConditionEvidence,
  type GuardOperator,
  type GuardValue,
  type SkillGuard,
  type SkillGuardData,
  type SkillGuardOps,
} from './skillGuard.js';
// The turn-routing surfaces the graph exposes (SG-C) — the plan the agent's
// RouteTurn stage consumes, and the verdict POJO the resolver reads.
export type { TurnRoutingPlan } from './skillIntent.js';
export type { TurnRoute } from './routingPolicy.js';

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
   * Default `false` — today's additive behavior (10.0.0 flips the default to `true`).
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
 * One start rule: route the turn's start to `use` when the rule matches.
 * Exactly ONE of `match` (data) / `when` (code) per rule — the union enforces it
 * at the keystroke and the build refuses it for everyone else. A rule exists to
 * be conditional; for an unconditional start use `start: 'id'` / `{ use }`.
 */
export type SkillStartRule =
  | {
      readonly use: string;
      /** The code form — an opaque predicate over the iteration context. */
      readonly when: (ctx: InjectionContext) => boolean;
      readonly match?: never;
      /** The phrasings this rule claims — build-time TEST material. See
       *  {@link SkillEntryOptions.examples}. */
      readonly examples?: readonly string[];
    }
  | {
      readonly use: string;
      /** The data form — comparable, drawable, stored. See {@link SkillMatch}. */
      readonly match: SkillMatch;
      readonly when?: never;
      /** The phrasings this rule claims — build-time TEST material. See
       *  {@link SkillEntryOptions.examples}. */
      readonly examples?: readonly string[];
    };

/** Where a turn starts, in the object-literal (flat) form. */
export type SkillGraphStart =
  | string
  | { readonly use: string }
  | {
      readonly rules: ReadonlyArray<SkillStartRule>;
      /** The intent classifier (SG-C) — REQUIRED iff any rule declares
       *  `match: { intent }`. Same machine as `.classify(scorer)`. */
      readonly classify?: IntentScorer;
      /** Tie-policy override — the ONE override home, beside the scorer it
       *  governs. Same machine as `.classify(scorer, policy)`. */
      readonly routing?: Partial<RoutingPolicy>;
    }
  | {
      readonly entries: readonly string[];
      /** Rank the entries with a scorer strategy (`keywordScorer()`,
       *  `embeddingScorer(e)`, or your own). Takes precedence over `byRelevance`. */
      readonly scoredBy?: EntryScorer;
      /** Sugar: rank the entries with an embedder (cosine/softmax). Omit both → the
       *  LLM reads the menu and picks (`.entryByRead()`) — no model call. */
      readonly byRelevance?: Embedder;
    };

/** One tool-result transition in the object-literal (flat) form. */
export interface SkillGraphStep {
  readonly from: string;
  readonly to: string;
  readonly when?: SkillRouteOptions['when'];
  readonly onToolReturn?: string | RegExp;
  /** Route on the result's declared outcome status (9.19.0) — see
   *  {@link SkillRouteOptions.onToolStatus}. */
  readonly onToolStatus?: SkillRouteOptions['onToolStatus'];
  /** The edge's condition as DATA (9.51.0) — see
   *  {@link SkillRouteOptions.guard}. */
  readonly guard?: SkillRouteOptions['guard'];
  readonly label?: string;
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
   * 10.0.0 flips the default to `true`. A skill whose author set its own
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

// `EntryScore` / `EntryScoring` are owned by ./entryScorer.ts now (the scorer
// strategy produces them). Re-exported here so existing `from './skillGraph.js'`
// imports keep working.
export type { EntryScore, EntryScoring };

/** Deterministic routing into a skill, keyed on the last tool result. */
export interface SkillRouteOptions {
  /** Predicate on the previous iteration's tool result → activate the target
   *  on the next iteration. The common, controllable edge. `status` is
   *  present when the tool declared one on its result envelope (9.19.0).
   *
   *  `result` is the string the MODEL read — which artifact placement can
   *  replace with a claim ticket, so an operator raising or lowering
   *  `artifacts.placement.maxInlineChars` can change whether a text-matching
   *  edge fires. See {@link InjectionContext.lastToolResult}; route on
   *  `onToolReturn` / `onToolStatus` for a guard placement cannot move. */
  readonly when?: (result: {
    readonly toolName: string;
    readonly result: string;
    readonly status?: ToolResultStatus;
  }) => boolean;
  /** Sugar for "activate whenever this tool returns (any result)". String is an
   *  exact match; RegExp is tested against the tool name. */
  readonly onToolReturn?: string | RegExp;
  /**
   * Route on the result's declared OUTCOME, not its prose (9.19.0) — the
   * data half of the outcome-status normalization: a `'denied'` call must
   * never route like a `'success'`. Matches when a tool result of the batch
   * carries one of the named statuses on its envelope; a result with NO
   * declared status can never match (an undeclared outcome is not
   * evidence). Compose with `onToolReturn` to pin the tool too ("when
   * `refund` returns `'denied'`"); alone, any tool's matching status fires.
   * Data — comparable, drawable (`toMermaid()` captions it), stored. At
   * most one of `when` / `onToolStatus`: code or data, never both.
   */
  readonly onToolStatus?: ToolResultStatus | ReadonlyArray<ToolResultStatus>;
  /**
   * The DATA form of `when` (9.51.0) — the edge's condition declared as
   * comparable, drawable, recordable conditions instead of an opaque
   * predicate: `{ key: { eq | ne | gt | gte | lt | lte | in | notIn: value } }`,
   * every condition ANDed (the operator grammar deliberately mirrors
   * footprintjs's `WhereFilter` — see {@link SkillGuard}). This is the
   * SkillWalker's guard mover as data: the map is data, entry matchers are
   * data, `onToolStatus` arms are data — the guard was the last opaque
   * function on a route edge.
   *
   * Judged per tool result of the previous iteration's batch, exactly where a
   * `when` runs. Six hop keys read the hop directly (`toolName`, `result`,
   * `status`, `iteration`, `userMessage`, `currentSkillId`); any OTHER key
   * reads the top-level field of that name from the RESULT parsed as JSON —
   * `guard: { riskLevel: { gte: 'high' } }` routes on a tool that returned
   * `{"riskLevel":"high"}`. Being data buys four things a `when` can never
   * have: the check-up proves contradictions (`guard-unsatisfiable`),
   * `toMermaid()` captions the edge ("when riskLevel ≥ high"),
   * `skill.graph_declared` carries it into every recording, and each
   * evaluation that DECIDES a hop — taken or refused — leaves per-condition
   * evidence on `cursorMove.guard` / `cursorMove.guardsClosed`.
   *
   * COMPOSES with `onToolReturn` / `onToolStatus` ("this tool, this outcome,
   * AND these conditions"). At most one of `when` / `guard`: code or data,
   * never both — to combine declared conditions with extra logic, fold the
   * checks into your `when` predicate.
   */
  readonly guard?: SkillGuard;
  /** Caption rendered on the edge. Defaults to a derived label. */
  readonly label?: string;
}

/** Where a turn starts. `when` (optional) makes entry intent-conditional. */
export interface SkillEntryOptions {
  /**
   * Which entry the turn STARTS on — a predicate over the iteration context
   * (e.g. `ctx.userMessage`). The first entry whose `when` passes wins the
   * cold-start cursor.
   *
   * **It decides the start; it does not keep the skill on the wire (8.15.0).**
   * A conditional entry is active exactly while the cursor is on it — a route out
   * of it ends its turn, and its rule cannot bring it back while the graph is
   * somewhere else. Before 8.15.0 the rule re-activated it on every iteration, so an
   * entry that routed onward stayed loaded beside its own successor.
   *
   * Omit `when` → the skill is `always` active: a persistent base procedure, on
   * beside whatever the cursor is on. That is the declared way to ask for an
   * always-on skill; `when: () => true` is NOT the same thing any more. For "on
   * whenever this matches, wherever the graph is", use the flavor built for it —
   * `.steering(...)` / `.skill(...)` with its own `rule` trigger — rather than an
   * entry, which is a position in a state machine.
   */
  readonly when?: (ctx: InjectionContext) => boolean;
  /**
   * The DATA form of `when` — a declared matcher over the user's message instead
   * of a predicate (see {@link SkillMatch}): comparable by the check-up, captioned
   * by `toMermaid()`, stored on the compiled skill's provenance. Same start
   * semantics as `when` in every other way. At most ONE of `match`/`when` — both
   * set is refused at build time. Omitting both keeps this an `always` entry,
   * exactly as before.
   */
  readonly match?: SkillMatch;
  /**
   * The phrasings this rule CLAIMS — real messages a user would type that
   * should start the turn here. Optional, additive, and **fed to nothing at
   * run time**: the check-up reads them at build time and the routing never
   * sees them, so a rule with examples routes byte-identically to the same
   * rule without them.
   *
   * Things become PROVABLE once a phrase is declared, by RUNNING the compiled
   * matchers rather than comparing them:
   *
   *   • `example-misses-own-rule` — this rule does not claim its own example.
   *     An ERROR for a data `match` (it reads the user message and nothing
   *     else, so the no-match holds under every context) or for a predicate
   *     that THREW; a WARNING for an opaque `when` that returned false, which
   *     may be gated on conversation state and claim the phrase on a later
   *     turn (see the context note below);
   *   • `example-shadowed-by-earlier` (error) — an EARLIER rule claims the
   *     phrase first, so the turn starts somewhere your own example denies.
   *     This is the one `rules-shadowed-by-order` must stay silent about when
   *     the two rules use different regexes (intersection is not decided
   *     anywhere in this library) — a witness phrase decides it instead;
   *   • `example-shadowed-by-default` (warning) — the earlier claimant is an
   *     UNCONDITIONAL entry. The declaration-order cold start stops at a
   *     default; the turn-start cascade (a classifier, or `continuity:
   *     'conversation'`) reads the conditional rules only and skips it — and
   *     which one applies is decided at AGENT MOUNT, so the report names both
   *     readings instead of asserting one against the router;
   *   • `example-unclaimed` (warning) — NO rule claims the phrase, so the turn
   *     falls through to the model tier. Absence, which no matcher-vs-matcher
   *     analysis can catch.
   *
   * **The context they are judged on.** Every condition here runs on ONE
   * context — iteration 1, the phrase as `userMessage`, empty `history`, no
   * cursor — the context a turn's FIRST iteration hands a start rule. Turn 2 of
   * a conversation also starts cold in cursor terms while CARRYING history, so
   * a `when` gated on conversation state may claim the phrase on a turn this
   * check cannot run. That is why its no-match is a warning, and why every
   * message names the context it judged under.
   *
   * **Tier difference, and it matters.** In `match: { intent, examples }`
   * (tier 2) the examples are SCORING material: the classifier reads them at
   * RUN time to judge new messages. Here (tier 1) they are TEST material only.
   * The author-facing meaning is the same — "the phrasings this rule claims" —
   * the runtime role is not, and a rule may not carry both lists (refused at
   * build, naming the difference).
   *
   * The boundary: these checks prove things about the phrases you declared and
   * nothing about phrases nobody wrote. No warning is not proof of coverage —
   * `graph.checkup().notes` says so on the report itself.
   *
   * @example
   *   .entry(arrayInventory, {
   *     match: /\b(array|volume|pool)\b/i,
   *     examples: ["what's running on shpstrprncl101"],
   *   })
   */
  readonly examples?: readonly string[];
  readonly label?: string;
}

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

export type SkillEdgeKind =
  | 'entry'
  | 'predicate'
  | 'on-tool-return'
  | 'on-tool-status'
  | 'guard'
  | 'model';

export interface SkillEdge {
  /** Source skill id, or `null` for the synthetic START (an entry edge). */
  readonly from: string | null;
  readonly to: string;
  readonly kind: SkillEdgeKind;
  readonly label?: string;
  /** The DATA matcher on an entry edge, when the rule was declared as data
   *  (`match:`). `toMermaid()` captions the edge with it when no explicit
   *  `label` was given. */
  readonly match?: SkillMatchData;
  /** The DATA guard on a route edge, when one was declared (9.51.0) — rides
   *  additively beside the kind exactly as `match` rides entry edges (a
   *  guard composed with `onToolReturn`/`onToolStatus` keeps that kind; a
   *  guard alone is kind `'guard'`). `toMermaid()` captions a guard-only
   *  edge with it when no explicit `label` was given, and
   *  `skill.graph_declared` carries it into every recording. */
  readonly guard?: SkillGuardData;
}

/**
 * A decision-tree node (v3): a predicate that branches to a subtree (or a skill
 * LEAF) on each side. The tree compiles to per-skill triggers — each leaf's
 * trigger is the conjunction of the predicates on its root→leaf path (with
 * earlier-sibling negation for if/else exclusivity), evaluated per iteration. So
 * "predicate nodes that route" needs NO engine change — same evaluator.
 */
export interface DecisionNode {
  readonly kind: 'decision';
  readonly predicate: (ctx: InjectionContext) => boolean;
  readonly whenTrue: DecisionNode | Injection;
  readonly whenFalse: DecisionNode | Injection;
  /** Caption for the predicate node when drawn (e.g. "io intent?"). */
  readonly label?: string;
}

/** Build a decision node. Leaves are skills (an `Injection`); internal nodes are
 *  other `decideSkill(...)` results. (Renamed from `decide` in v7 to avoid
 *  colliding with footprintjs's `decide()`.) */
export function decideSkill(
  predicate: (ctx: InjectionContext) => boolean,
  whenTrue: DecisionNode | Injection,
  whenFalse: DecisionNode | Injection,
  label?: string,
): DecisionNode {
  return { kind: 'decision', predicate, whenTrue, whenFalse, label };
}

function isDecisionNode(n: DecisionNode | Injection): n is DecisionNode {
  return (n as DecisionNode).kind === 'decision';
}

/**
 * WHY the cursor landed where it did on one iteration — the winning clause of the
 * one cursor resolver, reported rather than guessed (8.5.0).
 *
 *   • `'entry'`      — cold start: the first entry whose `when` passed (or, on a
 *                      cascade graph, a tier-1 start rule won the turn);
 *   • `'route'`      — a declared, `from`-gated edge fired (D1);
 *   • `'model-pick'` — no declared edge fired, so the model's gate-accepted
 *                      `read_skill` pick moved the cursor (D2), at cold start or mid-run;
 *   • `'tool-proposal'` — no declared edge fired and an ACCEPTED
 *                      `propose-transition` tool effect moved the cursor
 *                      (9.19.0) — deterministic tool evidence, ranked between
 *                      the author's edges (D1 still wins) and the model's
 *                      pick (a tool outranks a guess);
 *   • `'intent'`     — the turn-start cascade's tier-2 scorer decisively routed
 *                      the turn (SG-C; `turn_routed` carries the numbers);
 *   • `'continuity'` — the inherited conversation cursor held the turn's start
 *                      (SG-C, `continuity: 'conversation'`);
 *   • `'decider'`    — the configured tier-3 decider resolved an outstanding
 *                      menu out-of-band and the turn starts on its pick
 *                      (9.19.0);
 *   • `'stay'`       — nothing fired; the cursor is sticky and stayed put;
 *   • `'none'`       — no cursor at all (cold start with nothing to enter, or a
 *                      decision `tree()`, which routes by predicate and has no cursor).
 *
 * This exists because the DRAWN provenance on a skill (`metadata.skillGraph`) answers
 * "how is this skill reachable" — a build-time fact — and was being read as "how did
 * we get here this turn". A model pick into a skill that also has a declared edge was
 * therefore attributed to that edge, label and all, in the recorded route.
 */
export type CursorMoveCause =
  | 'entry'
  | 'route'
  | 'model-pick'
  | 'tool-proposal'
  | 'intent'
  | 'continuity'
  | 'decider'
  | 'stay'
  | 'none';

/**
 * One tool result's routing implication inside a parallel batch (9.16.0) —
 * which call it was, and the edge target it matched. Named by
 * `skill.route_conflict` as the winner or a suppressed loser.
 */
export interface RouteBatchOutcome {
  /** The provider's tool_use id for the call. Absent only for a context that
   *  supplied the singular `lastToolResult` (which can never conflict). */
  readonly toolCallId?: string;
  /** The tool whose result matched an edge. */
  readonly toolName: string;
  /** The edge target that result routed to. */
  readonly target: string;
}

/**
 * Two or more results of ONE parallel batch matched edges to DIFFERENT
 * targets (9.16.0). The first in call order wins the cursor; the rest are
 * suppressed — and reported here rather than silently dropped, so the record
 * explains the hop the run did NOT take. Same-target matches are not a
 * conflict (they all asked for the move that happened).
 */
export interface RouteBatchConflict {
  /** The call-order-first match — the one that moved the cursor. */
  readonly winner: RouteBatchOutcome;
  /** Later matches to other targets, in call order, that did not move it. */
  readonly losers: readonly RouteBatchOutcome[];
}

/**
 * One guard's evaluation against one tool result (9.51.0) — the evidence a
 * data guard leaves whenever it DECIDES a hop: which edge, which result it
 * judged, and every condition with the value it saw. Two homes on the move:
 * `CursorMove.guard` (the taken hop's evaluation, verdict `true`) and
 * `CursorMove.guardsClosed` (the refusals, verdict `false`) — both ride
 * `context.evaluated.cursorMove` onto the record.
 */
export interface GuardEvaluation {
  /** The guarded edge. */
  readonly from: string;
  readonly to: string;
  /** The tool result this evaluation judged. */
  readonly toolName: string;
  /** The provider's tool_use id for that call, when the batch carried one. */
  readonly toolCallId?: string;
  /** `true` — the guard passed and the edge fired; `false` — the guard
   *  refused a hop whose other declared conditions were already met. */
  readonly verdict: boolean;
  /** Per-condition evidence, in declaration order — every condition, the
   *  summarized value it was judged against, and whether it passed. */
  readonly conditions: readonly GuardConditionEvidence[];
}

/** The cursor resolver's full answer: where, and by which clause. */
export interface CursorMove {
  /** The cursor after this iteration (what `nextSkill` returns). */
  readonly to?: string;
  /** The cursor before it. */
  readonly from?: string;
  /** The winning clause. */
  readonly by: CursorMoveCause;
  /** Present only when `by: 'route'` resolved a parallel batch whose results
   *  matched edges to different targets — the suppression, on the record.
   *  The Evaluate stage emits it as `agentfootprint.skill.route_conflict`. */
  readonly conflict?: RouteBatchConflict;
  /**
   * The EVIDENCE a tier-1 DATA matcher routed on (9.28.0) — the text out of the
   * user message that made the entry's rule true, bounded (see
   * {@link RouteWitness}). Present only for `by: 'entry'` moves decided by a
   * `match:` (RegExp / `{ keywords }` / `{ all }`) rule; a `when` predicate is
   * opaque code, an unconditional entry matched nothing, and a scorer's
   * evidence is its scores — all three record no witness.
   */
  readonly witness?: RouteWitness;
  /**
   * The EVIDENCE the winning guard routed on (9.51.0) — present only for a
   * `by: 'route'` move whose firing edge declared a `guard:`. The full
   * per-condition evaluation (verdict `true`), decided at the same return as
   * the destination, so the record can never quote a different judgment than
   * the one that routed.
   */
  readonly guard?: GuardEvaluation;
  /**
   * The guards that REFUSED this iteration (9.51.0) — every guarded edge out
   * of the cursor whose OTHER declared conditions a result met and whose
   * guard said no (verdict `false`; at most one record per edge, the first
   * refusal in call order). Present on whatever move resulted — including a
   * `'stay'`, where it answers "why didn't my guarded edge fire?" with the
   * conditions and the values that closed it, the same honesty
   * `supersededEntries` gives suppressed entries. An edge whose
   * `onToolReturn`/`onToolStatus` preconditions never matched is NOT here:
   * its guard never decided anything.
   */
  readonly guardsClosed?: readonly GuardEvaluation[];
}

/** A node in the drawn graph — a `predicate` diamond or a `skill` box. */
export interface SkillNode {
  readonly id: string;
  readonly kind: 'predicate' | 'skill';
  readonly label?: string;
}

/** One predicate on a skill's root→leaf decision path, and the branch taken. */
export interface SkillRoutingStep {
  /** The predicate's caption (the `decide(...)` label). */
  readonly label: string;
  /** Which side of the predicate leads to this skill. */
  readonly branch: 'yes' | 'no';
}

/**
 * The routing PROVENANCE stamped onto a compiled skill's `metadata.skillGraph`
 * — *why* this skill is reachable. It rides through to the `context.evaluated`
 * event when the skill activates, so commentary + the lens can narrate the real
 * routing (not just "a skill activated"). Observability only; the trigger logic
 * is unchanged.
 */
export interface SkillRouting {
  /** How the skill is reached: a decision `tree` leaf, a flat `entry`, a
   *  deterministic `route` edge, or `model` (read_skill-reachable). */
  readonly via: 'tree' | 'entry' | 'route' | 'model';
  /** Decision path (tree only): the predicates from root→leaf + branch taken.
   *  For a skill used as MULTIPLE tree leaves this is the FIRST path; all
   *  paths are in `paths`. */
  readonly path?: readonly SkillRoutingStep[];
  /** All decision paths reaching this skill (tree only; present when the same
   *  skill is the leaf of more than one branch — the compiler merges repeated
   *  leaves into ONE injection whose trigger ORs the path predicates). */
  readonly paths?: ReadonlyArray<readonly SkillRoutingStep[]>;
  /** Entry/route edge caption. */
  readonly label?: string;
  /** Source skill id (route only). */
  readonly from?: string;
  /** The compiled trigger kind for a route (`rule` / `on-tool-return`). */
  readonly triggerKind?: string;
  /** The DATA matcher that routes here (entry only, when declared as `match:`) —
   *  serializable, so commentary/lens can say WHICH pattern chose the skill. */
  readonly match?: SkillMatchData;
  /** The DATA guard on the first deterministic edge in (route only, when
   *  declared as `guard:`, 9.51.0) — serializable, the `match` twin. */
  readonly guard?: SkillGuardData;
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

interface EntryDecl {
  readonly id: string;
  /** The condition (compiled from `match` when the rule was declared as data). */
  readonly when?: (ctx: InjectionContext) => boolean;
  /** The serializable matcher behind `when`, when declared as data — what the
   *  check-up compares, `toMermaid()` captions, and the provenance stores. */
  readonly match?: SkillMatchData;
  /** The same compilation's EVIDENCE extractor (9.28.0) — what text in the user
   *  message made `when` true. Present only for the data forms; a `when`
   *  predicate is opaque code and has none. Called ONLY on the rule that won. */
  readonly witness?: (ctx: InjectionContext) => RouteWitness | undefined;
  /** The phrasings this rule claims (validated at declaration). Build-time TEST
   *  material — never read by the resolver, never on the wire. */
  readonly examples?: readonly string[];
  readonly label?: string;
}
interface RouteDecl {
  readonly fromId: string;
  readonly toId: string;
  readonly when?: SkillRouteOptions['when'];
  readonly onToolReturn?: string | RegExp;
  readonly onToolStatus?: SkillRouteOptions['onToolStatus'];
  /** The compiled guard (9.51.0): predicate + data + evidence evaluator, one
   *  compilation (see skillGuard.ts). */
  readonly guard?: CompiledGuard;
  readonly label?: string;
}

/** A route edge that fires on its own evidence — `when` code, a tool-name
 *  match, a declared status, or a data guard. NOT a model edge. The ONE
 *  predicate every determinism filter shares (9.19.0 folded four replicas
 *  into it when `onToolStatus` joined the family; `guard` joined in 9.51.0). */
function isDeterministicRoute(r: RouteDecl): boolean {
  return (
    r.when !== undefined ||
    r.onToolReturn !== undefined ||
    r.onToolStatus !== undefined ||
    r.guard !== undefined
  );
}

/** The declared status set, normalized to an array. */
function statusesOf(
  onToolStatus: NonNullable<SkillRouteOptions['onToolStatus']>,
): ReadonlyArray<string> {
  return Array.isArray(onToolStatus) ? onToolStatus : [onToolStatus as string];
}

/** Mermaid node ids must be identifier-safe; keep the original id as the label. */
function nodeId(id: string): string {
  return 'n_' + id.replace(/[^A-Za-z0-9_]/g, '_');
}

function toolMatcher(toolName: string | RegExp): (name: string) => boolean {
  return typeof toolName === 'string' ? (n) => n === toolName : (n) => toolName.test(n);
}

/** How a skill is identified back to its author in a refusal — the description is
 *  what tells two same-id skills apart (mirrors skillsFromDir naming both files). */
function describe(skill: Injection): string {
  return skill.description ?? '(no description)';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function skillGraph(): SkillGraphBuilder;
export function skillGraph(config: SkillGraphConfig): SkillGraph;
export function skillGraph(config?: SkillGraphConfig): SkillGraphBuilder | SkillGraph {
  const skillsById = new Map<string, Injection>();
  const entries: EntryDecl[] = [];
  const routes: RouteDecl[] = [];
  let treeRoot: DecisionNode | Injection | undefined;
  let treeScopeTools = true;
  let entryScorer: EntryScorer | undefined;
  let entryByReadFlag = false;
  let classifyScorer: IntentScorer | undefined;
  let classifyPolicy: Partial<RoutingPolicy> | undefined;
  // The negative rows, in declaration order. A graph that never calls
  // `.neverRoutes()` keeps an empty array and pays one length check at
  // check-up time — zero cost when unused.
  const neverRoutePhrases: string[] = [];

  /**
   * Register a skill under its id, refusing a second DIFFERENT skill under an id
   * already taken (8.4.0). Until then this was a bare `Map.set` — last write won,
   * silently, and the loser vanished from the compiled graph entirely: the flat
   * form kept the LAST body under the FIRST declaration's routing, the config form
   * dropped the first skill outright, and a tree kept the FIRST body and discarded
   * the second. `skillsFromDir` has always refused a collision inside its own
   * directory and `Agent.injection()` has always refused one on the agent, so the
   * graph was the only place in the library where two skills could quietly claim
   * one id — the id `read_skill` dispatches by and every edge routes by.
   *
   * Identity-based, deliberately: re-registering the SAME object is how the fluent
   * form works (`.entry(a).route(a, b)` remembers `a` twice) and how one skill sits
   * at two tree leaves (the compiler merges those into one ORed trigger).
   */
  const remember = (skill: Injection): string => {
    if (skill.flavor !== 'skill') {
      throw new Error(`skillGraph: "${skill.id}" is not a skill (flavor='${skill.flavor}').`);
    }
    const claimed = skillsById.get(skill.id);
    if (claimed && claimed !== skill) {
      throw new Error(
        `skillGraph: two different skills claim the id "${skill.id}" — ` +
          `"${describe(claimed)}" and "${describe(skill)}". Skill ids must be unique ` +
          `(read_skill dispatches by id, and every edge routes by id); rename one, or ` +
          `pass the SAME skill object to both places.`,
      );
    }
    skillsById.set(skill.id, skill);
    return skill.id;
  };

  const builder: SkillGraphBuilder = {
    entry(skill, opts) {
      const id = remember(skill);
      // Exactly one condition per entry: `match` (data) or `when` (code). Both set
      // is a contradiction — which one starts the turn? — refused rather than
      // silently ANDed or ORed. (Neither set stays the `always` entry it has
      // always been; the rules form additionally refuses "neither", because a
      // rule exists to be conditional — see the config translation below.)
      if (opts?.when !== undefined && opts?.match !== undefined) {
        throw new Error(
          `skillGraph: entry "${id}" sets both \`match\` and \`when\` — an entry takes ` +
            `exactly one condition. Use \`match\` (a RegExp, { keywords: [...] } or ` +
            `{ all: [...] } over the user message — comparable and drawable) OR \`when\` ` +
            `(a predicate over the iteration context). To combine a pattern with extra ` +
            `logic, fold the pattern into your \`when\` predicate.`,
        );
      }
      const compiled =
        opts?.match !== undefined ? compileMatch(opts.match, `entry "${id}"`) : undefined;
      // The phrasings this rule claims — validated where they are declared, so
      // an unusable list is refused at the keystroke instead of quietly proving
      // nothing at check-up time (skillExamples.ts owns every refusal).
      const examples = validateStartRuleExamples(opts?.examples, `entry "${id}"`, {
        hasCondition: opts?.when !== undefined || opts?.match !== undefined,
        isIntent: compiled?.data.kind === 'intent',
      });
      entries.push({
        id,
        when: compiled ? compiled.predicate : opts?.when,
        ...(compiled && { match: compiled.data }),
        ...(compiled?.witness && { witness: compiled.witness }),
        ...(examples && { examples }),
        label: opts?.label,
      });
      return builder;
    },
    route(from, to, opts) {
      const fromId = remember(from);
      const toId = remember(to);
      if (opts?.when && opts?.onToolReturn) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets both 'when' and 'onToolReturn' — pick one.`,
        );
      }
      // `when` is code, `onToolStatus` is data over the same result — both
      // set is a contradiction (which one fires the edge?). `onToolReturn`
      // COMPOSES with `onToolStatus` ("this tool, with this outcome"), so
      // that pair stays legal.
      if (opts?.when && opts?.onToolStatus) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets both 'when' and 'onToolStatus' — pick ` +
            `one. 'onToolStatus' is the data form (drawable, comparable); to combine a ` +
            `status with extra logic, read \`result.status\` inside your 'when' predicate.`,
        );
      }
      if (opts?.onToolStatus !== undefined && statusesOf(opts.onToolStatus).length === 0) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets 'onToolStatus: []' — an empty status ` +
            `set can never match, so the edge would be dead wiring. Name at least one ` +
            `status, or drop the field.`,
        );
      }
      // `when` is code, `guard` is data over the same hop — both set is a
      // contradiction (which one fires the edge?), refused exactly as
      // when+onToolStatus is. `guard` COMPOSES with onToolReturn/onToolStatus
      // ("this tool, this outcome, AND these conditions") — conditions AND
      // anyway, so the pair stays legal there.
      if (opts?.when && opts?.guard) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets both 'when' and 'guard' — pick one. ` +
            `'guard' is the data form (drawable, comparable, evidence-recorded); to ` +
            `combine declared conditions with extra logic, fold the checks into your ` +
            `'when' predicate.`,
        );
      }
      // ONE compilation (the compileMatch pattern): the predicate that routes,
      // the data the record carries, and the evidence evaluator — all from the
      // same conditions. Every malformed shape is refused here, by name.
      const guard =
        opts?.guard !== undefined ? compileGuard(opts.guard, `route ${fromId}→${toId}`) : undefined;
      routes.push({
        fromId,
        toId,
        when: opts?.when,
        onToolReturn: opts?.onToolReturn,
        ...(opts?.onToolStatus !== undefined && { onToolStatus: opts.onToolStatus }),
        ...(guard !== undefined && { guard }),
        label: opts?.label,
      });
      return builder;
    },
    tree(root, opts) {
      treeRoot = root;
      if (opts?.scopeTools === false) treeScopeTools = false;
      return builder;
    },
    entryBy(scorer) {
      entryScorer = scorer;
      return builder;
    },
    entryByRelevance(embedder) {
      entryScorer = embeddingScorer(embedder);
      return builder;
    },
    entryByRead() {
      entryByReadFlag = true;
      return builder;
    },
    classify(scorer, policy) {
      classifyScorer = scorer;
      classifyPolicy = policy;
      return builder;
    },
    neverRoutes(phrases) {
      // Validated at the keystroke, like a rule's `examples` — an unusable row
      // is refused where it was written instead of quietly asserting nothing at
      // check-up time. The already-declared set makes the duplicate refusal
      // work across calls, not just within one.
      neverRoutePhrases.push(
        ...validateNeverRoutes(
          phrases,
          '.neverRoutes(...)',
          new Set(neverRoutePhrases.map(neverRouteKey)),
        ),
      );
      return builder;
    },
    build(opts: BuildOptions = {}) {
      // One entry router per graph — classify is a third machine beside the
      // scorer and the model-read menu, and two of them deciding one turn
      // start would let the record and the routing disagree.
      if (classifyScorer && (entryScorer || entryByReadFlag)) {
        throw new Error(
          'skillGraph: pick ONE entry router — .classify(scorer) classifies the message ' +
            'against declared intents; .entryBy()/.entryByRelevance() rank descriptions; ' +
            '.entryByRead() lets the LLM read the menu. This graph configures more than one.',
        );
      }
      if (classifyScorer && treeRoot) {
        throw new Error(
          'skillGraph: .classify() is for flat entry/route graphs; a .tree() already routes ' +
            'by predicate on every iteration (there is no turn start for a classifier to route).',
        );
      }
      // Intent rules need their judge — an intent compiles to no message
      // predicate, so without a classifier the entry could never be chosen and
      // would silently never load. Refused with a stable code, like rule-id-exists.
      const intentEntries = entries.filter((e) => e.match?.kind === 'intent');
      if (intentEntries.length > 0 && !classifyScorer) {
        const problems: GraphProblem[] = intentEntries.map((e) => ({
          kind: 'error',
          code: 'intent-without-classify',
          message:
            `entry "${e.id}" declares match: { intent } and the graph configures no ` +
            `classifier — intent rules need one to be judged. Add ` +
            `\`classify: keywordScorer()\` (no dependency) or \`embeddingScorer(embedder)\`; ` +
            `\`llmClassifier(provider)\` if you want the model to judge.`,
          skill: e.id,
        }));
        throw new Error(
          `skillGraph: build-time check-up failed:\n${formatCheckup({ ok: false, problems })}`,
        );
      }
      if (entryByReadFlag && entryScorer) {
        throw new Error(
          'skillGraph: pick one of .entryByRead() or .entryBy()/.entryByRelevance() — not ' +
            'both (the LLM reads the menu, OR a scorer ranks it).',
        );
      }
      if (entryByReadFlag && treeRoot) {
        throw new Error(
          'skillGraph: .entryByRead() is for flat entry/route graphs; a .tree() already ' +
            'routes by predicate (no entry menu).',
        );
      }
      if (entryScorer && treeRoot) {
        throw new Error(
          'skillGraph: .entryBy()/.entryByRelevance() is for flat entry/route graphs; a ' +
            '.tree() already routes by predicate (the scorer would be ignored).',
        );
      }
      // One dial, one home: a tree declares tool scoping on `.tree(root, { scopeTools })`
      // (object form: the tree arm's own field). Accepting it here too would let the two
      // homes disagree, and only one of them would win — silently.
      if (treeRoot && opts.scopeTools !== undefined) {
        throw new Error(
          "skillGraph: `scopeTools` on build() is the FLAT arm's dial. This graph is a " +
            '.tree(), which declares tool scoping on .tree(root, { scopeTools }) (object ' +
            "form: the tree arm's own `scopeTools` field) — set it there instead.",
        );
      }
      // A negative row is judged against the START RULES, and a `.tree()` has
      // none — it routes by predicate on every iteration, with no turn start to
      // claim or decline a phrase. Accepting the rows here would run them
      // against an empty rule set and report a clean pass, which is the one
      // answer a negative assertion must never give by construction.
      if (treeRoot && neverRoutePhrases.length > 0) {
        throw new Error(
          `skillGraph: .neverRoutes(...) declares ${plural(
            neverRoutePhrases.length,
            'phrase',
            'phrases',
          )} that must claim no skill, but this graph is a .tree() — which routes by predicate ` +
            'on every iteration and has no start rules for a phrase to be judged against, so ' +
            'the rows would pass in silence and you would read that as proof. Assert them on ' +
            'a flat entry/route graph, or test the tree by running its predicates directly.',
        );
      }
      // A tree and the flat entry/route wiring are two ways to declare the same
      // thing, and only ONE of them compiles: the tree branch below never reads
      // `entries` or `routes`. Until 8.4.0 that was silent — the tree won and every
      // declared entry and route was dropped without a word, `checkup()` answered
      // `{ ok: true, problems: [] }` because its tree arm short-circuits, and the
      // author's flat wiring simply never existed at runtime.
      if (treeRoot && (entries.length > 0 || routes.length > 0)) {
        const dropped = [
          ...(entries.length > 0 ? [plural(entries.length, 'entry', 'entries')] : []),
          ...(routes.length > 0 ? [plural(routes.length, 'route', 'routes')] : []),
        ].join(' and ');
        throw new Error(
          'skillGraph: .tree() and .entry()/.route() both declare the routing and only one ' +
            `can compile — the tree wins, so the ${dropped} declared here would be silently ` +
            'dropped. tree() owns the graph: remove the .entry()/.route() calls, or drop ' +
            '.tree() and route with the flat entry/route form.',
        );
      }
      const skills: Injection[] = [];
      const nodes: SkillNode[] = [];
      const edges: SkillEdge[] = [];

      // The build-time check-up — pure over the declared entries/routes/skills,
      // PLUS the proposal-009 Tier-1 skill-body ↔ tool-contract checks (warnings).
      //
      // `triggerKinds` reads the COMPILED `skills` array (filled below, before any
      // caller can reach this closure) rather than the declaration, because that is
      // where the truth is: `deriveTrigger` returns null for an unwired skill, so the
      // skill keeps whatever trigger it arrived with — and `unreachable-skill`'s
      // sentence about read_skill is only true for `llm-activated`.
      const checkup = (options: CheckupOptions = {}): GraphCheckup => {
        const wiring = checkupGraph({
          skillIds: new Set(skillsById.keys()),
          // `conditional` counts a data `match` exactly like a `when` (it compiled
          // to one — an INTENT match compiles to no predicate but is judged by the
          // classifier, which is still a condition), so a rule-router built from
          // matchers is never read as a fan-out. The match DATA rides along so the
          // pairwise rule checks (`overlapping-rules` / `rules-shadowed-by-order`)
          // have something they can honestly compare.
          entries: entries.map((e) => ({
            id: e.id,
            conditional: e.when !== undefined || e.match?.kind === 'intent',
            ...(e.match && { match: e.match }),
          })),
          // A guard rides as DATA so the check-up can prove contradictions
          // (`guard-unsatisfiable`) — beside the only preconditions that are
          // provably comparable: an exact-string onToolReturn (a RegExp is not
          // decided) and the declared status set.
          routes: routes.map((r) => ({
            fromId: r.fromId,
            toId: r.toId,
            deterministic: isDeterministicRoute(r),
            ...(r.guard !== undefined && { guard: r.guard.data }),
            ...(typeof r.onToolReturn === 'string' && { onToolReturnExact: r.onToolReturn }),
            ...(r.onToolStatus !== undefined && {
              onToolStatuses: statusesOf(r.onToolStatus),
            }),
          })),
          isTree: treeRoot !== undefined,
          exclusiveEntries:
            entryScorer !== undefined || entryByReadFlag || classifyScorer !== undefined,
          triggerKinds: new Map(
            skills.map((s) => [s.id, s.trigger.kind as CheckupTriggerKind] as const),
          ),
          hasClassifier: classifyScorer !== undefined,
        });
        const contract = checkSkillContracts([...skillsById.values()], {
          ...(options.knownTools && { knownTools: options.knownTools }),
        });
        // The one PROVABLE intent-pair fact (SG-C) — the same example under two
        // intents. Composed here like the contract checks; the scorer-dependent
        // audit is the ASYNC `checkupIntents()`.
        const intentDuplicates = findDuplicateIntentExamples(entries);
        // The artifact vocabularies (SG-F, 9.25.0). Composed here like the
        // contract checks and NOT deferred: unlike a tool name, a `produces`
        // declaration cannot arrive later from `.tool()` — it is written on a
        // skill, and every skill of this graph is already in hand. Returns []
        // the moment nothing declares a vocabulary, so a graph that never
        // heard of the feature pays one `Array.some`.
        const vocabularies = checkArtifactVocabularies([...skillsById.values()]);
        // The declared phrasings (SG-G) — the three properties a witness phrase
        // makes provable. `orderDecides` is the SAME gate the pairwise rule
        // checks use: declaration order decides the turn start under the default
        // form and under a classifier's tier 1, and does not under a scorer /
        // `.entryByRead()` — where only the order-independent property is
        // claimed, and a note says which one was skipped. Returns frozen empties
        // the moment no rule declared examples, so a graph that never heard of
        // the feature pays one `Array.some` and reports the identical object.
        const examples = checkStartRuleExamples({
          entries,
          orderDecides:
            !(entryScorer !== undefined || entryByReadFlag) || classifyScorer !== undefined,
          hasClassifier: classifyScorer !== undefined,
        });
        // The NEGATIVE rows — phrases this graph claims NOWHERE. No
        // `orderDecides` gate: "nobody claims it" is an assertion every rule
        // has to satisfy, so the order they are read in cannot change the
        // answer (skillNeverRoutes.ts's header has the whole argument).
        const negatives = checkNeverRoutes({ entries, phrases: neverRoutePhrases });
        // The PARTITION advisories — how this graph cut the world into skills,
        // read from names and structure alone. Warnings, always: every signal
        // has a legitimate design behind it, and each message says which.
        const partition = checkPartition({
          skills: [...skillsById.values()],
          routeCount: routes.length,
          entryCount: entries.length,
          isTree: treeRoot !== undefined,
        });
        // The entry-evidence rows (9.58.0) — the two ONE-ROW facts about
        // guessed entries (skillEntryEvidence.ts has the whole argument,
        // including why the intuitive per-node exit lint is dead).
        const entryEvidence = checkEntryEvidence({
          entries: entries.map((e) => ({
            id: e.id,
            conditional: e.when !== undefined || e.match?.kind === 'intent',
            hasExamples: (e.examples?.length ?? 0) > 0,
          })),
          routeFromIds: new Set(routes.map((r) => r.fromId)),
          neverRoutesCount: neverRoutePhrases.length,
          isTree: treeRoot !== undefined,
        });
        const problems = [
          ...wiring.problems,
          ...intentDuplicates,
          ...contract,
          ...vocabularies,
          ...examples.problems,
          ...negatives.problems,
          ...partition,
          ...entryEvidence,
        ];
        // Notes are statements about the report's own REACH, and each check
        // brings its own — a graph that declared both examples and negative
        // rows carries both boundaries, in declaration order of the checks.
        const notes = [...examples.notes, ...negatives.notes];
        return {
          ok: !problems.some((p) => p.kind === 'error'),
          problems,
          ...(notes.length > 0 && { notes }),
        };
      };

      // The cursor resolver — the single source of truth for `from`-gated, sticky
      // routing. Flat mode wires it into each route target's trigger AND returns it
      // for the loop's cursor-update stage. Tree mode has no cursor (per-iteration
      // predicate routing), so it stays a no-op there.
      //
      // It resolves to a `CursorMove` — where AND by which clause — and `nextSkill`
      // is the `.to` projection of it (8.5.0). ONE resolver still: the cause is
      // decided at the same `return` that decides the destination, so an observer
      // can never disagree with the routing about why the cursor moved.
      let resolveCursor: (ctx: InjectionContext) => CursorMove = (ctx) =>
        ctx.currentSkillId === undefined
          ? { by: 'none' }
          : { from: ctx.currentSkillId, to: ctx.currentSkillId, by: 'stay' };
      // The reachable-set resolver — what `read_skill` may jump to from the cursor
      // (the runtime gate enforces it). Default empty; set per mode below.
      let reachableSkills: (currentSkillId?: string) => readonly string[] = () => [];
      // The suppression reporter (8.15.0) — conditional entries whose rule matched
      // while the cursor was elsewhere. Nothing to suppress without a cursor, so tree
      // mode and cursor-less graphs keep the empty default.
      let supersededEntries: (ctx: InjectionContext) => readonly string[] = () => [];
      // The relevance entry scorer — present only with `.entryByRelevance()` (flat).
      let scoreEntries:
        | ((ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>)
        | undefined;
      // The turn-routing plan (SG-C) — flat graphs only; a tree has no turn start.
      let turnRouting: TurnRoutingPlan | undefined;

      if (treeRoot) {
        // Decision-tree mode (v3): compile each leaf to a path-conjunction trigger.
        // Every leaf is REGISTERED as it compiles (8.4.0). Two things ride on that:
        // the duplicate-id refusal now covers leaves (before, two different skills
        // sharing an id as two leaves merged, first body wins, silently), and the
        // skill-CONTRACT checks finally run for a fluent `.tree()` graph — until
        // 8.4.0 `skillsById` stayed empty there, so `checkup()` answered
        // `{ ok: true, problems: [] }` for a tree whose body called a tool that
        // does not exist, while the byte-identical config-form graph reported it.
        compileTree(
          treeRoot,
          () => true,
          { skills, nodes, edges },
          null,
          { n: 0 },
          [],
          treeScopeTools,
          remember,
        );
        attachExactlyOneLeafMonitor(skills);
        const leafIds = skills.map((s) => s.id);
        // A tree routes to its LEAVES and to nothing else, so a skill listed in
        // `skills[]` that is not a leaf is compiled out of the graph entirely — it
        // never reaches the agent, so no trigger, no `read_skill`, no body, ever.
        // Refused by name rather than dropped (8.4.0).
        const leafSet = new Set(leafIds);
        for (const id of skillsById.keys()) {
          if (leafSet.has(id)) continue;
          throw new Error(
            `skillGraph({ tree }): skill "${id}" is listed in skills[] but is not a leaf of ` +
              'the tree, so it would never load — a tree routes only to its leaves. Add it ' +
              `to the tree as a leaf, drop it from skills[], or register it on the agent ` +
              `with .skill(${id}) to keep it read_skill-reachable.`,
          );
        }
        // Tree mode has no cursor, so `read_skill` has nothing to jump — EMPTY (8.5.0).
        //
        // Until 8.5.0 this answered `leafIds`, which made the gate accept a leaf pick
        // that could never take effect: a leaf compiles to `{ kind: 'rule', activeWhen:
        // pathCond }`, and a `read_skill` call writes only `activatedInjectionIds`,
        // which no `rule` trigger reads. The pick was accepted, the tool answered
        // "Skill 'x' activated for the next iteration", the tree re-decided by
        // predicate, and `reroute_superseded` fired naming a winner that did not exist
        // (tree mode never writes a cursor at all). Three of the library's own
        // invariants say the pick cannot be honoured here instead: exactly ONE leaf
        // fires per iteration (`attachExactlyOneLeafMonitor` warns otherwise), each
        // leaf's tools are scoped on that basis (`TreeOptions.scopeTools`), and
        // `toMermaid()` draws what is declared — a model lever over predicate routing
        // is not on the drawing. So the gate refuses, in the same terms 8.4.0 already
        // uses for every other rule-triggered skill.
        //
        // `read_skill` is not dead under a tree: the OPEN skills (anything registered
        // beside the graph — `.skill(x)`, `.skills(reg)`, `.selfExplain()`) are still
        // admitted from any cursor by the agent's gate, which is the only place that
        // knows what else is registered.
        reachableSkills = () => [];
      } else {
        // Flat entry/route mode (v1 + v2 keystone). `from`-gating + sticky cursor
        // both derive from one pure resolver so they can never diverge.
        // `.entryByRead()` makes the entries EXCLUSIVE (like `.entryByRelevance()`),
        // but the cold-start pick is the model's: no entry auto-loads — the LLM picks
        // one via `read_skill`, and that choice becomes the cursor (see
        // makeResolveCursor). `.classify()` suppresses the cold walk the SAME way:
        // the cascade decides the start (or offers a menu) — never the
        // first-declared entry by declaration-order accident. Without the
        // suppression, a 'menu' verdict would fall into the cold walk and silently
        // enter the first no-`when` entry while the record claimed a menu was
        // outstanding. This flag is only the COMPILE-TIME half: an entry-scorer
        // graph opts into the cascade at MOUNT time (`continuity:
        // 'conversation'`), which no graph build can see — there the resolver
        // suppresses the walk on the VERDICT's presence (`ctx.turnRoute`), so
        // both arms obey one law: the cascade's verdict, never the
        // declaration-order accident.
        const llmReadEntry = entryByReadFlag || classifyScorer !== undefined;
        resolveCursor = makeResolveCursor(entries, routes, llmReadEntry);
        // Triggers share ONE memoized view of the resolver per evaluation pass —
        // see memoizePerPass. The public resolvers (one call per iteration) stay raw.
        const nextSkillForTriggers = memoizePerPass(resolveCursor);
        reachableSkills = makeReachableSkills(entries, routes);
        // Exclusive entries are cursor-gated with no rule clause at all, so nothing
        // there can be superseded by one — the reporter is for the DEFAULT form.
        if (!entryScorer && !llmReadEntry) {
          supersededEntries = makeSupersededEntries(entries, resolveCursor);
        }
        if (entryScorer) scoreEntries = makeScoreEntries(entries, skillsById, entryScorer);
        // The turn-routing plan (SG-C): candidates, tier-1 rules, tie policy —
        // projected ONCE, so the router, the menu and the audit read one shape.
        turnRouting = buildTurnRoutingPlan({
          entries,
          describeFor: (id) => skillsById.get(id)?.description,
          policy: resolveRoutingPolicy(classifyPolicy),
          ...(classifyScorer && { scorer: classifyScorer }),
        });
        // `scopeTools: true` (flat) — the WIRED skills, i.e. everything an entry or a
        // route mentions. Stamped exactly as the tree stamps its leaves: a graph-level
        // DEFAULT (`existingAuto ?? …`), never an override of a skill's own declaration.
        // A listed-but-unwired skill stays additive — the graph does not route it, so
        // the graph does not scope it (it remains an OPEN, read_skill-reachable skill).
        // Default `false` keeps today's bytes; 10.0.0 flips the default.
        const scopedIds =
          opts.scopeTools === true
            ? new Set([...entries.map((e) => e.id), ...routes.flatMap((r) => [r.fromId, r.toId])])
            : undefined;
        for (const [id, skill] of skillsById) {
          const trigger = deriveTrigger(
            id,
            skill,
            entries,
            routes,
            nextSkillForTriggers,
            entryScorer !== undefined || llmReadEntry,
          );
          const routing = routingFor(id, entries, routes);
          const existingAuto = (skill.metadata as { autoActivate?: string } | undefined)
            ?.autoActivate;
          const autoActivate = existingAuto ?? (scopedIds?.has(id) ? 'currentSkill' : undefined);
          skills.push({
            ...skill,
            ...(trigger && { trigger }),
            metadata: {
              ...skill.metadata,
              [SKILL_GRAPH_METADATA_KEY]: routing,
              ...(autoActivate && { autoActivate }),
            },
          });
          nodes.push({ id, kind: 'skill', label: id });
        }
        edges.push(
          ...entries.map(
            (e): SkillEdge => ({
              from: null,
              to: e.id,
              kind: 'entry',
              label: e.label,
              ...(e.match && { match: e.match }),
            }),
          ),
          ...routes.map((r): SkillEdge => {
            // A guard composed with onToolReturn/onToolStatus keeps that kind
            // (the guard rides beside it as data, like `match` on an entry);
            // a guard ALONE is its own kind — it is deterministic routing,
            // and calling it 'model' (no trigger) or 'predicate' (opaque
            // code) would both be false.
            const kind: SkillEdgeKind = r.onToolStatus
              ? 'on-tool-status'
              : r.onToolReturn
              ? 'on-tool-return'
              : r.guard
              ? 'guard'
              : r.when
              ? 'predicate'
              : 'model';
            // The derived caption folds the guard clause in ("… when
            // riskLevel ≥ high") wherever a tool/status part is already
            // derived here; a guard-ONLY edge stores no label and toMermaid
            // captions it from the data (the entry-`match` precedent, which
            // keeps the mermaid escaping in one place).
            const guardSuffix = r.guard ? ` when ${plainGuardCaption(r.guard.data)}` : '';
            return {
              from: r.fromId,
              to: r.toId,
              kind,
              label:
                r.label ??
                (r.onToolStatus
                  ? `on ${
                      r.onToolReturn !== undefined ? `${String(r.onToolReturn)} ` : ''
                    }status=${statusesOf(r.onToolStatus).join('|')}${guardSuffix}`
                  : r.onToolReturn
                  ? `on ${String(r.onToolReturn)}${guardSuffix}`
                  : undefined),
              ...(r.guard && { guard: r.guard.data }),
            };
          }),
        );
      }

      // Run the check-up per the `check` mode: 'throw' fails loud on an error; 'warn'
      // prints in dev mode only (quiet in prod / tests) and NEVER throws; 'off' skips.
      //
      // The default is `'throw'` since 8.7.0, matching the object-literal form. It was
      // `'warn'`, which meant a fluent graph with `no-entry` or `unknown-skill` — a
      // graph that cannot start a turn at all — built in silence outside dev mode and
      // surfaced as a run that entered no skill. An explicit `check: 'warn'` still
      // never throws, so the opt-down survives with its name intact.
      const check = opts.check ?? 'throw';
      // Without `knownTools`, the body-contract checks (`body-foreign-tool` /
      // `body-unknown-tool`) cannot tell a typo from a baseline tool the agent
      // registers later — the graph builds before `.tool()` runs. So this PASS
      // defers them (reports nothing it cannot prove) and leaves a
      // `deferredBodyContract` note in TWO places that say the same thing: on the
      // graph, and on each compiled skill's metadata — because skills reach an
      // agent through more than one door (`.skillGraph(graph)` sees the graph;
      // `.skills({ list: () => graph.skills })` sees only the skills). Agent build
      // collects the note from its final injection list and runs the checks exactly
      // once against the full tool registry, whichever door was used. With
      // `knownTools` given, the author supplied the full picture and the checks run
      // right here, as always — no note anywhere, and the agent never re-runs them
      // (one problem, one report). `graph.checkup()` is untouched either way: the
      // explicit lint call always runs every check over what it can see.
      const deferBodyContract = check !== 'off' && opts.knownTools === undefined;
      const deferredNote: DeferredBodyContract | undefined = deferBodyContract
        ? { mode: check as 'throw' | 'warn' }
        : undefined;
      if (check !== 'off') {
        const result = checkup({ ...(opts.knownTools && { knownTools: opts.knownTools }) });
        const reported = deferBodyContract
          ? {
              ok: result.ok, // body-contract problems are warnings — they never decide `ok`
              problems: result.problems.filter(
                (p) => p.code !== 'body-foreign-tool' && p.code !== 'body-unknown-tool',
              ),
              // A deferred pass filters PROBLEMS, never the report's statement
              // about its own reach — dropping the notes here would make the
              // build-time surface quieter than `graph.checkup()` about exactly
              // the thing a clean report must not be read as.
              ...(result.notes && { notes: result.notes }),
            }
          : result;
        if (check === 'throw' && !reported.ok) {
          throw new Error(`skillGraph: build-time check-up failed:\n${formatCheckup(reported)}`);
        }
        if (reported.problems.length > 0) {
          devWarn(`skillGraph: build-time check-up found problems:\n${formatCheckup(reported)}`);
        }
      }

      return {
        // Deferring? The note rides each skill too (dedup at agent build is by id,
        // so the double stamp can never double-report). No deferral → the exact
        // same objects as always: zero cost when unused.
        skills: deferredNote
          ? skills.map((s) => ({
              ...s,
              metadata: { ...s.metadata, [SKILL_GRAPH_DEFERRED_CONTRACT_KEY]: deferredNote },
            }))
          : skills,
        edges,
        nodes,
        ...(deferredNote && { deferredBodyContract: deferredNote }),
        toMermaid: () => renderMermaid(nodes, edges),
        // `nextSkill` is the `.to` PROJECTION of the one resolver, not a second
        // implementation — the two cannot answer differently.
        nextSkill: (ctx: InjectionContext) => resolveCursor(ctx).to,
        explainNextSkill: (ctx: InjectionContext) => resolveCursor(ctx),
        supersededEntries: (ctx: InjectionContext) => supersededEntries(ctx),
        reachableSkills: (currentSkillId?: string) => reachableSkills(currentSkillId),
        checkup: (options?: CheckupOptions) => checkup(options),
        ...(scoreEntries && { scoreEntries }),
        ...(turnRouting && { turnRouting }),
        ...(classifyScorer
          ? { entrySelection: 'classify' as const }
          : entryScorer
          ? { entrySelection: 'scorer' as const }
          : entryByReadFlag
          ? { entrySelection: 'model-read' as const }
          : {}),
        ...(classifyScorer && {
          checkupIntents: (signal?: AbortSignal) =>
            runCheckupIntents({
              entries,
              scorer: classifyScorer!,
              policy: resolveRoutingPolicy(classifyPolicy),
              ...(signal && { signal }),
            }),
        }),
      };
    },
  };

  // Object-literal form → translate to the fluent calls + build. Listing skills
  // independently of the wiring is what lets the check-up flag a listed-but-unwired
  // skill (every config skill is registered, even if no edge references it).
  if (config) {
    // `tree` and `start`/`steps` are two ways to declare the routing and only one
    // compiles. The TYPE already refuses the pair (SkillGraphConfig is a union with
    // `tree?: never` on the flat arm), so this is the runtime half of the same
    // refusal — for JavaScript callers and for a config assembled through `any`.
    // Until 8.4.0 `start` was skipped by an `else if` and `steps` were compiled into
    // routes the tree branch then ignored: both vanished without a word.
    const overruled = [
      ...(config.start !== undefined ? ['start'] : []),
      ...(config.steps !== undefined ? ['steps'] : []),
    ];
    if (config.tree !== undefined && overruled.length > 0) {
      const quoted = overruled.map((k) => `\`${k}\``).join(' and ');
      const one = overruled.length === 1;
      throw new Error(
        `skillGraph({ tree, ${overruled.join(', ')} }): ${quoted} declare${one ? 's' : ''} the ` +
          `routing that \`tree\` already owns, so ${one ? 'it' : 'they'} would be silently ` +
          'ignored — a tree routes by predicate on every iteration and has no entry menu ' +
          `and no cursor. Remove ${quoted}, or drop \`tree\` and route with the flat form.`,
      );
    }
    for (const s of config.skills) remember(s);
    const resolve = (id: string): Injection => {
      const s = skillsById.get(id);
      if (!s) throw new Error(`skillGraph: config references skill "${id}" not in skills[].`);
      return s;
    };
    if (config.tree) {
      // `scopeTools` reaches the compiler here since 8.7.0 — the fluent form's
      // `.tree(root, { scopeTools: false })` had no object-form twin, so this arm
      // silently forced every leaf to `autoActivate: 'currentSkill'`.
      builder.tree(config.tree, {
        ...(config.scopeTools !== undefined && { scopeTools: config.scopeTools }),
      });
    } else if (config.start !== undefined) {
      const start = config.start;
      if (typeof start === 'string') builder.entry(resolve(start));
      else if ('use' in start) builder.entry(resolve(start.use));
      else if ('rules' in start) {
        // (a) rule-id-exists — validate EVERY rule's target before compiling any of
        // them, so the refusal lists every bad id at once (not just the first) and
        // names what IS allowed. An unknown id cannot compile into an entry at all,
        // so this refuses under every `check` mode — a rule silently dropped under
        // `check: 'warn'` would be the accepted-and-silently-wrong build.
        const missing = start.rules
          .map((r, i) => ({ use: r.use, i }))
          .filter(({ use }) => !skillsById.has(use));
        if (missing.length > 0) {
          const known = [...skillsById.keys()].map((k) => `"${k}"`).join(', ');
          const problems: GraphProblem[] = missing.map(({ use, i }) => ({
            kind: 'error',
            code: 'rule-id-exists',
            message:
              `start.rules[${i}] routes to skill "${use}", which is not in skills[]. ` +
              `Known skill ids: ${known || '(none)'}. Fix the rule's \`use\`, or add the ` +
              `skill to skills[].`,
            skill: use,
          }));
          throw new Error(
            `skillGraph: build-time check-up failed:\n${formatCheckup({ ok: false, problems })}`,
          );
        }
        for (const [i, r] of start.rules.entries()) {
          // Exactly one of `match`/`when` per rule. The type already says so
          // (`SkillStartRule` is a union with `never` on the other arm); this is the
          // runtime half, for JavaScript callers and configs assembled through `any`.
          // "Neither" is refused too — a rule exists to be conditional; the
          // unconditional start is `start: 'id'` / `{ use }`, and saying so beats
          // compiling a rule that would swallow every turn.
          const use = r.use; // read before the narrowing checks — TS collapses the
          // union to `never` inside the refusal branch (the type says it can't happen;
          // this is the runtime half for callers the compiler never saw).
          const both = r.when !== undefined && r.match !== undefined;
          const neither = r.when === undefined && r.match === undefined;
          if (both || neither) {
            throw new Error(
              `skillGraph: start.rules[${i}] (use: "${use}") ${
                both ? 'sets both `match` and `when`' : 'sets neither `match` nor `when`'
              } — a rule takes exactly one condition. Say when it applies with \`match\` ` +
                `(a RegExp, { keywords: [...] } or { all: [...] } tested against the user ` +
                `message) or \`when\` (a predicate over the iteration context). For an ` +
                `unconditional start, use \`start: '${use}'\` instead of a rule.`,
            );
          }
          builder.entry(resolve(r.use), {
            ...(r.when && { when: r.when }),
            ...(r.match !== undefined && { match: r.match }),
            ...(r.examples !== undefined && { examples: r.examples }),
          });
        }
        // The classifier + its tie policy (SG-C) — the rules form is where
        // intents live, so this is where the judge is declared.
        if (start.classify) builder.classify(start.classify, start.routing);
        else if (start.routing !== undefined) {
          throw new Error(
            'skillGraph: start.routing is the tie policy of the classifier and means nothing ' +
              'without one — declare `classify` beside it (the one-dial-one-home rule: the ' +
              'policy lives where the scorer it governs is declared).',
          );
        }
      } else {
        for (const id of start.entries) builder.entry(resolve(id));
        // scoredBy (any scorer) > byRelevance (embedder sugar) > entryByRead (LLM picks).
        if (start.scoredBy) builder.entryBy(start.scoredBy);
        else if (start.byRelevance) builder.entryByRelevance(start.byRelevance);
        else builder.entryByRead();
      }
    }
    // The negative rows (graph level, like the skills list itself — a phrase
    // that must route nowhere belongs to no skill and to no `start` arm).
    // Declared BEFORE `build()` so the tree refusal fires there, in one place,
    // for both forms.
    if (config.neverRoutes !== undefined) builder.neverRoutes(config.neverRoutes);
    for (const step of config.steps ?? []) {
      builder.route(resolve(step.from), resolve(step.to), {
        ...(step.when && { when: step.when }),
        ...(step.onToolReturn && { onToolReturn: step.onToolReturn }),
        ...(step.onToolStatus !== undefined && { onToolStatus: step.onToolStatus }),
        ...(step.guard !== undefined && { guard: step.guard }),
        ...(step.label && { label: step.label }),
      });
    }
    return builder.build({
      check: config.check ?? 'throw',
      ...(config.knownTools && { knownTools: config.knownTools }),
      // The FLAT arm's tool-scoping dial rides through to the one compiler below.
      // (The tree arm's `scopeTools` was already handed to `.tree()` above — passing
      // it here too would trip build()'s one-dial-one-home refusal.)
      ...(config.tree === undefined &&
        config.scopeTools !== undefined && { scopeTools: config.scopeTools }),
    });
  }

  return builder;
}

/**
 * The official vocabulary (9.51.0): you declare the **SkillMap**; the agent
 * is the **SkillWalker**; the recording carries both.
 *
 * `defineSkillMap` is a PERMANENT thin alias of {@link skillGraph} — the same
 * function object (reference-equal), same overloads, both names exported
 * forever; neither is a rename of the other. Use whichever reads better:
 * `defineSkillMap({...})` beside `defineSkill({...})` says what you are
 * doing; `skillGraph()` says what you get.
 *
 * There is deliberately NO `SkillWalker` export. The walker is not a thing
 * you construct — it is the agent itself (`.skillGraph(map)` mounts the map;
 * the agent walks it), moving the cursor by exactly three movers, every move
 * on the record as `cursorMove`:
 *
 *   • **llm**    — the model picks via `read_skill`, bounded by the gate
 *                  (`by: 'model-pick'`; refusals are `skill.rejected`);
 *   • **guard**  — your DATA decides: a `when`/`onToolReturn`/`onToolStatus`/
 *                  `guard:` edge fires, evidence recorded (`by: 'route'`,
 *                  with `cursorMove.guard` when a data guard judged it);
 *   • **linear** — no choice: a bare hand-off that fires every time its
 *                  source finishes (an `onToolReturn` edge with one target —
 *                  the degenerate guard).
 */
export const defineSkillMap = skillGraph;

/** The declared graph a SkillWalker walks — a permanent alias of
 *  {@link SkillGraph}, exported forever beside it (9.51.0). */
export type SkillMap = SkillGraph;

/**
 * The reachable-set resolver (the read_skill gate's allowed set). Pure +
 * deterministic over the build-time entries/routes:
 *   • cold start (cursor undefined) → the entry skills (you enter via entries);
 *   • otherwise → the cursor's direct successors (ANY declared edge out of it,
 *     deterministic OR bare/model) ∪ the entry skills, minus the cursor itself
 *     (a deliberate "stay" is the no-tool-call ReAct stop, not a self-`read_skill`).
 * Declaration order preserved; ids de-duplicated.
 */
function makeReachableSkills(
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
): (currentSkillId?: string) => readonly string[] {
  const entryIds = entries.map((e) => e.id);
  return (cur) => {
    const ids = cur === undefined ? [...entryIds] : [...successorsOf(cur, routes), ...entryIds];
    return dedupe(cur === undefined ? ids : ids.filter((id) => id !== cur));
  };
}

/** Direct successors of `from` — every declared route edge out of it (any kind). */
function successorsOf(from: string, routes: readonly RouteDecl[]): string[] {
  return routes.filter((r) => r.fromId === from).map((r) => r.toId);
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Bind the chosen `EntryScorer` strategy into `graph.scoreEntries`. The engine owns
 * the `when`-filtering (it needs `ctx` + the entry predicates); the scorer owns the
 * ranking. Filters the entries to the `when`-passing candidates, hands the scorer
 * `{ userMessage, candidates: { id, description } }`, and returns its `EntryScoring`.
 * Async wrapper so a sync scorer (`keywordScorer`) and an async one (`embeddingScorer`)
 * present identically; runs once per turn in the OFF-LOOP PickEntry stage, never in
 * the sync route triggers, so `nextSkill` stays synchronous. An empty candidate set
 * (or a throwing scorer, caught by PickEntry) falls back to the normal cold-start entry.
 */
function makeScoreEntries(
  entries: readonly EntryDecl[],
  skillsById: ReadonlyMap<string, Injection>,
  scorer: EntryScorer,
): (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring> {
  return async (ctx, signal) => {
    const candidates = entries
      .filter((e) => {
        if (!e.when) return true;
        try {
          return e.when(ctx);
        } catch (err) {
          warnMatcherThrew(`entry "${e.id}"`, err);
          return false;
        }
      })
      .map((e) => ({ id: e.id, description: skillsById.get(e.id)?.description ?? e.id }));
    return scorer.score({ userMessage: ctx.userMessage, candidates }, signal);
  };
}

/** Does a single route edge fire for ONE tool result of the batch?
 *  `onToolStatus` matches the result's DECLARED status (composed with the
 *  tool name when `onToolReturn` is also set — a result with no status can
 *  never match a status edge); `onToolReturn` alone matches the tool NAME;
 *  `when` runs the predicate over the result (same `{ toolName, result }`
 *  shape it has always received, plus `status` when declared). The caller
 *  walks the batch in call order (9.16.0) — before that, only
 *  `ctx.lastToolResult` was ever offered here. */
function routeMatches(
  r: RouteDecl,
  res: {
    readonly toolName: string;
    readonly result: string;
    readonly status?: ToolResultStatus;
  },
): boolean {
  if (!edgePreconditionsPass(r, res)) return false;
  if (r.onToolStatus !== undefined || r.onToolReturn !== undefined) return true;
  return r.when ? r.when(res) : false;
}

/** The tool/status PRECONDITIONS of one edge against one result — the part a
 *  `guard` is judged AFTER (9.51.0). True when the edge declares neither.
 *  Split out of `routeMatches` because the resolver dispatches guard edges
 *  itself: the guard's evidence must be collected at the very statement that
 *  decides the hop, and "the guard decided" is only true once these passed. */
function edgePreconditionsPass(
  r: RouteDecl,
  res: {
    readonly toolName: string;
    readonly status?: ToolResultStatus;
  },
): boolean {
  if (r.onToolStatus !== undefined) {
    if (res.status === undefined || !statusesOf(r.onToolStatus).includes(res.status)) {
      return false;
    }
    return r.onToolReturn ? toolMatcher(r.onToolReturn)(res.toolName) : true;
  }
  if (r.onToolReturn) return toolMatcher(r.onToolReturn)(res.toolName);
  return true;
}

/**
 * The cursor resolver (the keystone). Pure + deterministic. Given the iteration
 * context, returns the skill the graph should be *in* after this iteration AND the
 * clause that decided it (`CursorMove`; `nextSkill` is the `.to` projection):
 *   • cold start (`currentSkillId` unset) → first `entry` whose `when` passes
 *     (an `always`-entry — no `when` — matches unconditionally), else the entry
 *     the MODEL picked with `read_skill` (see "the model's pick" below);
 *   • a `from`-gated route (`fromId === currentSkillId`) whose predicate matches
 *     a result of the iteration's tool batch — results in call order, edges per
 *     result in declaration order; the first result with a match wins, later
 *     results matching OTHER targets are reported as `conflict` (9.16.0) →
 *     its target (the transition);
 *   • else the model's pick, when the read_skill gate accepted one this turn;
 *   • otherwise the current cursor unchanged (sticky stay).
 *
 * **The model's pick (`ctx.pendingSkillPick`) — the D2 "validated volunteer".**
 * `read_skill(id)` is already GATED to `reachableSkills(cursor)` (the model may
 * only name a skill the graph declares as reachable from where it stands), and
 * the tool answers "Skill 'id' activated for the next iteration." Until 8.3.0 the
 * cursor ignored that answer for every form except `.entryByRead()`'s cold start,
 * so the sentence was false wherever the skill's activation was cursor-gated or
 * rule-gated. It is honoured here, at ONE place, with the precedence the design
 * pinned (docs/design/skill-graph.md §4A.1): a declared edge that fired this hop
 * WINS over a same-turn pick (`D1 > D2`) — the author's determinism is never
 * overridden by a model guess. The pick is one-shot (the tool-calls stage rewrites
 * it every iteration), so a pick can never drag the cursor backwards after a later
 * edge has moved it.
 *
 * Each candidate predicate runs in its OWN try/catch so one throwing edge can't
 * block its siblings or crash the loop — a throw is treated as "no match" and,
 * in dev mode, warned. This is the design's `routeForResult` pin-table target.
 *
 * The `by` on each return is decided at the same statement as the destination
 * (8.5.0). That matters most in the case an outside observer cannot reconstruct:
 * a declared edge and a same-turn model pick naming the SAME target. `D1 > D2`
 * makes it a `'route'`, and only this function knows.
 */
/** The winning entry's recorded evidence, as a spreadable fragment: `{ witness }`
 *  when the rule was DATA and it yielded quotable text, `{}` otherwise (a `when`
 *  predicate, an unconditional entry, a match with nothing quotable). A throwing
 *  extractor is treated exactly as no evidence — a record is never worth a crash,
 *  and the hop itself already happened. */
function witnessOf(entry: EntryDecl, ctx: InjectionContext): { witness?: RouteWitness } {
  if (!entry.witness) return {};
  try {
    const found = entry.witness(ctx);
    return found === undefined ? {} : { witness: found };
  } catch {
    return {};
  }
}

function makeResolveCursor(
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
  llmReadEntry = false,
): (ctx: InjectionContext) => CursorMove {
  const isEntry = (id: string): boolean => entries.some((e) => e.id === id);
  return (ctx) => {
    const cur = ctx.currentSkillId;
    const from = cur !== undefined ? { from: cur } : {};
    // The turn-start cascade's verdict (SG-C) — a PRECOMPUTED input consumed
    // exactly as `pendingSkillPick` is, on iteration 1 only (the RouteTurn
    // stage decided it off the hot loop; `userMessage` is fixed for the run,
    // so iterations 2..N keep today's law byte-for-byte). Present only on
    // cascade graphs (`classify` / `continuity: 'conversation'`); absent, not
    // one line here behaves differently. A `menu`/`none` verdict carries no
    // `to` and falls through — the model resolves the menu via the ordinary
    // gated pick (D2), which is what keeps the offer and the verdict one
    // machinery; the cold-start walk below is suppressed by the verdict's
    // PRESENCE, so falling through can never enter an entry the record does
    // not claim.
    if (ctx.iteration === 1 && ctx.turnRoute?.to !== undefined) {
      const by =
        ctx.turnRoute.by === 'intent'
          ? ('intent' as const)
          : ctx.turnRoute.by === 'continuity'
          ? ('continuity' as const)
          : ctx.turnRoute.by === 'decider'
          ? ('decider' as const)
          : ('entry' as const);
      return {
        ...(ctx.turnRoute.from !== undefined && { from: ctx.turnRoute.from }),
        to: ctx.turnRoute.to,
        by,
        // The cascade already extracted the tier-1 evidence (`turn_routed`
        // carries it); the hop repeats it rather than re-deriving it, so the
        // two records can never quote different text.
        ...(ctx.turnRoute.witness !== undefined && { witness: ctx.turnRoute.witness }),
      };
    }
    if (cur === undefined) {
      // Cold start: declaration-order first entry whose intent predicate passes.
      // `.entryByRead()` skips this — there the library deliberately does NOT
      // auto-pick; the model reads the menu and picks (below), so no entry body
      // loads until it does. A turn whose cascade left a VERDICT on scope
      // (`ctx.turnRoute`, SG-C) skips it the same way: suppression follows the
      // verdict, not only the compile-time flag, because an entry-scorer graph
      // opts into the cascade at MOUNT time (`continuity: 'conversation'`) —
      // it compiles with `llmReadEntry` false, yet its cold `menu`/`none`
      // verdict (a near-tie, or the scorer-throw fallback) must reach the
      // model, never be overridden by the declaration-order walk while the
      // record claims a menu is outstanding. RouteTurn writes the POJO only
      // when the cascade DECIDED something, so a graph whose cold start still
      // belongs to this walk (no rules, no tier 2 — e.g. after a dropped
      // resume) keeps it.
      if (!llmReadEntry && ctx.turnRoute === undefined) {
        for (const e of entries) {
          if (!e.when) return { to: e.id, by: 'entry' };
          try {
            // The witness is extracted HERE, on the winner only — the losing
            // rules never pay for evidence, and an unconditional/`when` entry
            // has none to give (`witnessOf` answers undefined).
            if (e.when(ctx)) return { to: e.id, by: 'entry', ...witnessOf(e, ctx) };
          } catch (err) {
            warnMatcherThrew(`entry "${e.id}"`, err);
          }
        }
      }
      // A cold ACCEPTED tool proposal enters exactly where a cold model pick
      // may (an entry — the reachable-from-cold set), and OUTRANKS the pick:
      // deterministic tool evidence over a model guess, the same order the
      // mid-run walk applies below (9.19.0).
      const coldProposal = ctx.pendingToolTransition?.targetSkillId;
      if (coldProposal !== undefined && isEntry(coldProposal)) {
        return { to: coldProposal, by: 'tool-proposal' };
      }
      // The model's pick becomes the starting cursor. This is what `.entryByRead()`
      // has always done; 8.3.0 makes it true for EVERY start form, which is what
      // makes the rules form's documented fallback ("no rule matched → the model
      // picks from the read_skill menu") actually work. An entry's `when` is the
      // AUTOMATIC pick's condition, not a lock on the manual one: the model asked
      // for this skill by name and the gate allowed it.
      if (ctx.pendingSkillPick !== undefined && isEntry(ctx.pendingSkillPick)) {
        return { to: ctx.pendingSkillPick, by: 'model-pick' };
      }
      for (const e of entries) {
        if (ctx.activatedInjectionIds.includes(e.id)) return { to: e.id, by: 'model-pick' };
      }
      return { by: 'none' };
    }
    // D1 — transition: the whole tool batch, in CALL order (9.16.0). Per
    // result, the first from-gated deterministic edge in DECLARATION order
    // that fires names that result's target; the first RESULT with a target
    // wins the cursor. Two orders, two jobs: declaration order is the
    // author's tiebreak when one result could match several edges (the D1
    // law, unchanged), call order is the run's tiebreak across results —
    // the tool that returned first routed first. Before 9.16.0 only the
    // LAST call of a batch was consulted, so identical batches routed
    // differently depending on call order (the 9.15.0 L1 probe). A later
    // result matching a DIFFERENT target is suppressed AND reported on the
    // move (`conflict`), never silently dropped; a batch of one is
    // byte-identical to the old singular walk. D1 still wins over a
    // same-turn model pick — INCLUDING when both name the same target,
    // which is why the cause is decided here and not inferred downstream
    // from the destination.
    let winner: RouteBatchOutcome | undefined;
    let losers: RouteBatchOutcome[] | undefined;
    // Guard evidence (9.51.0), collected at the very statements that decide:
    // the winning edge's evaluation (verdict true) and — per guarded edge —
    // the FIRST refusal whose preconditions a result met (verdict false).
    // A guarded edge whose tool/status preconditions never matched leaves no
    // record: its guard never decided anything.
    let winnerGuard: GuardEvaluation | undefined;
    let guardsClosed: GuardEvaluation[] | undefined;
    let closedEdges: Set<RouteDecl> | undefined;
    for (const res of toolResultsOf(ctx)) {
      let target: string | undefined;
      let targetGuard: GuardEvaluation | undefined;
      for (const r of routes) {
        if (r.fromId !== cur) continue;
        if (!isDeterministicRoute(r)) continue; // model edges don't auto-fire
        try {
          if (r.guard !== undefined) {
            // The guard is judged AFTER the edge's own tool/status
            // preconditions, over the hop view (the six hop keys + the
            // result's JSON fields — see skillGuard.ts). `evaluate` and the
            // routing predicate are one compilation, so the recorded
            // conditions ARE the ones that routed.
            if (!edgePreconditionsPass(r, res)) continue;
            const evaluation = r.guard.evaluate({
              toolName: res.toolName,
              result: res.result,
              ...(res.status !== undefined && { status: res.status }),
              iteration: ctx.iteration,
              userMessage: ctx.userMessage,
              currentSkillId: cur,
            });
            const record: GuardEvaluation = {
              from: r.fromId,
              to: r.toId,
              toolName: res.toolName,
              ...(res.toolCallId !== undefined && { toolCallId: res.toolCallId }),
              verdict: evaluation.verdict,
              conditions: evaluation.conditions,
            };
            if (evaluation.verdict) {
              target = r.toId;
              targetGuard = record;
              break;
            }
            if (!(closedEdges ??= new Set()).has(r)) {
              closedEdges.add(r);
              (guardsClosed ??= []).push(record);
            }
            continue;
          }
          if (routeMatches(r, res)) {
            target = r.toId;
            break;
          }
        } catch (err) {
          warnMatcherThrew(`route ${r.fromId}→${r.toId}`, err);
        }
      }
      if (target === undefined) continue;
      const outcome: RouteBatchOutcome = {
        ...(res.toolCallId !== undefined && { toolCallId: res.toolCallId }),
        toolName: res.toolName,
        target,
      };
      if (winner === undefined) {
        winner = outcome;
        winnerGuard = targetGuard;
      } else if (target !== winner.target) (losers ??= []).push(outcome);
    }
    // The refusals ride WHATEVER move resulted — a closed guard explains a
    // stay (or the hop that won instead) the same way `supersededEntries`
    // explains a suppressed entry.
    const closed = guardsClosed !== undefined ? { guardsClosed } : {};
    if (winner !== undefined) {
      return {
        ...from,
        to: winner.target,
        by: 'route',
        ...(winnerGuard !== undefined && { guard: winnerGuard }),
        ...closed,
        ...(losers !== undefined && { conflict: { winner, losers } }),
      };
    }
    // D1.5 — the ACCEPTED tool proposal (9.19.0): no declared edge fired, so
    // a `propose-transition` effect the gate validated moves the cursor. It
    // sits BETWEEN the edges and the pick on purpose: a declared edge is the
    // author's determinism (never overridden), a proposal is the tool
    // author's determinism (code that shipped), a pick is the model's guess.
    // A proposal of the CURRENT skill is a no-op stay, not a hop.
    const proposal = ctx.pendingToolTransition?.targetSkillId;
    if (proposal !== undefined && proposal !== cur) {
      return { ...from, to: proposal, by: 'tool-proposal', ...closed };
    }
    // D2 — the validated volunteer: no declared edge fired, so the model's own
    // (already gated) pick moves the cursor. A pick of the CURRENT skill is a
    // no-op stay, not a hop.
    if (ctx.pendingSkillPick !== undefined && ctx.pendingSkillPick !== cur) {
      return { ...from, to: ctx.pendingSkillPick, by: 'model-pick', ...closed };
    }
    return { ...from, to: cur, by: 'stay', ...closed }; // sticky stay — no edge out of cur fired
  };
}

/**
 * The suppression reporter (8.15.0) — the honesty half of the one law.
 *
 * A conditional entry is active exactly while the cursor is on it, so an entry whose
 * own `when` matched while the graph is somewhere else is SUPPRESSED. Before 8.15.0
 * it would have loaded beside the cursor's skill, which is precisely the double
 * activation the law removes — so the run has to be able to SAY it happened, or an
 * author debugging "why isn't my entry loading?" has nothing to read.
 *
 * Pure: one resolver pass plus, at most, one predicate call per OTHER conditional
 * entry — O(E), inside the ceiling `memoizePerPass` sets for the whole evaluation.
 * The RAW resolver (not the memoized projection) is used deliberately, matching the
 * freshness policy of the other public resolvers: called once per iteration, always
 * recomputed.
 *
 * A throwing predicate is swallowed HERE and reported by the evaluator instead
 * (`skipped: 'predicate-threw'`) — one throw must not be told as two different
 * stories on the same event.
 */
function makeSupersededEntries(
  entries: readonly EntryDecl[],
  resolveCursor: (ctx: InjectionContext) => CursorMove,
): (ctx: InjectionContext) => readonly string[] {
  const conditional = entries.filter((e) => e.when !== undefined);
  if (conditional.length === 0) return () => [];
  return (ctx) => {
    const to = resolveCursor(ctx).to;
    // No cursor at all → the trigger falls back to the rule alone, so nothing is
    // being superseded.
    if (to === undefined) return [];
    const out: string[] = [];
    for (const e of conditional) {
      if (e.id === to) continue; // this is the one that won
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (e.when!(ctx)) out.push(e.id);
      } catch {
        // Reported by the evaluator as `predicate-threw`, not as a suppression.
      }
    }
    return out;
  };
}

/**
 * Memoize `nextSkill` per EVALUATION PASS.
 *
 * `evaluateInjections` hands ONE `ctx` object to every trigger in a pass, and
 * (since 8.3.0) every graph-compiled trigger — entry and route target alike —
 * asks `nextSkill(ctx)`. Without this, a graph with E entries and R routes pays
 * O(E × (E + R)) predicate calls per iteration instead of O(E + R): a 15-entry
 * regex router would re-run all 15 regexes 15 times per turn.
 *
 * Keyed on ctx IDENTITY in a WeakMap, so entries vanish with the context object
 * and a fresh iteration always recomputes. Safe because the resolver is pure over
 * `ctx` (route/entry predicates are documented as "pure + total"); the memo can
 * only make a pass MORE self-consistent, never less. `graph.nextSkill` and
 * `graph.explainNextSkill` are left un-memoized — they are public API called once
 * per iteration, and a consumer that mutates a ctx object between calls must still
 * get a fresh answer.
 *
 * Memoizes the whole `CursorMove` and projects `.to` for the triggers (8.5.0), so
 * one pass computes the destination and the cause together, exactly once.
 */
function memoizePerPass(
  resolveCursor: (ctx: InjectionContext) => CursorMove,
): (ctx: InjectionContext) => string | undefined {
  const cache = new WeakMap<InjectionContext, { value: string | undefined }>();
  return (ctx) => {
    const hit = cache.get(ctx);
    if (hit) return hit.value;
    const value = resolveCursor(ctx).to;
    cache.set(ctx, { value });
    return value;
  };
}

function warnMatcherThrew(edge: string, err: unknown): void {
  devWarn(
    `agentfootprint skillGraph: ${edge} predicate threw — treated as no-match. ` +
      `Predicates must be pure + total. ${err instanceof Error ? err.message : String(err)}`,
  );
}

/** Compile a skill's incoming edges → one injection trigger (or null = keep the
 *  skill's default `llm-activated` trigger, i.e. model-reachable via read_skill).
 *
 *  A route target B is active iff `nextSkill(ctx) === B`. That single expression
 *  delivers all three keystone properties from ONE source of truth:
 *    • `from`-gating  — `nextSkill` only fires an edge `A→B` while the cursor is
 *      on A, so the edge no longer bleeds into an unrelated skill D (the v1 bug);
 *    • stickiness     — when the cursor is on B and no edge leaves B, `nextSkill`
 *      returns B (sticky stay), so B re-activates each iteration;
 *    • clean handoff  — the iteration a `B→C` edge fires, `nextSkill` returns C,
 *      so B deactivates the SAME step C activates — no double-active overlap.
 *  Because the loop's cursor-update stage is ALSO `currentSkillId = nextSkill(ctx)`,
 *  the trigger and the cursor can never disagree. */
function deriveTrigger(
  id: string,
  _skill: Injection,
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
  nextSkill: (ctx: InjectionContext) => string | undefined,
  exclusiveEntries: boolean,
): InjectionTrigger | null {
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    // `.entryByRelevance()` / `.entryByRead()` make the entries EXCLUSIVE candidates:
    // exactly ONE loads — the best match (embedder) or the model's pick (read_skill) —
    // as the cursor, so only that entry's body lands (token-efficient). The same
    // cursor-gated trigger as a route target delivers that for both modes.
    if (exclusiveEntries) {
      return { kind: 'rule', activeWhen: (ctx) => nextSkill(ctx) === id };
    }
    // Default (v1): a persistent base (always) or intent-conditional (rule).
    // An unconditional entry is `always` — the cursor can add nothing to it. This is
    // the ONE declared way to be co-active beside whatever the cursor is on, and it
    // is untouched by 8.15.0.
    if (!entry.when) return { kind: 'always' };
    // An intent-conditional entry is active EXACTLY WHILE THE CURSOR IS ON IT (8.15.0)
    // — the same expression the exclusive-entry arm above and the route-target arm
    // below already use. One law for a flat graph: a skill is active iff the cursor is
    // on it, or it declared itself unconditional.
    //
    // 8.3.0 added the cursor clause to a rule-only trigger and left the rule clause
    // standing as an OR. That leftover was the bug: an entry S with a `when` that
    // routes to T stayed active on the hop (its rule reads the user's message, which
    // does not change mid-turn), so S and T were both on the wire — two skill bodies,
    // two tool sets — for a graph drawn as a single-file state machine. And it was the
    // steady state, not a blip: every later iteration parked the cursor on T while S's
    // rule still matched, so S came back. This finishes 8.3.0 rather than reverting
    // it — both failures 8.3.0 names (a declared `step` INTO an entry skill; a
    // `read_skill` pick onto one) are carried by the CURSOR clause, which survives.
    //
    // The rule is still evaluated FIRST, and deliberately: a throwing entry predicate
    // must keep surfacing as the evaluator's `skipped: 'predicate-threw'`, which it
    // only can if the trigger calls it. Its answer is then used for exactly one thing
    // — the cold-start fallback below, when the graph has no cursor at all.
    //
    // A rule that matched while the cursor is elsewhere is a SUPPRESSION, and the run
    // says so: `supersededEntries(ctx)` reports it and the Injection Engine stamps it
    // on `agentfootprint.context.evaluated` as `supersededIds`.
    const activeWhen = entry.when;
    return {
      kind: 'rule',
      activeWhen: (ctx) => {
        const matched = activeWhen(ctx);
        const to = nextSkill(ctx);
        if (to === id) return true; // the cursor lands here — my turn
        if (to !== undefined) return false; // the graph is engaged elsewhere — not my turn
        return matched; // no cursor at all → the rule alone
      },
    };
  }

  // Deterministic incoming edges (when / onToolReturn / onToolStatus) →
  // cursor-gated + sticky.
  const incoming = routes.filter(isDeterministicRoute).filter((r) => r.toId === id);
  if (incoming.length === 0) return null; // model-reachable — keep default trigger

  return { kind: 'rule', activeWhen: (ctx) => nextSkill(ctx) === id };
}

/** Walk a decision tree → push each leaf skill (with its path-conjunction trigger,
 *  earlier-sibling negation baked into the path) plus predicate/skill nodes +
 *  branch edges for drawing. */
function compileTree(
  node: DecisionNode | Injection,
  pathCond: (ctx: InjectionContext) => boolean,
  out: { skills: Injection[]; nodes: SkillNode[]; edges: SkillEdge[] },
  parent: { id: string; branch: string } | null,
  counter: { n: number },
  path: readonly SkillRoutingStep[],
  scopeTools: boolean,
  /** Registers each leaf under its id — the duplicate-id refusal and the
   *  skill-contract checks both read that registry (8.4.0). */
  register: (skill: Injection) => string,
): void {
  if (isDecisionNode(node)) {
    const id = `d${counter.n++}`;
    const label = node.label ?? 'decide';
    out.nodes.push({ id, kind: 'predicate', label });
    out.edges.push({
      from: parent ? parent.id : null,
      to: id,
      kind: 'predicate',
      label: parent?.branch,
    });
    compileTree(
      node.whenTrue,
      (ctx) => pathCond(ctx) && node.predicate(ctx),
      out,
      { id, branch: 'yes' },
      counter,
      [...path, { label, branch: 'yes' }],
      scopeTools,
      register,
    );
    compileTree(
      node.whenFalse,
      (ctx) => pathCond(ctx) && !node.predicate(ctx),
      out,
      { id, branch: 'no' },
      counter,
      [...path, { label, branch: 'no' }],
      scopeTools,
      register,
    );
  } else {
    if (node.flavor !== 'skill') {
      throw new Error(
        `skillGraph.tree: leaf "${node.id}" is not a skill (flavor='${node.flavor}').`,
      );
    }
    // Claim the id. The SAME object at two leaves is the merge below; two DIFFERENT
    // skills under one id is refused here rather than merged (8.4.0) — the merge
    // kept the first body and dropped the second one's silently.
    register(node);
    // The SAME skill may be the leaf of several branches ("ESXi questions" and
    // "io questions" both route to the io-profile bundle). Compile it ONCE:
    // merge repeated leaves into one injection whose trigger ORs the path
    // predicates — pushing a second same-id injection would explode in
    // Agent.injection()'s duplicate-id guard.
    const existingIdx = out.skills.findIndex((skill) => skill.id === node.id);
    if (existingIdx >= 0) {
      const prev = out.skills[existingIdx]!;
      const prevWhen = (prev.trigger as { activeWhen: (ctx: InjectionContext) => boolean })
        .activeWhen;
      const prevRouting = (prev.metadata as Record<string, unknown>)[
        SKILL_GRAPH_METADATA_KEY
      ] as SkillRouting;
      const allPaths = [
        ...(prevRouting.paths ?? (prevRouting.path ? [prevRouting.path] : [])),
        path,
      ];
      out.skills[existingIdx] = {
        ...prev,
        trigger: {
          kind: 'rule',
          activeWhen: (ctx: InjectionContext) => prevWhen(ctx) || pathCond(ctx),
        },
        metadata: {
          ...prev.metadata,
          [SKILL_GRAPH_METADATA_KEY]: { ...prevRouting, paths: allPaths },
        },
      };
      // Node already exists — add only the second parent edge (the drawing
      // correctly shows two predicate diamonds converging on one leaf).
      out.edges.push({
        from: parent ? parent.id : null,
        to: node.id,
        kind: 'predicate',
        label: parent?.branch,
      });
      return;
    }
    const routing: SkillRouting = { via: 'tree', path };
    // On-demand tools: a tree routes to exactly one leaf per iteration, so scope
    // each leaf's tools to itself (`autoActivate: 'currentSkill'`) unless the user
    // opted out (`scopeTools: false`) or the skill already declared its own mode.
    const existingAuto = (node.metadata as { autoActivate?: string } | undefined)?.autoActivate;
    const autoActivate = existingAuto ?? (scopeTools ? 'currentSkill' : undefined);
    out.skills.push({
      ...node,
      trigger: { kind: 'rule', activeWhen: pathCond },
      metadata: {
        ...node.metadata,
        [SKILL_GRAPH_METADATA_KEY]: routing,
        ...(autoActivate && { autoActivate }),
      },
    });
    out.nodes.push({ id: node.id, kind: 'skill', label: node.id });
    out.edges.push({
      from: parent ? parent.id : null,
      to: node.id,
      kind: 'predicate',
      label: parent?.branch,
    });
  }
}

/**
 * Dev-mode "exactly one leaf fires" monitor (backlog B11).
 *
 * A binary decision tree is exhaustive and non-overlapping BY CONSTRUCTION
 * (each leaf's trigger conjoins its root→leaf predicates with earlier-sibling
 * negation), so static analysis has nothing to check. The invariant breaks at
 * RUNTIME only — when a predicate is impure/non-deterministic: the evaluator
 * re-runs each `decide(...)` predicate once per leaf trigger, so a predicate
 * that answers differently across those calls can fire 0 or ≥2 leaves.
 *
 * In dev mode (footprintjs `enableDevMode()`), each compiled leaf trigger is
 * wrapped to tally fires per evaluation pass (keyed on the shared `ctx`
 * identity — `evaluateInjections` passes one ctx object to every trigger in a
 * pass). When all leaves have been evaluated for one ctx and the fired count
 * is not exactly 1, a console.warn names the leaves. Production pays one
 * `devMode()` check per evaluation; a throwing predicate is excluded here
 * because the evaluator already reports it (`skipped: 'predicate-threw'`).
 */
function attachExactlyOneLeafMonitor(skills: Injection[]): void {
  const total = skills.length;
  if (total < 2) return; // single leaf — trivially exactly-one
  const passes = new WeakMap<InjectionContext, { evaluated: number; fired: string[] }>();
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i]!;
    const inner = (skill.trigger as { activeWhen: (ctx: InjectionContext) => boolean }).activeWhen;
    skills[i] = {
      ...skill,
      trigger: {
        kind: 'rule',
        activeWhen: (ctx: InjectionContext): boolean => {
          if (!devMode()) return inner(ctx);
          const fired = inner(ctx); // may throw → evaluator reports 'predicate-threw'
          let pass = passes.get(ctx);
          if (!pass) {
            pass = { evaluated: 0, fired: [] };
            passes.set(ctx, pass);
          }
          pass.evaluated += 1;
          if (fired) pass.fired.push(skill.id);
          if (pass.evaluated === total) {
            passes.delete(ctx); // reset so a reused ctx object starts a fresh pass
            if (pass.fired.length !== 1) {
              devWarn(
                pass.fired.length === 0
                  ? `agentfootprint skillGraph.tree: NO leaf fired this iteration (expected exactly one). ` +
                      `The tree is exhaustive by construction, so a decide() predicate likely returned ` +
                      `different answers across leaf evaluations — predicates must be pure and deterministic. ` +
                      `Leaves: ${skills.map((s) => s.id).join(', ')}.`
                  : `agentfootprint skillGraph.tree: ${pass.fired.length} leaves fired simultaneously ` +
                      `(expected exactly one): ${pass.fired.join(
                        ', ',
                      )}. Each decide() predicate is ` +
                      `re-evaluated per leaf, so impure/non-deterministic predicates break if/else exclusivity.`,
              );
            }
          }
          return fired;
        },
      },
    };
  }
}

/** Routing provenance for a flat entry/route skill (the v1 model). */
function routingFor(
  id: string,
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
): SkillRouting {
  const entry = entries.find((e) => e.id === id);
  if (entry)
    return {
      via: 'entry',
      ...(entry.label && { label: entry.label }),
      ...(entry.match && { match: entry.match }),
    };

  const incoming = routes.filter(isDeterministicRoute).filter((r) => r.toId === id);
  const first = incoming[0];
  if (first) {
    return {
      via: 'route',
      from: first.fromId,
      ...(first.label && { label: first.label }),
      triggerKind: first.onToolReturn && !first.onToolStatus ? 'on-tool-return' : 'rule',
      ...(first.guard && { guard: first.guard.data }),
    };
  }
  return { via: 'model' }; // model-reachable via read_skill
}

function renderMermaid(nodes: readonly SkillNode[], edges: readonly SkillEdge[]): string {
  const kindById = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const ref = (id: string) => (kindById.get(id) === 'predicate' ? id : nodeId(id));
  const lines = ['flowchart TD', '  __start__([▶ start])'];
  for (const n of nodes) {
    lines.push(
      n.kind === 'predicate'
        ? `  ${n.id}{"${n.label ?? n.id}"}` // predicate → diamond
        : `  ${nodeId(n.id)}["${n.label ?? n.id}"]`, // skill → box
    );
  }
  for (const e of edges) {
    const from = e.from === null ? '__start__' : ref(e.from);
    const arrow = e.kind === 'model' ? '-.->' : '-->'; // model edges dashed
    // An explicit label wins unchanged; a data matcher captions its entry edge
    // and a data guard captions its guard-only route edge (that is half the
    // point of declaring the condition as data — it can be drawn). A guard
    // composed with a tool/status part is already folded into that derived
    // label at build.
    const caption =
      e.label ??
      (e.match ? mermaidMatchCaption(e.match) : e.guard ? mermaidGuardCaption(e.guard) : undefined);
    const label = caption ? `|${caption}|` : '';
    lines.push(`  ${from} ${arrow}${label} ${ref(e.to)}`);
  }
  return lines.join('\n');
}
