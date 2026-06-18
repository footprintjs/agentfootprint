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
 * `InjectionContext.currentSkillId` (the cursor). One pure resolver — `nextSkill(ctx)`
 * (see `makeNextSkill`) — is the single source of truth: each route target B
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
 * and is unaffected by `from`-gating. Scoped `read_skill` (bounding the
 * model-reachable set by graph position) remains deferred — see proposal 002.
 */

import { isDevMode } from 'footprintjs';

import type { Injection, InjectionContext, InjectionTrigger } from './types.js';
import type { Embedder } from '../../memory/embedding/types.js';
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import { softmax } from './softmax.js';
import { checkupGraph, formatCheckup, type GraphCheckup } from './skillGraphCheckup.js';
export type { GraphCheckup, GraphProblem, GraphProblemCode } from './skillGraphCheckup.js';

/** How `.build({ check })` reacts to the graph check-up. */
export type GraphCheckMode = 'throw' | 'warn' | 'off';

/** Options for `.build()`. */
export interface BuildOptions {
  /**
   * Run the build-time check-up (see `graph.checkup()`):
   *   • `'throw'` — throw if any ERROR-level problem (unknown-skill / no-entry);
   *   • `'warn'`  — console.warn every problem in dev mode (`enableDevMode()`), silent otherwise;
   *   • `'off'`   — skip it entirely.
   * Default `'warn'`. `graph.checkup()` is always available regardless.
   */
  readonly check?: GraphCheckMode;
}

/**
 * Object-literal form of a skill graph — an alternative to the fluent builder.
 * Listing `skills` INDEPENDENTLY of the wiring is the point: the check-up can then
 * flag a skill that was listed but never wired (the fluent builder only ever sees
 * skills that appear in an edge). Compiles to the SAME `SkillGraph`. `check`
 * defaults to `'throw'` here (a new surface, fail-loud).
 */
export interface SkillGraphConfig {
  /** Every skill in the graph (wired or not). */
  readonly skills: readonly Injection[];
  /** Where a turn starts. Omit when using `tree`. */
  readonly start?:
    | string
    | { readonly use: string }
    | {
        readonly rules: ReadonlyArray<{
          readonly when: (ctx: InjectionContext) => boolean;
          readonly use: string;
        }>;
      }
    | { readonly entries: readonly string[]; readonly byRelevance: Embedder };
  /** Tool-result transitions; `from`/`to` are skill ids resolved against `skills`. */
  readonly steps?: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly when?: SkillRouteOptions['when'];
    readonly onToolReturn?: string | RegExp;
    readonly label?: string;
  }>;
  /** A decision tree (instead of `start` + `steps`). */
  readonly tree?: DecisionNode | Injection;
  readonly check?: GraphCheckMode;
}

/** One entry candidate's relevance to the user's message. */
export interface EntryScore {
  /** The entry skill id. */
  readonly id: string;
  /** Raw cosine similarity (message ↔ the skill's description), -1..1. */
  readonly cosine: number;
  /** Softmax share across the candidates, 0..1 — the surfaced relevance %. */
  readonly relevance: number;
}

/** Result of `graph.scoreEntries(ctx)` — the picked entry + the full ranking. */
export interface EntryScoring {
  /** The winning entry id (argmax cosine), or undefined if no candidate. */
  readonly chosen: string | undefined;
  /** Every scored candidate, in declaration order. */
  readonly ranked: readonly EntryScore[];
}

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
  /** Predicate on the iteration context (e.g. `ctx.userMessage`). Omit → the
   *  skill is always active (a persistent base procedure). */
  readonly when?: (ctx: InjectionContext) => boolean;
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
   * the always-on static registry on every call. `read_skill` stays available as
   * the escape hatch to reach another skill mid-run.
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
 *  other `decide(...)` results. */
export function decide(
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
}

