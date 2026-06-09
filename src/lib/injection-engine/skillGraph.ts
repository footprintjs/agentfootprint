/**
 * skillGraph — a declarative, visualizable skill-dependency graph (proposal 002).
 *
 * The consumer declares skills + routing EDGES; `skillGraph()` compiles each edge
 * to the existing injection-engine TRIGGER on the target skill — so the dynamic,
 * token-efficient loading the engine already does becomes *declared* and *drawn*.
 *
 *   .entry(skill, { when? })              → trigger: `always` (or `rule` if when)
 *   .route(a, b, { onToolReturn })        → trigger on b: `on-tool-return`
 *   .route(a, b, { when })                → trigger on b: `rule` over ctx.lastToolResult
 *   (a skill with no declared incoming edge keeps its default `llm-activated`
 *    trigger — still reachable via `read_skill`, drawn as a dashed "model" edge)
 *
 * v1 is **zero engine change**: the generic evaluator (evaluator.ts) already
 * activates a `'skill'`-flavor Injection by ANY trigger kind. `toMermaid()`
 * renders the declared graph (declared === drawn). Scoped `read_skill` (gating the
 * model-reachable set by graph position) is deferred to v2 — see proposal 002.
 *
 * Edges are model-additive + stateless: each target's trigger is self-contained
 * (it reads `ctx.lastToolResult`), so `from` is informational for the drawing and
 * is NOT enforced — matching the engine's per-iteration evaluation model.
 */

import type { Injection, InjectionContext, InjectionTrigger } from './types.js';

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
  /** Decision path (tree only): the predicates from root→leaf + branch taken. */
  readonly path?: readonly SkillRoutingStep[];
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
  build(): SkillGraph;
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

export function skillGraph(): SkillGraphBuilder {
  const skillsById = new Map<string, Injection>();
  const entries: EntryDecl[] = [];
  const routes: RouteDecl[] = [];
  let treeRoot: DecisionNode | Injection | undefined;
  let treeScopeTools = true;

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
    build() {
      const skills: Injection[] = [];
      const nodes: SkillNode[] = [];
      const edges: SkillEdge[] = [];

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
      } else {
        // Flat entry/route mode (v1).
        for (const [id, skill] of skillsById) {
          const trigger = deriveTrigger(id, skill, entries, routes);
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

      return {
        skills,
        edges,
        nodes,
        toMermaid: () => renderMermaid(nodes, edges),
      };
    },
  };
  return builder;
}

/** Compile a skill's incoming edges → one injection trigger (or null = keep the
 *  skill's default `llm-activated` trigger, i.e. model-reachable via read_skill). */
function deriveTrigger(
  id: string,
  _skill: Injection,
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
): InjectionTrigger | null {
  // Entry wins: a persistent base (always) or intent-conditional (rule).
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    return entry.when ? { kind: 'rule', activeWhen: entry.when } : { kind: 'always' };
  }

  // Deterministic incoming edges (when / onToolReturn).
  const incoming = routes.filter((r) => r.toId === id && (r.when || r.onToolReturn));
  if (incoming.length === 0) return null; // model-reachable — keep default trigger

  // A single bare on-tool-return → the clean native trigger.
  if (incoming.length === 1 && incoming[0]!.onToolReturn && !incoming[0]!.when) {
    return { kind: 'on-tool-return', toolName: incoming[0]!.onToolReturn };
  }

  // Otherwise OR all matchers into one rule over the last tool result.
  const matchers = incoming.map((r) => {
    if (r.onToolReturn) {
      const test = toolMatcher(r.onToolReturn);
      return (ctx: InjectionContext) => !!ctx.lastToolResult && test(ctx.lastToolResult.toolName);
    }
    const when = r.when!;
    return (ctx: InjectionContext) => !!ctx.lastToolResult && when(ctx.lastToolResult);
  });
  return { kind: 'rule', activeWhen: (ctx) => matchers.some((m) => m(ctx)) };
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
