/**
 * ontology/fromSkos — a customer's SKOS concept scheme (JSON-LD, already
 * parsed) becomes OUR map: `readSkos` is the pure parse, `fromSkos` joins
 * the host's sources onto it and returns an `OntologySpec` for
 * `defineOntology` — the ONE shape everything else reads.
 *
 * Pattern: reader = adapter. Two pure functions over plain JSON; no I/O, no
 *          registry, no second validation path — the result goes through
 *          `defineOntology` unchanged, which is where an id that is not
 *          identifier-safe, an alias that collides with an id, or a source
 *          nobody declared is refused.
 * Role:    Map. Nothing here infers: a concept is a node typed
 *          `skos:Concept`, its id is the last segment of its IRI, its
 *          meaning is its `definition`, else its `scopeNote`, else its
 *          `prefLabel`; `broader` is `is-a`, `related` is `related`; every
 *          other name and every label in another language is left where it
 *          was. SKOS cannot say which SOURCE holds a term or which TOOL reads
 *          it — the host binds those by hand in `SkosJoin.bind`; a term with
 *          no binding is the honest state "declared, no source holds it".
 * Emits:   N/A.
 *
 * THE OWNER'S RULING (2026-09-18): customers already have taxonomies, almost
 * always as SKOS. The library takes THEIRS in and turns it into OUR map;
 * readers are adapters, `defineOntology` stays canonical. OWL is out of
 * scope; a Turtle reader is a follow-up; serving the map back in SKOS
 * vocabulary waits for the bench.
 *
 * REFUSALS — every one an `Error` with a `code` (`ERR_SKOS_…`), the IRI(s)
 * involved and what was expected; the reader never returns a partial map:
 *   ERR_SKOS_INPUT             not a JSON-LD document, or a node that is not an object
 *   ERR_SKOS_NAMED_GRAPH       a node that is itself a named graph (`{ "@id", "@graph": [...] }`) —
 *                              its concepts would be dropped without a word; flatten the document first
 *   ERR_SKOS_UNTYPED           a node carrying SKOS properties with no `@type`
 *   ERR_SKOS_NO_CONCEPTS       no `skos:Concept` in the document
 *   ERR_SKOS_NO_LABEL          a concept with no prefLabel in the asked language
 *   ERR_SKOS_ID                an IRI whose last segment is empty
 *   ERR_SKOS_ID_COLLISION      two concepts collapsing to one id
 *   ERR_SKOS_UNKNOWN_CONCEPT   a broader/narrower/related target the document does not hold
 *   ERR_SKOS_CYCLE             a cycle in `broader` (SKOS forbids it)
 *   ERR_SKOS_SCHEME_MISSING    no id or no version, from the join or the scheme node
 *   ERR_SKOS_SCHEME_AMBIGUOUS  several scheme nodes and the join does not settle id and version
 *   ERR_SKOS_BIND_UNKNOWN_TERM a `bind` key naming a term the scheme does not hold
 */

import type {
  OntologyEdge,
  OntologyNode,
  OntologyNodeSource,
  OntologySource,
  OntologySpec,
} from './types.js';
import {
  expandIri,
  expandNode,
  FOOTPRINT,
  idFromIri,
  inLanguage,
  irisOf,
  isRecord,
  literalsOf,
  readContext,
  SKOS,
  type JsonLdNode,
  type SkosContext,
  typesOf,
  valuesOf,
  VERSION_IRIS,
} from './skosJsonLd.js';

/** A JSON-LD document, already parsed: one node, an array of nodes, or `{ "@context"?, "@graph": [...] }`. */
export type SkosInput = JsonLdNode | readonly JsonLdNode[];

export type SkosErrorCode =
  | 'ERR_SKOS_INPUT'
  | 'ERR_SKOS_NAMED_GRAPH'
  | 'ERR_SKOS_UNTYPED'
  | 'ERR_SKOS_NO_CONCEPTS'
  | 'ERR_SKOS_NO_LABEL'
  | 'ERR_SKOS_ID'
  | 'ERR_SKOS_ID_COLLISION'
  | 'ERR_SKOS_UNKNOWN_CONCEPT'
  | 'ERR_SKOS_CYCLE'
  | 'ERR_SKOS_SCHEME_MISSING'
  | 'ERR_SKOS_SCHEME_AMBIGUOUS'
  | 'ERR_SKOS_BIND_UNKNOWN_TERM';

