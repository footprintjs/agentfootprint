/**
 * ontology/toSkos — the reverse walk: our map written as a SKOS concept
 * scheme in JSON-LD, with what SKOS cannot say in a `footprint:` namespace
 * declared in the `@context`, so nothing of ours is lost.
 *
 * Pattern: one pure function over an `OntologySpec`; the twin of
 *          `fromSkos.ts · readSkos`, pinned as a round trip
 *          (`readSkos(toSkos(spec))` ≡ the spec's terms and edges).
 * Role:    Map. A term becomes a `skos:Concept` (prefLabel = id, definition
 *          = meaning, altLabel = aliases, `footprint:unit`); `is-a` becomes
 *          `skos:broader`, `related` becomes `skos:related`, every other
 *          relation — and any edge carrying a `meaning` — becomes a
 *          `footprint:edge`; a source becomes a `footprint:Source` node and
 *          a holding a `footprint:heldBy` entry (source, via, coverage).
 *          The scheme node carries the version as `owl:versionInfo`.
 * Emits:   N/A.
 *
 * NOT serving: the model is still served `serve.ts · ontologyPiece`; this
 * is an export for a host that keeps its taxonomy in SKOS (the owner's
 * ruling: serving in SKOS vocabulary waits for the bench).
 */

import { FOOTPRINT_NS, OWL_NS, SKOS_NS } from './skosJsonLd.js';
import type { OntologyEdge, OntologyNode, OntologySource, OntologySpec } from './types.js';

/** The base every IRI `toSkos` mints hangs off: `<base><id>` for the scheme, `<base><id>#<term>` for a concept. */
export const SKOS_IRI_BASE = 'https://footprintjs.dev/ontology/';

export interface ToSkosOptions {
  /** The `@language` every label and definition is tagged with (default `'en'`). */
  readonly language?: string;
}

/** A JSON-LD document: `@context` + `@graph`. */
export interface SkosDocument {
  readonly '@context': Readonly<Record<string, string>>;
  readonly '@graph': readonly Readonly<Record<string, unknown>>[];
}

const CONTEXT: Readonly<Record<string, string>> = Object.freeze({
  skos: SKOS_NS,
  owl: OWL_NS,
  footprint: FOOTPRINT_NS,
});

/** Write the map as a SKOS concept scheme in JSON-LD. Pure: same spec, same document. */
export function toSkos(spec: OntologySpec, options: ToSkosOptions = {}): SkosDocument {
  const language = options.language ?? 'en';
  const schemeIri = `${SKOS_IRI_BASE}${spec.id}`;
  const conceptIri = (id: string): string => `${schemeIri}#${id}`;
  const sourceIri = (id: string): string => `${schemeIri}/sources/${id}`;
  const edges = spec.edges ?? [];
  const nodeIds = Object.keys(spec.nodes).sort();
  const literal = (value: string): Record<string, string> => ({
    '@value': value,
    '@language': language,
  });

  const concepts = nodeIds.map((id) => {
    const node = spec.nodes[id] as OntologyNode;
    const outgoing = edges.filter((e) => e.from === id);
    const broader = outgoing
      .filter((e) => e.relation === 'is-a')
      .map((e) => ({ '@id': conceptIri(e.to) }));
    const related = outgoing
      .filter((e) => e.relation === 'related')
      .map((e) => ({ '@id': conceptIri(e.to) }));
    const declared = outgoing.filter(needsFootprintEdge).map((e) => ({
      'footprint:to': { '@id': conceptIri(e.to) },
      'footprint:relation': e.relation,
      ...(e.meaning !== undefined && { 'footprint:meaning': e.meaning }),
    }));
    const heldBy = (node.sources ?? []).map((held) => ({
      'footprint:source': { '@id': sourceIri(held.source) },
      ...(held.via !== undefined && { 'footprint:via': [...held.via] }),
      ...(held.coverage !== undefined && { 'footprint:coverage': held.coverage }),
    }));
    return {
      '@id': conceptIri(id),
      '@type': 'skos:Concept',
      'skos:inScheme': { '@id': schemeIri },
      'skos:prefLabel': literal(id),
      'skos:definition': literal(node.meaning),
      ...(node.aliases !== undefined &&
        node.aliases.length > 0 && { 'skos:altLabel': node.aliases.map(literal) }),
      ...(broader.length > 0 && { 'skos:broader': broader }),
      ...(related.length > 0 && { 'skos:related': related }),
      ...(node.unit !== undefined && { 'footprint:unit': node.unit }),
      ...(declared.length > 0 && { 'footprint:edge': declared }),
      ...(heldBy.length > 0 && { 'footprint:heldBy': heldBy }),
    };
  });

  const sources = Object.keys(spec.sources)
    .sort()
    .map((id) => {
      const source = spec.sources[id] as OntologySource;
      return {
        '@id': sourceIri(id),
        '@type': 'footprint:Source',
        'footprint:meaning': source.meaning,
        ...(source.coverage !== undefined && { 'footprint:coverage': source.coverage }),
        ...(source.configured !== undefined && { 'footprint:configured': source.configured }),
        ...(source.aliases !== undefined &&
          source.aliases.length > 0 && { 'footprint:aliases': [...source.aliases] }),
      };
    });

  const topConcepts = nodeIds
    .filter((id) => !edges.some((e) => e.from === id && e.relation === 'is-a'))
    .map((id) => ({ '@id': conceptIri(id) }));
  const scheme = {
    '@id': schemeIri,
    '@type': 'skos:ConceptScheme',
    'owl:versionInfo': spec.version,
    ...(topConcepts.length > 0 && { 'skos:hasTopConcept': topConcepts }),
  };

  return { '@context': CONTEXT, '@graph': [scheme, ...concepts, ...sources] };
}

/** An edge SKOS cannot carry whole: another relation, or an `is-a`/`related` with a meaning. */
function needsFootprintEdge(edge: OntologyEdge): boolean {
  return (edge.relation !== 'is-a' && edge.relation !== 'related') || edge.meaning !== undefined;
}