/** The metadata key carrying a skill's routing provenance. */
export const SKILL_GRAPH_METADATA_KEY = 'skillGraph' as const;

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
   *   • cold start (`ctx.currentSkillId` unset) → the first matching `entry`;
   *   • a `from`-gated route whose predicate matches `ctx.lastToolResult` → its target;
   *   • otherwise the current cursor unchanged (sticky stay).
   * Pure + deterministic — the single source of truth shared by the compiled
   * route triggers and the agent loop's cursor-update stage, so the two can never
   * disagree. Flat entry/route graphs only; a decision `tree()` routes per-iteration
   * by predicate (no cursor) and returns the unchanged `ctx.currentSkillId`.
   */
  nextSkill(ctx: InjectionContext): string | undefined;
  /**
   * The REACHABLE set — which skills the model may `read_skill`-jump to from the
   * current cursor. The agent's runtime gate rejects any `read_skill('id')` whose
   * `id` is not in this set (so the model can't leave the graph mid-run).
   *   • cold start (`currentSkillId` undefined) → the entry skills;
   *   • otherwise → the current skill's direct successors ∪ the entry skills, minus
   *     the current skill itself (deliberate "stay" is the no-tool-call ReAct stop).
   * Pure + deterministic. A decision `tree()` has no cursor, so it returns ALL leaf
   * skills — `read_skill` stays a full escape hatch there.
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
   * skill, no entry, a self-loop). Pure + side-effect-free; call it whenever.
   * `ok` is false iff there's an error-level problem (`unknown-skill` / `no-entry`).
   */
  checkup(): GraphCheckup;
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
   * Pick the STARTING entry by relevance to the user's message — embed the message
   * + each entry skill's `description`, cosine-score, softmax → start at the best
   * match. LLM-free (an embedder, no extra model call), reproducible given the
   * embedder. The surfaced `relevance` % powers the "Why this skill?" panel.
   * Use INSTEAD of regex `.entry(skill, { when })` for natural-language routing.
   * Flat graphs only (a decision `tree()` already routes by predicate).
   */
  entryByRelevance(embedder: Embedder): SkillGraphBuilder;
  build(opts?: BuildOptions): SkillGraph;
}