/** The one error the reader throws: a `code`, the IRI(s) involved, what was expected. */
export class SkosError extends Error {
  readonly code: SkosErrorCode;
  readonly iris: readonly string[];
  constructor(code: SkosErrorCode, message: string, iris: readonly string[] = []) {
    super(`${code}: ${message}`);
    this.name = 'SkosError';
    this.code = code;
    this.iris = Object.freeze([...iris]);
  }
}

/** How to read the document: which language's labels to take (default `'en'`). */
export interface ReadSkosOptions {
  readonly language?: string;
}

/** One concept as read: its IRI, its derived id, and the node it becomes (no sources — SKOS has none). */
export interface SkosConcept {
  readonly iri: string;
  readonly id: string;
  readonly prefLabel: string;
  readonly node: OntologyNode;
}

/** The pure parse: the scheme's identity when the document carries it, the concepts, the edges. */
export interface SkosScheme {
  readonly iri?: string;
  readonly id?: string;
  readonly version?: string;
  readonly language: string;
  readonly concepts: readonly SkosConcept[];
  /** `is-a` from `broader`/`narrower` (once per pair), then `related` (once per pair, ends ordered by id), then `footprint:edge` entries — each group sorted, so node order and the broader/narrower spelling never move the hash. */
  readonly edges: readonly OntologyEdge[];
}

/** What SKOS cannot say and the host binds by hand: sources, and which term is held where. */
export interface SkosJoin {
  /** The map's id — else the scheme node's last IRI segment. */
  readonly id?: string;
  /** The map's version — else the scheme node's `dcterms:modified` / `owl:versionInfo` / `schema:version`. */
  readonly version?: string;
  /** Which language's labels to take (default `'en'`). */
  readonly language?: string;
  readonly sources: Readonly<Record<string, OntologySource>>;
  /** term id → the sources holding it; a key naming a term the scheme does not hold is refused. */
  readonly bind?: Readonly<Record<string, readonly OntologyNodeSource[]>>;
}

const DEFAULT_LANGUAGE = 'en';

const CONCEPT_PROPERTIES: readonly string[] = [
  SKOS.prefLabel,
  SKOS.altLabel,
  SKOS.hiddenLabel,
  SKOS.definition,
  SKOS.scopeNote,
  SKOS.broader,
  SKOS.narrower,
  SKOS.related,
  SKOS.inScheme,
  SKOS.topConceptOf,
  SKOS.hasTopConcept,
];

// ─── The document ───────────────────────────────────────────────────────

interface Doc {
  readonly context: SkosContext;
  readonly nodes: readonly JsonLdNode[];
}

/** Split the input into its context and its node objects; refuse anything that is not a document. */
function readDocument(input: SkosInput): Doc {
  if (Array.isArray(input)) return { context: readContext(undefined), nodes: checkNodes(input) };
  if (!isRecord(input)) {
    throw new SkosError(
      'ERR_SKOS_INPUT',
      'expected a JSON-LD document: an object, an array of node objects, or { "@graph": [...] }.',
    );
  }
  const context = readContext(input['@context']);
  if ('@graph' in input) {
    if (!Array.isArray(input['@graph'])) {
      throw new SkosError('ERR_SKOS_INPUT', 'expected "@graph" to be an array of node objects.');
    }
    return { context, nodes: checkNodes(input['@graph']) };
  }
  const single = Object.fromEntries(Object.entries(input).filter(([key]) => key !== '@context'));
  return { context, nodes: checkNodes([single]) };
}

function checkNodes(raw: readonly unknown[]): readonly JsonLdNode[] {
  return raw.map((node, i) => {
    if (!isRecord(node)) {
      throw new SkosError(
        'ERR_SKOS_INPUT',
        `node ${i} is not an object; expected a JSON-LD node object.`,
      );
    }
    // A named graph nested in the graph: JSON-LD allows it, this reader does not
    // walk into it — and silently skipping it would hand back a partial map.
    if ('@graph' in node) {
      throw new SkosError(
        'ERR_SKOS_NAMED_GRAPH',
        `node ${i}${typeof node['@id'] === 'string' ? ` ('${node['@id']}')` : ''} is a named graph; expected a flat "@graph" of node objects — flatten the document first.`,
        typeof node['@id'] === 'string' ? [node['@id']] : [],
      );
    }
    return node;
  });
}

