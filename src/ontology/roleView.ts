import type { Ontology, OntologyJoin, OntologyRecord } from './types.js';

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
  const hidden = resolvedHidden ?? (record.ontologyRoleViewRequired ? undefined : []);
  return {
    ...(record.tools !== undefined && { tools: record.tools }),
    ...(hidden !== undefined && { hiddenSkillIds: hidden }),
  };
}
