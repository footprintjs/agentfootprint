import type { Injection } from './types.js';
import { SKILL_GRAPH_METADATA_KEY, type SkillRouting } from './skillGraph.js';

/** Per active skill-graph injection: its routing provenance + unlocked tools.
 *  Returns undefined when no active injection carries skill-graph metadata, so
 *  the emit payload omits `routing` entirely for non-skill-graph runs. */
export function routingEntriesOf(active: readonly Injection[]) {
  const entries = active.flatMap((inj) => {
    const routing = (inj.metadata as { [SKILL_GRAPH_METADATA_KEY]?: SkillRouting } | undefined)?.[
      SKILL_GRAPH_METADATA_KEY
    ];
    if (!routing) return [];
    return [
      {
        injectionId: inj.id,
        flavor: inj.flavor,
        via: routing.via,
        ...(routing.path && {
          path: routing.path.map((s) => ({ label: s.label, branch: s.branch })),
        }),
        ...(routing.label && { label: routing.label }),
        ...(routing.from && { from: routing.from }),
        ...(routing.triggerKind && { triggerKind: routing.triggerKind }),
        tools: (inj.inject.tools ?? []).map((t) => t.schema.name),
      },
    ];
  });
  return entries.length > 0 ? entries : undefined;
}