// ─── Concepts ───────────────────────────────────────────────────────────

interface RawConcept {
  readonly iri: string;
  readonly props: ReadonlyMap<string, unknown>;
}

interface Typed {
  readonly concepts: readonly RawConcept[];
  readonly schemes: readonly RawConcept[];
}

/** Sort the nodes by `@type`; a node with SKOS properties and no type is refused, never guessed. */
function typeNodes(doc: Doc): Typed {
  const concepts: RawConcept[] = [];
  const schemes: RawConcept[] = [];
  doc.nodes.forEach((node, i) => {
    const props = expandNode(node, doc.context);
    const rawId = props.get('@id');
    const iri = typeof rawId === 'string' ? expandIri(rawId, doc.context) : `_:node${i}`;
    const types = typesOf(props, doc.context);
    if (types.includes(SKOS.Concept)) concepts.push({ iri, props });
    else if (types.includes(SKOS.ConceptScheme)) schemes.push({ iri, props });
    else if (types.length === 0 && CONCEPT_PROPERTIES.some((p) => props.has(p))) {
      throw new SkosError(
        'ERR_SKOS_UNTYPED',
        `node '${iri}' carries SKOS properties but no @type; expected skos:Concept or skos:ConceptScheme.`,
        [iri],
      );
    }
  });
  return { concepts, schemes };
}

function readConcept(raw: RawConcept, context: SkosContext, language: string): SkosConcept {
  const { iri, props } = raw;
  const id = idFromIri(iri);
  if (id.length === 0) {
    throw new SkosError(
      'ERR_SKOS_ID',
      `concept '${iri}' has no last path or fragment segment to take an id from.`,
      [iri],
    );
  }
  const prefLabels = inLanguage(literalsOf(props, SKOS.prefLabel, context), language);
  if (prefLabels.length === 0) {
    const seen = literalsOf(props, SKOS.prefLabel, context).map((l) => l.language ?? 'untagged');
    throw new SkosError(
      'ERR_SKOS_NO_LABEL',
      `concept '${iri}' has no skos:prefLabel in language '${language}' (labels seen: ${
        seen.length === 0 ? 'none' : seen.join(', ')
      }); a label is never taken from another language.`,
      [iri],
    );
  }
  const prefLabel = prefLabels[0] as string;
  const meaning =
    inLanguage(literalsOf(props, SKOS.definition, context), language)[0] ??
    inLanguage(literalsOf(props, SKOS.scopeNote, context), language)[0] ??
    prefLabel;
  const aliases = uniqueNames([
    ...inLanguage(literalsOf(props, SKOS.altLabel, context), language),
    ...inLanguage(literalsOf(props, SKOS.hiddenLabel, context), language),
    ...(prefLabel !== id ? [prefLabel] : []),
  ]).filter((alias) => alias !== id);
  const unit = literalsOf(props, FOOTPRINT.unit, context)[0]?.value;
  return {
    iri,
    id,
    prefLabel,
    node: {
      meaning,
      ...(unit !== undefined && { unit }),
      ...(aliases.length > 0 && { aliases }),
    },
  };
}

function uniqueNames(names: readonly string[]): readonly string[] {
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
}

