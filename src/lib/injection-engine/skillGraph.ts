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

import { isDevMode } from 'footprintjs';

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
import { compileMatch, mermaidMatchCaption, type SkillMatch, type SkillMatchData } from './skillMatch.js';
export { formatCheckup } from './skillGraphCheckup.js';
export type { GraphCheckup, GraphProblem, GraphProblemCode } from './skillGraphCheckup.js';
// The data-matcher domain (`match:` on start rules) — one module owns the type,
// the compiler, the comparator and the caption; see ./skillMatch.ts.
export type { SkillMatch, SkillMatchData } from './skillMatch.js';

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
    }
  | {
      readonly use: string;
      /** The data form — comparable, drawable, stored. See {@link SkillMatch}. */
      readonly match: SkillMatch;
      readonly when?: never;
    };

/** Where a turn starts, in the object-literal (flat) form. */
export type SkillGraphStart =
  | string
  | { readonly use: string }
  | {
      readonly rules: ReadonlyArray<SkillStartRule>;
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
   *  on the next iteration. The common, controllable edge. */
  readonly when?: (result: { readonly toolName: string; readonly result: string }) => boolean;
  /** Sugar for "activate whenever this tool returns (any result)". String is an
   *  exact match; RegExp is tested against the tool name. */
  readonly onToolReturn?: string | RegExp;
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

export type SkillEdgeKind = 'entry' | 'predicate' | 'on-tool-return' | 'model';

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
 *   • `'entry'`      — cold start: the first entry whose `when` passed;
 *   • `'route'`      — a declared, `from`-gated edge fired (D1);
 *   • `'model-pick'` — no declared edge fired, so the model's gate-accepted
 *                      `read_skill` pick moved the cursor (D2), at cold start or mid-run;
 *   • `'stay'`       — nothing fired; the cursor is sticky and stayed put;
 *   • `'none'`       — no cursor at all (cold start with nothing to enter, or a
 *                      decision `tree()`, which routes by predicate and has no cursor).
 *
 * This exists because the DRAWN provenance on a skill (`metadata.skillGraph`) answers
 * "how is this skill reachable" — a build-time fact — and was being read as "how did
 * we get here this turn". A model pick into a skill that also has a declared edge was
 * therefore attributed to that edge, label and all, in the recorded route.
 */
export type CursorMoveCause = 'entry' | 'route' | 'model-pick' | 'stay' | 'none';

/** The cursor resolver's full answer: where, and by which clause. */
export interface CursorMove {
  /** The cursor after this iteration (what `nextSkill` returns). */
  readonly to?: string;
  /** The cursor before it. */
  readonly from?: string;
  /** The winning clause. */
  readonly by: CursorMoveCause;
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
   *   • a `from`-gated route whose predicate matches `ctx.lastToolResult` → its target;
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
  build(opts?: BuildOptions): SkillGraph;
}

interface EntryDecl {
  readonly id: string;
  /** The condition (compiled from `match` when the rule was declared as data). */
  readonly when?: (ctx: InjectionContext) => boolean;
  /** The serializable matcher behind `when`, when declared as data — what the
   *  check-up compares, `toMermaid()` captions, and the provenance stores. */
  readonly match?: SkillMatchData;
  readonly label?: string;
}
interface RouteDecl {
  readonly fromId: string;
  readonly toId: string;
  readonly when?: SkillRouteOptions['when'];
  readonly onToolReturn?: string | RegExp;
  readonly label?: string;
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
            `exactly one condition. Use \`match\` (a RegExp or { keywords: [...] } over the ` +
            `user message — comparable and drawable) OR \`when\` (a predicate over the ` +
            `iteration context). To combine a pattern with extra logic, fold the pattern ` +
            `into your \`when\` predicate.`,
        );
      }
      const compiled =
        opts?.match !== undefined ? compileMatch(opts.match, `entry "${id}"`) : undefined;
      entries.push({
        id,
        when: compiled ? compiled.predicate : opts?.when,
        ...(compiled && { match: compiled.data }),
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
      routes.push({
        fromId,
        toId,
        when: opts?.when,
        onToolReturn: opts?.onToolReturn,
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
    build(opts: BuildOptions = {}) {
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
          'skillGraph: `scopeTools` on build() is the FLAT arm\'s dial. This graph is a ' +
            '.tree(), which declares tool scoping on .tree(root, { scopeTools }) (object ' +
            'form: the tree arm\'s own `scopeTools` field) — set it there instead.',
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
          // to one), so a rule-router built from matchers is never read as a
          // fan-out. The match DATA rides along so the pairwise rule checks
          // (`overlapping-rules` / `rules-shadowed-by-order`) have something they
          // can honestly compare.
          entries: entries.map((e) => ({
            id: e.id,
            conditional: e.when !== undefined,
            ...(e.match && { match: e.match }),
          })),
          routes: routes.map((r) => ({
            fromId: r.fromId,
            toId: r.toId,
            deterministic: !!(r.when || r.onToolReturn),
          })),
          isTree: treeRoot !== undefined,
          exclusiveEntries: entryScorer !== undefined || entryByReadFlag,
          triggerKinds: new Map(
            skills.map((s) => [s.id, s.trigger.kind as CheckupTriggerKind] as const),
          ),
        });
        const contract = checkSkillContracts([...skillsById.values()], {
          ...(options.knownTools && { knownTools: options.knownTools }),
        });
        const problems = [...wiring.problems, ...contract];
        return { ok: !problems.some((p) => p.kind === 'error'), problems };
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
        // makeResolveCursor).
        const llmReadEntry = entryByReadFlag;
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
          ...routes.map(
            (r): SkillEdge => ({
              from: r.fromId,
              to: r.toId,
              kind: r.onToolReturn ? 'on-tool-return' : r.when ? 'predicate' : 'model',
              label: r.label ?? (r.onToolReturn ? `on ${String(r.onToolReturn)}` : undefined),
            }),
          ),
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
            }
          : result;
        if (check === 'throw' && !reported.ok) {
          throw new Error(`skillGraph: build-time check-up failed:\n${formatCheckup(reported)}`);
        }
        if (reported.problems.length > 0 && isDevMode()) {
          // eslint-disable-next-line no-console
          console.warn(
            `skillGraph: build-time check-up found problems:\n${formatCheckup(reported)}`,
          );
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
                `(a RegExp or { keywords: [...] } tested against the user message) or ` +
                `\`when\` (a predicate over the iteration context). For an unconditional ` +
                `start, use \`start: '${use}'\` instead of a rule.`,
            );
          }
          builder.entry(resolve(r.use), {
            ...(r.when && { when: r.when }),
            ...(r.match !== undefined && { match: r.match }),
          });
        }
      } else {
        for (const id of start.entries) builder.entry(resolve(id));
        // scoredBy (any scorer) > byRelevance (embedder sugar) > entryByRead (LLM picks).
        if (start.scoredBy) builder.entryBy(start.scoredBy);
        else if (start.byRelevance) builder.entryByRelevance(start.byRelevance);
        else builder.entryByRead();
      }
    }
    for (const step of config.steps ?? []) {
      builder.route(resolve(step.from), resolve(step.to), {
        ...(step.when && { when: step.when }),
        ...(step.onToolReturn && { onToolReturn: step.onToolReturn }),
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

/** Does a single route edge fire for this context? Reads the previous
 *  iteration's tool result; `onToolReturn` matches the tool NAME, `when` runs
 *  the predicate over the result. No match (and no tool result) → false. */
function routeMatches(r: RouteDecl, ctx: InjectionContext): boolean {
  const ltr = ctx.lastToolResult;
  if (!ltr) return false;
  if (r.onToolReturn) return toolMatcher(r.onToolReturn)(ltr.toolName);
  return r.when ? r.when(ltr) : false;
}

/**
 * The cursor resolver (the keystone). Pure + deterministic. Given the iteration
 * context, returns the skill the graph should be *in* after this iteration AND the
 * clause that decided it (`CursorMove`; `nextSkill` is the `.to` projection):
 *   • cold start (`currentSkillId` unset) → first `entry` whose `when` passes
 *     (an `always`-entry — no `when` — matches unconditionally), else the entry
 *     the MODEL picked with `read_skill` (see "the model's pick" below);
 *   • a `from`-gated route (`fromId === currentSkillId`) whose predicate matches
 *     `lastToolResult`, first by declaration order → its target (the transition);
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
function makeResolveCursor(
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
  llmReadEntry = false,
): (ctx: InjectionContext) => CursorMove {
  const isEntry = (id: string): boolean => entries.some((e) => e.id === id);
  return (ctx) => {
    const cur = ctx.currentSkillId;
    const from = cur !== undefined ? { from: cur } : {};
    if (cur === undefined) {
      // Cold start: declaration-order first entry whose intent predicate passes.
      // `.entryByRead()` skips this — there the library deliberately does NOT
      // auto-pick; the model reads the menu and picks (below), so no entry body
      // loads until it does.
      if (!llmReadEntry) {
        for (const e of entries) {
          if (!e.when) return { to: e.id, by: 'entry' };
          try {
            if (e.when(ctx)) return { to: e.id, by: 'entry' };
          } catch (err) {
            warnMatcherThrew(`entry "${e.id}"`, err);
          }
        }
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
    // D1 — transition: first from-gated deterministic edge that fires. Wins over
    // a same-turn model pick (the author's declared edge is never overridden) —
    // INCLUDING when both name the same target, which is why the cause is decided
    // here and not inferred downstream from the destination.
    for (const r of routes) {
      if (r.fromId !== cur) continue;
      if (!r.when && !r.onToolReturn) continue; // model edges don't auto-fire
      try {
        if (routeMatches(r, ctx)) return { ...from, to: r.toId, by: 'route' };
      } catch (err) {
        warnMatcherThrew(`route ${r.fromId}→${r.toId}`, err);
      }
    }
    // D2 — the validated volunteer: no declared edge fired, so the model's own
    // (already gated) pick moves the cursor. A pick of the CURRENT skill is a
    // no-op stay, not a hop.
    if (ctx.pendingSkillPick !== undefined && ctx.pendingSkillPick !== cur) {
      return { ...from, to: ctx.pendingSkillPick, by: 'model-pick' };
    }
    return { ...from, to: cur, by: 'stay' }; // sticky stay — no edge out of cur fired
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
  if (!isDevMode()) return;
  // eslint-disable-next-line no-console
  console.warn(
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

  // Deterministic incoming edges (when / onToolReturn) → cursor-gated + sticky.
  const incoming = routes.filter((r) => r.toId === id && (r.when || r.onToolReturn));
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
 * `isDevMode()` check per evaluation; a throwing predicate is excluded here
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
          if (!isDevMode()) return inner(ctx);
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
              // eslint-disable-next-line no-console
              console.warn(
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

  const incoming = routes.filter((r) => r.toId === id && (r.when || r.onToolReturn));
  const first = incoming[0];
  if (first) {
    return {
      via: 'route',
      from: first.fromId,
      ...(first.label && { label: first.label }),
      triggerKind: first.onToolReturn ? 'on-tool-return' : 'rule',
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
    // (that is half the point of declaring the rule as data — it can be drawn).
    const caption = e.label ?? (e.match ? mermaidMatchCaption(e.match) : undefined);
    const label = caption ? `|${caption}|` : '';
    lines.push(`  ${from} ${arrow}${label} ${ref(e.to)}`);
  }
  return lines.join('\n');
}
