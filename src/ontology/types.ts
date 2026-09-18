/**
 * ontology/types — the declared map: what a node IS, how nodes RELATE, which
 * SOURCE holds a node and which registered TOOL reads it from there.
 *
 * Pattern: plain readonly shapes, a zero-import leaf.
 * Role:    Map. Nothing here fetches, infers or executes; the shapes name
 *          what an application DECLARED and nothing else. `defineOntology`
 *          (`define.ts`) validates and freezes a spec into an `Ontology`;
 *          `seed` puts the whole spec on the record once as `OntologyRecord`;
 *          `serve.ts · ontologyPiece` quotes it line by line.
 * Emits:   N/A.
 *
 * THE OWNER'S RULING (2026-09-17): an ontology is a map — it does not
 * provide a way to get data; it tells and reasons about each node and how
 * to reach a node, so a model that finds no data can say which node or
 * source would help further. Declared, read-only, no execution through it,
 * no inference by the library, served as data.
 */

/**
 * Where a node is HELD: a declared source, optionally the registered tools
 * that read the node from it and the author's own sentence about that
 * source's coverage of this node.
 */
export interface OntologyNodeSource {
  /** A key of `OntologySpec.sources`. */
  readonly source: string;
  /** Registered tool names that read this node from this source — checked against the agent's registry at build. */
  readonly via?: readonly string[];
  /** The author's sentence about how much of this node the source holds — served as data, never judged. */
  readonly coverage?: string;
}

/** What a term IS: its meaning, its unit, its other names, and where it is held (none = "known, nowhere collected here"). */
export interface OntologyNode {
  readonly meaning: string;
  readonly unit?: string;
  readonly aliases?: readonly string[];
  readonly sources?: readonly OntologyNodeSource[];
}

/** A place data is held: its meaning, the author's coverage sentence, and whether it is configured — ABSENT means unknown, never assumed. */
export interface OntologySource {
  readonly meaning: string;
  readonly coverage?: string;
  readonly configured?: boolean;
}

/** How two nodes RELATE, in the author's own word (`'backed-by'`, `'logs-into'`, …). */
export interface OntologyEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly meaning?: string;
}

/** What `defineOntology` takes: the declaration as the application wrote it. */
export interface OntologySpec {
  readonly id: string;
  readonly version: string;
  readonly nodes: Readonly<Record<string, OntologyNode>>;
  readonly sources: Readonly<Record<string, OntologySource>>;
  readonly edges?: readonly OntologyEdge[];
}

/**
 * What `defineOntology` returns: the spec, validated, detached from the
 * caller's objects and deep-frozen, with `edges` always present and the
 * `hash` `ontologyHash` computes over the canonical JSON of the five
 * declared fields (never over `hash` itself).
 */
export interface Ontology extends OntologySpec {
  readonly edges: readonly OntologyEdge[];
  readonly hash: string;
}

/**
 * The committed key `AgentState.ontology` — a RUN CONSTANT `seed` writes
 * once per run of an agent built with `.ontology(...)`: the identities the
 * events carry and the WHOLE spec, so the served piece and a lens need
 * nothing but the record. Absent on every other agent.
 */
/**
 * What the model is asked to DO with the served map (9.107.0) — one named
 * value, the `answerAsk` grammar. `'use-the-map'` (the default) registers the
 * versioned `ONTOLOGY_INSTRUCTION`: read the question in the map's terms,
 * look where a source and its tool are declared, walk a relation from a term
 * held to a term needed, and when a need is unmet name where it would be
 * met — never a value off a definition, never the map itself to the person.
 * `'none'` serves the map as data with no ask of the library's — for an
 * application that registers its own through `.instruction()`. The map is
 * served either way; the ask is what changes.
 */
export type OntologyAsk = 'none' | 'use-the-map';

export interface OntologyRecord {
  readonly id: string;
  readonly version: string;
  readonly hash: string;
  readonly spec: OntologySpec & { readonly edges: readonly OntologyEdge[] };
}