interface EntryDecl {
  readonly id: string;
  readonly when?: (ctx: InjectionContext) => boolean;
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

export function skillGraph(): SkillGraphBuilder;
export function skillGraph(config: SkillGraphConfig): SkillGraph;
export function skillGraph(config?: SkillGraphConfig): SkillGraphBuilder | SkillGraph {
  const skillsById = new Map<string, Injection>();
  const entries: EntryDecl[] = [];
  const routes: RouteDecl[] = [];
  let treeRoot: DecisionNode | Injection | undefined;
  let treeScopeTools = true;
  let entryEmbedder: Embedder | undefined;

  const remember = (skill: Injection): string => {
    if (skill.flavor !== 'skill') {
      throw new Error(`skillGraph: "${skill.id}" is not a skill (flavor='${skill.flavor}').`);
    }
    skillsById.set(skill.id, skill);
    return skill.id;
  };

  const builder: SkillGraphBuilder = {
    entry(skill, opts) {
      const id = remember(skill);
      entries.push({ id, when: opts?.when, label: opts?.label });
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
    entryByRelevance(embedder) {
      entryEmbedder = embedder;
      return builder;
    },
    build(opts: BuildOptions = {}) {
      const skills: Injection[] = [];
      const nodes: SkillNode[] = [];
      const edges: SkillEdge[] = [];

      // The build-time check-up — pure over the declared entries/routes/skills.
      const checkup = (): GraphCheckup =>
        checkupGraph({
          skillIds: new Set(skillsById.keys()),
          entryIds: entries.map((e) => e.id),
          routes: routes.map((r) => ({
            fromId: r.fromId,
            toId: r.toId,
            deterministic: !!(r.when || r.onToolReturn),
          })),
          isTree: treeRoot !== undefined,
        });

      // The cursor resolver — the single source of truth for `from`-gated, sticky
      // routing. Flat mode wires it into each route target's trigger AND returns it
      // for the loop's cursor-update stage. Tree mode has no cursor (per-iteration
      // predicate routing), so it stays a no-op there.
      let nextSkill: (ctx: InjectionContext) => string | undefined = (ctx) => ctx.currentSkillId;
      // The reachable-set resolver — what `read_skill` may jump to from the cursor
      // (the runtime gate enforces it). Default empty; set per mode below.
      let reachableSkills: (currentSkillId?: string) => readonly string[] = () => [];
      // The relevance entry scorer — present only with `.entryByRelevance()` (flat).
      let scoreEntries:
        | ((ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>)
        | undefined;

      if (treeRoot) {
        // Decision-tree mode (v3): compile each leaf to a path-conjunction trigger.
        compileTree(
          treeRoot,
          () => true,
          { skills, nodes, edges },
          null,
          { n: 0 },
          [],
          treeScopeTools,
        );
        attachExactlyOneLeafMonitor(skills);
        // Tree mode has no cursor — `read_skill` stays a full escape hatch (all leaves).
        const leafIds = skills.map((s) => s.id);
        reachableSkills = () => leafIds;
      } else {
        // Flat entry/route mode (v1 + v2 keystone). `from`-gating + sticky cursor
        // both derive from one pure resolver so they can never diverge.
        nextSkill = makeNextSkill(entries, routes);
        reachableSkills = makeReachableSkills(entries, routes);
        if (entryEmbedder) scoreEntries = makeScoreEntries(entries, skillsById, entryEmbedder);
        for (const [id, skill] of skillsById) {
          const trigger = deriveTrigger(
            id,
            skill,
            entries,
            routes,
            nextSkill,
            entryEmbedder !== undefined,
          );
          const routing = routingFor(id, entries, routes);
          skills.push({
            ...skill,
            ...(trigger && { trigger }),
            metadata: { ...skill.metadata, [SKILL_GRAPH_METADATA_KEY]: routing },
          });
          nodes.push({ id, kind: 'skill', label: id });
        }
        edges.push(
          ...entries.map(
            (e): SkillEdge => ({ from: null, to: e.id, kind: 'entry', label: e.label }),
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

      // Run the check-up per the `check` mode (default 'warn'): 'throw' fails loud on
      // an error; 'warn' prints in dev mode only (quiet in prod / tests); 'off' skips.
      const check = opts.check ?? 'warn';
      if (check !== 'off') {
        const result = checkup();
        if (check === 'throw' && !result.ok) {
          throw new Error(`skillGraph: build-time check-up failed:\n${formatCheckup(result)}`);
        }
        if (result.problems.length > 0 && isDevMode()) {
          // eslint-disable-next-line no-console
          console.warn(`skillGraph: build-time check-up found problems:\n${formatCheckup(result)}`);
        }
      }

      return {
        skills,
        edges,
        nodes,
        toMermaid: () => renderMermaid(nodes, edges),
        nextSkill: (ctx: InjectionContext) => nextSkill(ctx),
        reachableSkills: (currentSkillId?: string) => reachableSkills(currentSkillId),
        checkup,
        ...(scoreEntries && { scoreEntries }),
      };
    },
  };

  // Object-literal form → translate to the fluent calls + build. Listing skills
  // independently of the wiring is what lets the check-up flag a listed-but-unwired
  // skill (every config skill is registered, even if no edge references it).
  if (config) {
    for (const s of config.skills) remember(s);
    const resolve = (id: string): Injection => {
      const s = skillsById.get(id);
      if (!s) throw new Error(`skillGraph: config references skill "${id}" not in skills[].`);
      return s;
    };
    if (config.tree) {
      builder.tree(config.tree);
    } else if (config.start !== undefined) {
      const start = config.start;
      if (typeof start === 'string') builder.entry(resolve(start));
      else if ('use' in start) builder.entry(resolve(start.use));
      else if ('rules' in start)
        for (const r of start.rules) builder.entry(resolve(r.use), { when: r.when });
      else {
        for (const id of start.entries) builder.entry(resolve(id));
        builder.entryByRelevance(start.byRelevance);
      }
    }
    for (const step of config.steps ?? []) {
      builder.route(resolve(step.from), resolve(step.to), {
        ...(step.when && { when: step.when }),
        ...(step.onToolReturn && { onToolReturn: step.onToolReturn }),
        ...(step.label && { label: step.label }),
      });
    }
    return builder.build({ check: config.check ?? 'throw' });
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
 * The relevance entry scorer (`graph.scoreEntries`). Embeds the user's message +
 * each `when`-passing entry's `description`, cosine-scores them, and softmaxes
 * into a `relevance` share; `chosen` is the argmax (declaration order breaks ties).
 * Async (the embedder is async) — runs once per turn in the OFF-LOOP PickEntry
 * stage, never in the sync route triggers, so `nextSkill` stays synchronous. An
 * empty candidate set yields `{ chosen: undefined, ranked: [] }` so the agent
 * falls back to the normal cold-start entry. A throwing embedder is caught by the
 * PickEntry stage (same fallback).
 */
function makeScoreEntries(
  entries: readonly EntryDecl[],
  skillsById: ReadonlyMap<string, Injection>,
  embedder: Embedder,
): (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring> {
  return async (ctx, signal) => {
    const candidates = entries.filter((e) => {
      if (!e.when) return true;
      try {
        return e.when(ctx);
      } catch (err) {
        warnMatcherThrew(`entry "${e.id}"`, err);
        return false;
      }
    });
    if (candidates.length === 0) return { chosen: undefined, ranked: [] };
    const qVec = await embedder.embed({ text: ctx.userMessage, ...(signal && { signal }) });
    const cosines: number[] = [];
    for (const e of candidates) {
      const description = skillsById.get(e.id)?.description ?? e.id;
      const dVec = await embedder.embed({ text: description, ...(signal && { signal }) });
      cosines.push(cosineSimilarity(qVec, dVec));
    }
    const relevances = softmax(cosines);
    const ranked: EntryScore[] = candidates.map((e, i) => ({
      id: e.id,
      cosine: cosines[i]!,
      relevance: relevances[i]!,
    }));
    // argmax by cosine; reduce keeps the FIRST on ties (declaration order).
    const chosen = ranked.reduce((best, r) => (r.cosine > best.cosine ? r : best)).id;
    return { chosen, ranked };
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
 * context, returns the skill the graph should be *in* after this iteration:
 *   • cold start (`currentSkillId` unset) → first `entry` whose `when` passes
 *     (an `always`-entry — no `when` — matches unconditionally);
 *   • a `from`-gated route (`fromId === currentSkillId`) whose predicate matches
 *     `lastToolResult`, first by declaration order → its target (the transition);
 *   • otherwise the current cursor unchanged (sticky stay).
 *
 * Each candidate predicate runs in its OWN try/catch so one throwing edge can't
 * block its siblings or crash the loop — a throw is treated as "no match" and,
 * in dev mode, warned. This is the design's `routeForResult` pin-table target.
 */
function makeNextSkill(
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
): (ctx: InjectionContext) => string | undefined {
  return (ctx) => {
    const cur = ctx.currentSkillId;
    if (cur === undefined) {
      // Cold start: declaration-order first entry whose intent predicate passes.
      for (const e of entries) {
        if (!e.when) return e.id;
        try {
          if (e.when(ctx)) return e.id;
        } catch (err) {
          warnMatcherThrew(`entry "${e.id}"`, err);
        }
      }
      return undefined;
    }
    // Transition: first from-gated deterministic edge that fires.
    for (const r of routes) {
      if (r.fromId !== cur) continue;
      if (!r.when && !r.onToolReturn) continue; // model edges don't auto-fire
      try {
        if (routeMatches(r, ctx)) return r.toId;
      } catch (err) {
        warnMatcherThrew(`route ${r.fromId}→${r.toId}`, err);
      }
    }
    return cur; // sticky stay — no edge out of the current skill fired
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
  entryByRelevance: boolean,
): InjectionTrigger | null {
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    // `.entryByRelevance()` makes the entries EXCLUSIVE candidates: PickEntry picks
    // ONE (the best match) as the cursor, so only that entry loads (token-efficient).
    // The same cursor-gated trigger as a route target delivers that.
    if (entryByRelevance) {
      return { kind: 'rule', activeWhen: (ctx) => nextSkill(ctx) === id };
    }
    // Default (v1): a persistent base (always) or intent-conditional (rule).
    // `currentSkillId` tracks the latest transitioned-into skill, orthogonal to an
    // always-on base, so entry semantics are non-breaking without entryByRelevance.
    return entry.when ? { kind: 'rule', activeWhen: entry.when } : { kind: 'always' };
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
    );
    compileTree(
      node.whenFalse,
      (ctx) => pathCond(ctx) && !node.predicate(ctx),
      out,
      { id, branch: 'no' },
      counter,
      [...path, { label, branch: 'no' }],
      scopeTools,
    );
  } else {
    if (node.flavor !== 'skill') {
      throw new Error(
        `skillGraph.tree: leaf "${node.id}" is not a skill (flavor='${node.flavor}').`,
      );
    }
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
  if (entry) return { via: 'entry', ...(entry.label && { label: entry.label }) };

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
    const label = e.label ? `|${e.label}|` : '';
    lines.push(`  ${from} ${arrow}${label} ${ref(e.to)}`);
  }
  return lines.join('\n');
}
