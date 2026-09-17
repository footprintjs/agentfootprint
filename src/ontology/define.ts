/**
 * ontology/define — `defineOntology`: validate a declaration, detach it,
 * freeze it, fingerprint it.
 *
 * Pattern: one pure function over plain JSON plus one pure hash; no I/O,
 *          no registry (the tool names in `via` are checked where the
 *          registry exists — `Agent.ts · buildChart`, beside
 *          `buildToolRegistry` — so `.build()` is what refuses them).
 * Role:    Map. It decides nothing about what the model sees; it decides
 *          whether a declaration is well-formed enough to be served as data.
 * Emits:   N/A.
 *
 * THE LAWS
 *   - Every fault is refused by NAME at definition time, never repaired: an
 *     edge to a node that does not exist, a node held by a source that was
 *     never declared, an id that is not identifier-safe, a text that is
 *     empty or longer than a served line may carry. A declaration that
 *     reaches an agent is one every served line can quote whole.
 *   - `configured` is copied only when the author wrote it. Absent stays
 *     absent; the served line then says nothing about configuration
 *     (`serve.ts`). The library never assumes a source is wired.
 *   - The result is detached (rebuilt from the input, never aliased) and
 *     deep-frozen, so a later edit of the caller's objects cannot move what
 *     `seed` puts on the record.
 *   - `ontologyHash` fingerprints the FIVE declared fields through the
 *     receipt's own canonical JSON (`receipt.ts · stableJson` — keys sorted,
 *     `undefined` dropped — one owner of the rule) and `sha256Hex`: two
 *     declarations that differ only in key order hash the same; edge order
 *     is declaration order and is part of the identity.
 */

import { stableJson } from '../lib/time-travel/receipt.js';
import { sha256Hex } from '../lib/time-travel/sha256.js';
import type {
  Ontology,
  OntologyEdge,
  OntologyNode,
  OntologyNodeSource,
  OntologySource,
  OntologySpec,
} from './types.js';

/** The bounds a declaration must fit — each one is what keeps a served line one line. */
export const ONTOLOGY_LIMITS = Object.freeze({
  /** Chars per id (`id`, a node key, a source key). */
  idChars: 64,
  /** Chars per text (`meaning`, `unit`, `coverage`, an alias, a relation, `version`). */
  textChars: 512,
  nodes: 256,
  sources: 64,
  edges: 512,
  aliasesPerNode: 16,
  sourcesPerNode: 8,
  viaPerSource: 16,
} as const);

/** Identifier-safe: a letter, then letters, digits, `_`, `.` or `-`. */
const ID_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** The keys each shape accepts — anything else is refused by name, not stripped. */
const ALLOWED_SOURCE_KEYS = ['meaning', 'coverage', 'configured'] as const;
const ALLOWED_NODE_SOURCE_KEYS = ['source', 'via', 'coverage'] as const;
const ALLOWED_NODE_KEYS = ['meaning', 'unit', 'aliases', 'sources'] as const;
const ALLOWED_EDGE_KEYS = ['from', 'to', 'relation', 'meaning'] as const;

