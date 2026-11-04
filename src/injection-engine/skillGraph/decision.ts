import type { InjectionContext, Injection } from '../types.js';

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

export function isDecisionNode(n: DecisionNode | Injection): n is DecisionNode {
  return (n as DecisionNode).kind === 'decision';
}
