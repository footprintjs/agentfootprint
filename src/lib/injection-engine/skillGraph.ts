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

export type SkillEdgeKind = 'entry' | 'predicate' | 'on-tool-return' | 'model';

export interface SkillEdge {
  /** Source skill id, or `null` for the synthetic START (an entry edge). */
  readonly from: string | null;
  readonly to: string;
  readonly kind: SkillEdgeKind;
  readonly label?: string;
}

export interface SkillGraph {
  /** Skills with graph-derived triggers — feed to the Agent (`.skillGraph()` or
   *  `.skills({ list: () => graph.skills })`). */
  readonly skills: readonly Injection[];
  /** The declared edges (for tooling, overlays, tests). */
  readonly edges: readonly SkillEdge[];
  /** A Mermaid flowchart of the declared graph — declared === drawn. */
  toMermaid(): string;
}

export interface SkillGraphBuilder {
  /** Mark a skill as reachable at turn start (optionally intent-conditional). */
  entry(skill: Injection, opts?: SkillEntryOptions): SkillGraphBuilder;
  /** Declare an edge: after `from`'s work, `to` activates when the edge fires. */
  route(from: Injection, to: Injection, opts?: SkillRouteOptions): SkillGraphBuilder;
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
    build() {
      // Derive each skill's trigger from its declared edges.
      const skills: Injection[] = [];
      for (const [id, skill] of skillsById) {
        const trigger = deriveTrigger(id, skill, entries, routes);
        skills.push(trigger ? { ...skill, trigger } : skill);
      }

      // Declared edges for drawing/overlays.
      const edges: SkillEdge[] = [
        ...entries.map((e): SkillEdge => ({ from: null, to: e.id, kind: 'entry', label: e.label })),
        ...routes.map(
          (r): SkillEdge => ({
            from: r.fromId,
            to: r.toId,
            kind: r.onToolReturn ? 'on-tool-return' : r.when ? 'predicate' : 'model',
            label: r.label ?? (r.onToolReturn ? `on ${String(r.onToolReturn)}` : undefined),
          }),
        ),
      ];

      return {
        skills,
        edges,
        toMermaid: () => renderMermaid([...skillsById.keys()], edges),
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

function renderMermaid(ids: readonly string[], edges: readonly SkillEdge[]): string {
  const lines = ['flowchart TD', '  __start__([▶ start])'];
  for (const id of ids) lines.push(`  ${nodeId(id)}["${id}"]`);
  for (const e of edges) {
    const from = e.from === null ? '__start__' : nodeId(e.from);
    const arrow = e.kind === 'model' ? '-.->' : '-->'; // model edges dashed
    const label = e.label ? `|${e.label}|` : '';
    lines.push(`  ${from} ${arrow}${label} ${nodeId(e.to)}`);
  }
  return lines.join('\n');
}
