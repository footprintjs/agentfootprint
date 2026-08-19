/**
 * skillGraphDeclared — the AUTHOR'S skill map, projected for the record.
 *
 * Pattern: Pure projection over the structural graph `.skillGraph()` accepts.
 * Role:    Turn what the builder was HANDED into what
 *          `agentfootprint.skill.graph_declared` SAYS — the declared nodes and
 *          edges as DATA, so a consumer drawing the graph from a recording
 *          (the lens's `declaredSource: 'recording'` branch) never has to
 *          reconstruct the topology from per-hop `routing[]` provenance, which
 *          names an edge only once it FIRES and is therefore a lower bound.
 * Emits:   N/A — the Agent dispatches what this returns, once per run, right
 *          after the run-configuration manifest.
 *
 * ## The rule this file exists to keep
 *
 * The map carries EXACTLY what the author declared — the built graph's own
 * `nodes` and `edges` — and nothing inferred. Two consequences, both refusals
 * to guess:
 *
 *   - a structurally-typed graph that carries no `nodes` yields `undefined`
 *     (no event), because a map this file would have to invent is not the
 *     author's map — the same forward-compat posture as `explainNextSkill`
 *     ("a graph built before it existed still routes, it just cannot narrate");
 *   - an edge row that does not state its own `from` (the `.skillGraph()`
 *     structural type required only `to` until 9.50.0) is SKIPPED, never
 *     completed: `from: null` means the synthetic START and only the graph may
 *     say so.
 *
 * Descriptions are the skills' catalog descriptions, verbatim — the text the
 * model reads — looked up by node id; absent when a skill declares none.
 */

import type { Injection } from '../../lib/injection-engine/types.js';
import type { SkillGraphDeclaredPayload } from '../../events/payloads.js';

/** The structural slice of a graph this projection reads. Matches (a widened
 *  version of) what `AgentBuilder.skillGraph()` accepts — every field optional,
 *  because a consumer may hand the builder a structurally-typed graph. */
export interface DeclarableGraph {
  readonly nodes?: ReadonlyArray<{
    readonly kind: string;
    readonly id?: string;
    readonly label?: string;
  }>;
  readonly edges?: ReadonlyArray<{
    readonly to: string;
    readonly from?: string | null;
    readonly kind?: string;
    readonly label?: string;
  }>;
}

/** The captured map — the exact payload `skill.graph_declared` will carry.
 *  A named alias so Agent/AgentBuilder speak about the capture without
 *  importing an event payload for a field type. */
export type SkillGraphDeclaredMap = SkillGraphDeclaredPayload;

/**
 * Project the declared map, or `undefined` when the graph cannot state one.
 *
 * `skills` supplies the catalog descriptions (the graph's compiled
 * injections); only `flavor: 'skill'` rows are consulted, and a node with no
 * matching skill (a predicate diamond) simply carries no description.
 */
export function buildSkillGraphDeclared(
  graph: DeclarableGraph,
  skills: readonly Injection[],
): SkillGraphDeclaredMap | undefined {
  const rawNodes = graph.nodes ?? [];
  const nodes = rawNodes.flatMap((n) => {
    if (typeof n.id !== 'string' || n.id.length === 0) return [];
    const description = skills.find((s) => s.flavor === 'skill' && s.id === n.id)?.description;
    return [
      {
        id: n.id,
        kind: n.kind,
        ...(description !== undefined && { description }),
        ...(n.label !== undefined && { label: n.label }),
      },
    ];
  });
  // No drawable nodes ⇒ no authored map on the record. Never invented from
  // edges or skills: the graph is the only party allowed to state its shape.
  if (nodes.length === 0) return undefined;

  const edges = (graph.edges ?? []).flatMap((e) => {
    // An edge that does not state its own `from` and `kind` (older/structural
    // graphs typed only `{ to }`) cannot be reported truthfully — `from: null`
    // is a CLAIM (the synthetic START) and a kind is the author's word, not a
    // default. Skipped, never completed.
    if (e.from === undefined || typeof e.kind !== 'string' || typeof e.to !== 'string') return [];
    return [
      {
        from: e.from,
        to: e.to,
        kind: e.kind,
        ...(e.label !== undefined && { label: e.label }),
      },
    ];
  });
  return { nodes, edges };
}
