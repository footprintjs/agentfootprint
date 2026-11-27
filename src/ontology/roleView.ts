import type { Ontology, OntologyJoin, OntologyRecord } from './types.js';

const ROLE_VIEW_UNAVAILABLE = Symbol('ontology role view unavailable');

type ScopedOntologyJoin = OntologyJoin & { readonly [ROLE_VIEW_UNAVAILABLE]?: true };

export function ontologyHiddenSkills(join: ScopedOntologyJoin): ReadonlySet<string> | undefined {
  return join[ROLE_VIEW_UNAVAILABLE] ? undefined : new Set(join.hiddenSkillIds);
}

/** Private build-time fact needed to replay the same role projection. */
export type ScopedOntologyRecord = OntologyRecord & { readonly ontologyRoleViewRequired?: true };

export function recordOntology(
  ontology: Ontology,
  tools: OntologyRecord['tools'],
  roleViewRequired: boolean | undefined,
): ScopedOntologyRecord {
  const { id, version, hash, nodes, sources, edges } = ontology;
  return {
    id,
    version,
    hash,
    spec: { id, version, nodes, sources, edges },
    ...(tools !== undefined && {
      tools,
      ...(roleViewRequired && { ontologyRoleViewRequired: true }),
    }),
  };
}

/** An ungoverned or historical record admits the declared join. */
export function ontologyRoleJoin(
  record: Pick<ScopedOntologyRecord, 'tools' | 'ontologyRoleViewRequired'>,
  resolvedHidden: readonly string[] | undefined,
): OntologyJoin {
  const join: ScopedOntologyJoin = {
    ...(record.tools !== undefined && { tools: record.tools }),
    ...(resolvedHidden !== undefined
      ? { hiddenSkillIds: resolvedHidden }
      : record.ontologyRoleViewRequired && { [ROLE_VIEW_UNAVAILABLE]: true }),
  };
  return join;
}