/** Concepts sorted by id, with a collision refused naming both IRIs. */
function readConcepts(
  typed: Typed,
  context: SkosContext,
  language: string,
): readonly SkosConcept[] {
  if (typed.concepts.length === 0) {
    throw new SkosError('ERR_SKOS_NO_CONCEPTS', 'the document holds no node typed skos:Concept.');
  }
  const byId = new Map<string, SkosConcept>();
  for (const raw of typed.concepts) {
    const concept = readConcept(raw, context, language);
    const other = byId.get(concept.id);
    if (other !== undefined) {
      throw new SkosError(
        'ERR_SKOS_ID_COLLISION',
        `concepts '${other.iri}' and '${concept.iri}' both collapse to id '${concept.id}'; expected distinct last segments.`,
        [other.iri, concept.iri],
      );
    }
    byId.set(concept.id, concept);
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ─── Edges ──────────────────────────────────────────────────────────────

function readEdges(
  typed: Typed,
  concepts: readonly SkosConcept[],
  context: SkosContext,
): readonly OntologyEdge[] {
  const idOf = new Map(typed.concepts.map((c) => [c.iri, idFromIri(c.iri)]));
  const resolve = (from: string, property: string, target: string): string => {
    const id = idOf.get(target);
    if (id === undefined) {
      throw new SkosError(
        'ERR_SKOS_UNKNOWN_CONCEPT',
        `concept '${from}' has ${property} '${target}', which is not a skos:Concept in this document.`,
        [from, target],
      );
    }
    return id;
  };
  const propsOf = new Map(typed.concepts.map((c) => [c.iri, c.props]));
  const isA = new Map<string, OntologyEdge>();
  const related = new Map<string, OntologyEdge>();
  const declared: OntologyEdge[] = [];
  for (const concept of concepts) {
    const props = propsOf.get(concept.iri) ?? new Map<string, unknown>();
    for (const target of irisOf(props, SKOS.broader, context)) {
      addOnce(isA, {
        from: concept.id,
        to: resolve(concept.iri, 'skos:broader', target),
        relation: 'is-a',
      });
    }
    for (const target of irisOf(props, SKOS.narrower, context)) {
      addOnce(isA, {
        from: resolve(concept.iri, 'skos:narrower', target),
        to: concept.id,
        relation: 'is-a',
      });
    }
    for (const target of irisOf(props, SKOS.related, context)) {
      const other = resolve(concept.iri, 'skos:related', target);
      const [from, to] = concept.id < other ? [concept.id, other] : [other, concept.id];
      addOnce(related, { from, to, relation: 'related' });
    }
    for (const entry of valuesOf(props, FOOTPRINT.edge)) {
      if (!isRecord(entry)) continue;
      const edgeProps = expandNode(entry, context);
      const target = irisOf(edgeProps, FOOTPRINT.to, context)[0];
      const relation = literalsOf(edgeProps, FOOTPRINT.relation, context)[0]?.value;
      const meaning = literalsOf(edgeProps, FOOTPRINT.meaning, context)[0]?.value;
      if (target === undefined || relation === undefined) continue;
      const edge: OntologyEdge = {
        from: concept.id,
        to: resolve(concept.iri, 'footprint:edge', target),
        relation,
        ...(meaning !== undefined && { meaning }),
      };
      // `toSkos` writes an `is-a`/`related` edge that carries a meaning BOTH
      // as the SKOS relation and as a `footprint:edge`: the latter completes
      // the former (same key, the meaning added) rather than doubling it.
      const key = edgeKey(edge);
      if (isA.has(key)) isA.set(key, edge);
      else if (related.has(key)) related.set(key, edge);
      else declared.push(edge);
    }
  }
  // Sorted, so the same scheme written with `narrower` instead of `broader`
  // (or in another node order) yields the same edges — and the same hash.
  const edges = [
    ...sortEdges(isA.values()),
    ...sortEdges(related.values()),
    ...sortEdges(declared),
  ];
  refuseCycles(concepts, [...isA.values()]);
  return edges;
}

function sortEdges(edges: Iterable<OntologyEdge>): OntologyEdge[] {
  return [...edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
}

function edgeKey(edge: OntologyEdge): string {
  return `${edge.from} —${edge.relation}→ ${edge.to}`;
}

function addOnce(into: Map<string, OntologyEdge>, edge: OntologyEdge): void {
  const key = edgeKey(edge);
  if (!into.has(key)) into.set(key, edge);
}

/** A cycle in `broader` is refused with the cycle named, id by id. */
function refuseCycles(concepts: readonly SkosConcept[], isA: readonly OntologyEdge[]): void {
  const broader = new Map<string, string[]>();
  for (const edge of isA) broader.set(edge.from, [...(broader.get(edge.from) ?? []), edge.to]);
  const done = new Set<string>();
  const iriOf = new Map(concepts.map((c) => [c.id, c.iri]));
  const walk = (id: string, path: string[]): void => {
    const at = path.indexOf(id);
    if (at >= 0) {
      const cycle = [...path.slice(at), id];
      throw new SkosError(
        'ERR_SKOS_CYCLE',
        `skos:broader forms a cycle: ${cycle.join(
          ' → ',
        )}; SKOS forbids a concept broader than itself.`,
        cycle.map((c) => iriOf.get(c) ?? c),
      );
    }
    if (done.has(id)) return;
    for (const next of broader.get(id) ?? []) walk(next, [...path, id]);
    done.add(id);
  };
  for (const concept of concepts) walk(concept.id, []);
}

// ─── The scheme ─────────────────────────────────────────────────────────

interface SchemeIdentity {
  readonly iri?: string;
  readonly id?: string;
  readonly version?: string;
}

function readSchemeIdentity(typed: Typed, context: SkosContext): SchemeIdentity {
  if (typed.schemes.length !== 1) return {};
  const scheme = typed.schemes[0] as RawConcept;
  const id = idFromIri(scheme.iri);
  let version: string | undefined;
  for (const iri of VERSION_IRIS) {
    version = literalsOf(scheme.props, iri, context)[0]?.value;
    if (version !== undefined) break;
  }
  return {
    iri: scheme.iri,
    ...(id.length > 0 && { id }),
    ...(version !== undefined && { version }),
  };
}

// ─── The two doors ──────────────────────────────────────────────────────

/**
 * The pure parse: concepts (sorted by id), edges, and the scheme's identity
 * when ONE `skos:ConceptScheme` node carries it. Refuses by code; never
 * partial. Exported so a host can look before it joins, and for tests.
 */
export function readSkos(input: SkosInput, options: ReadSkosOptions = {}): SkosScheme {
  const language = options.language ?? DEFAULT_LANGUAGE;
  const doc = readDocument(input);
  const typed = typeNodes(doc);
  const concepts = readConcepts(typed, doc.context, language);
  const edges = readEdges(typed, concepts, doc.context);
  const scheme = readSchemeIdentity(typed, doc.context);
  return Object.freeze({ ...scheme, language, concepts, edges });
}

/**
 * The customer's scheme joined with the host's sources → an `OntologySpec`.
 * The host calls `defineOntology(fromSkos(input, join))`: nothing is
 * validated twice, and nothing is guessed — a term the join does not bind
 * has no sources, which is the honest state.
 */
export function fromSkos(input: SkosInput, join: SkosJoin): OntologySpec {
  const typed = typeNodes(readDocument(input));
  const scheme = readSkos(input, {
    ...(join.language !== undefined && { language: join.language }),
  });
  const identity = settleIdentity(typed, scheme, join);
  const bind = join.bind ?? {};
  const known = new Set(scheme.concepts.map((c) => c.id));
  for (const term of Object.keys(bind)) {
    if (!known.has(term)) {
      throw new SkosError(
        'ERR_SKOS_BIND_UNKNOWN_TERM',
        `bind names term '${term}', which the scheme does not hold; expected one of: ${[
          ...known,
        ].join(', ')}.`,
      );
    }
  }
  const nodes: Record<string, OntologyNode> = {};
  for (const concept of scheme.concepts) {
    const sources = bind[concept.id];
    nodes[concept.id] = { ...concept.node, ...(sources !== undefined && { sources }) };
  }
  return {
    id: identity.id,
    version: identity.version,
    sources: join.sources,
    nodes,
    edges: scheme.edges,
  };
}

function settleIdentity(
  typed: Typed,
  scheme: SkosScheme,
  join: SkosJoin,
): { id: string; version: string } {
  if (typed.schemes.length > 1 && (join.id === undefined || join.version === undefined)) {
    throw new SkosError(
      'ERR_SKOS_SCHEME_AMBIGUOUS',
      `the document holds ${typed.schemes.length} skos:ConceptScheme nodes; expected one, or join.id and join.version to settle the identity.`,
      typed.schemes.map((s) => s.iri),
    );
  }
  const id = join.id ?? scheme.id;
  const version = join.version ?? scheme.version;
  const where = scheme.iri === undefined ? 'no skos:ConceptScheme node' : `scheme '${scheme.iri}'`;
  if (id === undefined) {
    throw new SkosError(
      'ERR_SKOS_SCHEME_MISSING',
      `no map id: join.id not given and ${where} yields no last IRI segment.`,
      scheme.iri ? [scheme.iri] : [],
    );
  }
  if (version === undefined) {
    throw new SkosError(
      'ERR_SKOS_SCHEME_MISSING',
      `no map version: join.version not given and ${where} carries none of dcterms:modified, owl:versionInfo, schema:version.`,
      scheme.iri ? [scheme.iri] : [],
    );
  }
  return { id, version };
}
