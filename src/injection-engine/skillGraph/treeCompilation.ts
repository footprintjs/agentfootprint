import type { DecisionNode } from './decision.js';
import type { Injection, InjectionContext } from '../types.js';
import type { SkillNode, SkillEdge, SkillRoutingStep, SkillRouting } from './graphRoutes.js';
import { isDecisionNode } from './decision.js';
import { SKILL_GRAPH_METADATA_KEY } from './graphContracts.js';
import { devMode, devWarn } from '../devWarn.js';

/** Walk a decision tree → push each leaf skill (with its path-conjunction trigger,
 *  earlier-sibling negation baked into the path) plus predicate/skill nodes +
 *  branch edges for drawing. */
export function compileTree(
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
export function attachExactlyOneLeafMonitor(skills: Injection[]): void {
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