function refuse(fault: string): never {
  throw new TypeError(`defineOntology: ${fault}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Refuse any key not in `allowed` — an unknown key is a fault named at
 * definition time, never silently stripped (a stripped key would make
 * `ontologyHash(rawSpec)` disagree with `defineOntology(rawSpec).hash`).
 */
function checkNoUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  what: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse(`${what} carries unknown key '${key}'.`);
  }
}

function checkId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > ONTOLOGY_LIMITS.idChars) {
    refuse(`${what} must be a non-empty string of at most ${ONTOLOGY_LIMITS.idChars} characters.`);
  }
  if (!ID_RE.test(value)) {
    refuse(
      `${what} '${value}' is not identifier-safe (a letter, then letters, digits, '_', '.' or '-').`,
    );
  }
  return value;
}

function checkText(value: unknown, what: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > ONTOLOGY_LIMITS.textChars
  ) {
    refuse(
      `${what} must be a non-empty string of at most ${ONTOLOGY_LIMITS.textChars} characters.`,
    );
  }
  return value;
}

function checkOptionalText(value: unknown, what: string): string | undefined {
  return value === undefined ? undefined : checkText(value, what);
}

function checkNames(value: unknown, what: string, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max) {
    refuse(`${what} must be an array of at most ${max} strings.`);
  }
  const names = value.map((entry, i) => checkText(entry, `${what}[${i}]`));
  if (new Set(names).size !== names.length) refuse(`${what} repeats a name.`);
  return Object.freeze(names);
}

function checkSource(id: string, value: unknown): OntologySource {
  if (!isRecord(value)) refuse(`sources['${id}'] must be an object.`);
  checkNoUnknownKeys(value, ALLOWED_SOURCE_KEYS, `source '${id}'`);
  const meaning = checkText(value.meaning, `sources['${id}'].meaning`);
  const coverage = checkOptionalText(value.coverage, `sources['${id}'].coverage`);
  const configured = value.configured;
  if (configured !== undefined && typeof configured !== 'boolean') {
    refuse(`sources['${id}'].configured must be a boolean when given.`);
  }
  return Object.freeze({
    meaning,
    ...(coverage !== undefined && { coverage }),
    ...(configured !== undefined && { configured }),
  });
}

function checkNodeSource(
  nodeId: string,
  index: number,
  value: unknown,
  sourceIds: ReadonlySet<string>,
): OntologyNodeSource {
  const what = `nodes['${nodeId}'].sources[${index}]`;
  if (!isRecord(value)) refuse(`${what} must be an object.`);
  checkNoUnknownKeys(value, ALLOWED_NODE_SOURCE_KEYS, what);
  const source = checkId(value.source, `${what}.source`);
  if (!sourceIds.has(source)) {
    refuse(`node '${nodeId}' is held by source '${source}', which is not declared in sources.`);
  }
  const via =
    value.via === undefined
      ? undefined
      : checkNames(value.via, `${what}.via`, ONTOLOGY_LIMITS.viaPerSource);
  const coverage = checkOptionalText(value.coverage, `${what}.coverage`);
  return Object.freeze({
    source,
    ...(via !== undefined && { via }),
    ...(coverage !== undefined && { coverage }),
  });
}

function checkNode(id: string, value: unknown, sourceIds: ReadonlySet<string>): OntologyNode {
  if (!isRecord(value)) refuse(`nodes['${id}'] must be an object.`);
  checkNoUnknownKeys(value, ALLOWED_NODE_KEYS, `node '${id}'`);
  const meaning = checkText(value.meaning, `nodes['${id}'].meaning`);
  const unit = checkOptionalText(value.unit, `nodes['${id}'].unit`);
  const aliases =
    value.aliases === undefined
      ? undefined
      : checkNames(value.aliases, `nodes['${id}'].aliases`, ONTOLOGY_LIMITS.aliasesPerNode);
  let sources: readonly OntologyNodeSource[] | undefined;
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.length > ONTOLOGY_LIMITS.sourcesPerNode) {
      refuse(
        `nodes['${id}'].sources must be an array of at most ${ONTOLOGY_LIMITS.sourcesPerNode} entries.`,
      );
    }
    const held = value.sources.map((entry, i) => checkNodeSource(id, i, entry, sourceIds));
    if (new Set(held.map((h) => h.source)).size !== held.length) {
      refuse(`node '${id}' names the same source twice.`);
    }
    sources = Object.freeze(held);
  }
  return Object.freeze({
    meaning,
    ...(unit !== undefined && { unit }),
    ...(aliases !== undefined && { aliases }),
    ...(sources !== undefined && { sources }),
  });
}

function checkEdge(index: number, value: unknown, nodeIds: ReadonlySet<string>): OntologyEdge {
  const what = `edges[${index}]`;
  if (!isRecord(value)) refuse(`${what} must be an object.`);
  checkNoUnknownKeys(value, ALLOWED_EDGE_KEYS, what);
  const from = checkId(value.from, `${what}.from`);
  const to = checkId(value.to, `${what}.to`);
  for (const end of [from, to]) {
    if (!nodeIds.has(end))
      refuse(`edge ${index} names node '${end}', which is not declared in nodes.`);
  }
  const relation = checkText(value.relation, `${what}.relation`);
  const meaning = checkOptionalText(value.meaning, `${what}.meaning`);
  return Object.freeze({ from, to, relation, ...(meaning !== undefined && { meaning }) });
}

/**
 * Validate a declaration and return it detached, frozen and fingerprinted.
 * Throws a `TypeError` naming the first fault found. The registered-tool
 * check on `via` happens at `Agent` build, where a registry exists.
 */
export function defineOntology(spec: OntologySpec): Ontology {
  if (!isRecord(spec)) refuse('expected a spec object.');
  const id = checkId(spec.id, 'id');
  const version = checkText(spec.version, 'version');
  if (version.length > ONTOLOGY_LIMITS.idChars) {
    refuse(`version must be at most ${ONTOLOGY_LIMITS.idChars} characters.`);
  }
  if (!isRecord(spec.sources)) refuse('sources must be a record of source declarations.');
  if (!isRecord(spec.nodes)) refuse('nodes must be a record of node declarations.');
  const sourceEntries = Object.entries(spec.sources);
  if (sourceEntries.length > ONTOLOGY_LIMITS.sources) {
    refuse(`at most ${ONTOLOGY_LIMITS.sources} sources may be declared.`);
  }
  const nodeEntries = Object.entries(spec.nodes);
  if (nodeEntries.length === 0 || nodeEntries.length > ONTOLOGY_LIMITS.nodes) {
    refuse(`between 1 and ${ONTOLOGY_LIMITS.nodes} nodes must be declared.`);
  }
  const sources: Record<string, OntologySource> = {};
  for (const [sourceId, value] of sourceEntries) {
    sources[checkId(sourceId, 'a source id')] = checkSource(sourceId, value);
  }
  const sourceIds = new Set(Object.keys(sources));
  const nodes: Record<string, OntologyNode> = {};
  for (const [nodeId, value] of nodeEntries) {
    const checkedNodeId = checkId(nodeId, 'a node id');
    if (sourceIds.has(checkedNodeId)) {
      refuse(`node id '${checkedNodeId}' collides with source id '${checkedNodeId}'.`);
    }
    nodes[checkedNodeId] = checkNode(checkedNodeId, value, sourceIds);
  }
  const nodeIds = new Set(Object.keys(nodes));
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const alias of node.aliases ?? []) {
      if (alias !== nodeId && nodeIds.has(alias)) {
        refuse(`node '${nodeId}' alias '${alias}' collides with node id '${alias}'.`);
      }
    }
  }
  if (spec.edges !== undefined && !Array.isArray(spec.edges)) {
    refuse('edges must be an array when given.');
  }
  const rawEdges = spec.edges ?? [];
  if (rawEdges.length > ONTOLOGY_LIMITS.edges) {
    refuse(`at most ${ONTOLOGY_LIMITS.edges} edges may be declared.`);
  }
  const edges = rawEdges.map((value, i) => checkEdge(i, value, nodeIds));
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.from}${edge.relation}${edge.to}`;
    if (seen.has(key))
      refuse(`edge '${edge.from} —${edge.relation}→ ${edge.to}' is declared twice.`);
    seen.add(key);
  }
  const declared = {
    id,
    version,
    nodes: Object.freeze(nodes),
    sources: Object.freeze(sources),
    edges: Object.freeze(edges),
  };
  return Object.freeze({ ...declared, hash: ontologyHash(declared) });
}

/**
 * The declaration's fingerprint: SHA-256 (64 hex) over the canonical JSON
 * of `{ id, version, nodes, sources, edges }` — the receipt's `stableJson`,
 * so key order never moves it. `hash` on an `Ontology` is never an input.
 * Defined over a VALIDATED spec: called on a raw spec that `defineOntology`
 * would refuse (an unknown key, a bad shape), the hash still includes
 * whatever that raw spec carries, so `ontologyHash(raw) === defineOntology(raw).hash`
 * holds only once the spec is one `defineOntology` accepts.
 */
export function ontologyHash(ontology: OntologySpec): string {
  const canonical = stableJson({
    id: ontology.id,
    version: ontology.version,
    nodes: ontology.nodes,
    sources: ontology.sources,
    edges: ontology.edges ?? [],
  });
  // `stableJson` returns undefined only for a value JSON cannot express; a
  // validated spec is plain strings, records, arrays and booleans, so this
  // is defence for a hand-built object, not the common path.
  return sha256Hex(canonical ?? '');
}
