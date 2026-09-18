/**
 * ontology/skosJsonLd — the JSON-LD spellings a SKOS document uses, resolved
 * to IRIs with no inference.
 *
 * Pattern: pure functions over an already-parsed JSON-LD document; a
 *          zero-import leaf under `fromSkos.ts`.
 * Role:    Map (reader side). A key is resolved by the document's own
 *          `@context` when it has one — a term mapping, a prefix, `@vocab` —
 *          else by the fixed table of the vocabularies SKOS documents lean on
 *          (`skos:`, `dcterms:`, `owl:`, `schema:`, `footprint:`). A full IRI
 *          is itself. A bare key no context maps is NOT a SKOS property: it
 *          is left unresolved, never guessed from its spelling.
 * Emits:   N/A.
 *
 * Out of scope, by the owner's ruling (2026-09-18): a Turtle parser (the
 * input is an OBJECT), remote `@context` fetching (a context given by URL is
 * not resolved), OWL.
 */

/** The SKOS core namespace. */
export const SKOS_NS = 'http://www.w3.org/2004/02/skos/core#';
/** The OWL namespace — read for `owl:versionInfo` only; OWL itself is out of scope. */
export const OWL_NS = 'http://www.w3.org/2002/07/owl#';
/** Our own namespace for what SKOS cannot say: units, sources, tools, coverage, other relations. */
export const FOOTPRINT_NS = 'https://footprintjs.dev/ns/ontology#';

/** The prefixes the reader knows without a context — the fixed table. */
export const KNOWN_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  skos: SKOS_NS,
  dcterms: 'http://purl.org/dc/terms/',
  dct: 'http://purl.org/dc/terms/',
  owl: OWL_NS,
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  schema: 'https://schema.org/',
  footprint: FOOTPRINT_NS,
});

/** The IRIs the reader looks at, by name. */
export const SKOS = Object.freeze({
  Concept: `${SKOS_NS}Concept`,
  ConceptScheme: `${SKOS_NS}ConceptScheme`,
  prefLabel: `${SKOS_NS}prefLabel`,
  altLabel: `${SKOS_NS}altLabel`,
  hiddenLabel: `${SKOS_NS}hiddenLabel`,
  definition: `${SKOS_NS}definition`,
  scopeNote: `${SKOS_NS}scopeNote`,
  broader: `${SKOS_NS}broader`,
  narrower: `${SKOS_NS}narrower`,
  related: `${SKOS_NS}related`,
  inScheme: `${SKOS_NS}inScheme`,
  topConceptOf: `${SKOS_NS}topConceptOf`,
  hasTopConcept: `${SKOS_NS}hasTopConcept`,
} as const);

/** Where a scheme's version may be written, in the order the reader looks. */
export const VERSION_IRIS: readonly string[] = Object.freeze([
  'http://purl.org/dc/terms/modified',
  `${OWL_NS}versionInfo`,
  'https://schema.org/version',
  'http://schema.org/version',
]);

/** The `footprint:` properties `toSkos` writes and `readSkos` reads back. */
export const FOOTPRINT = Object.freeze({
  unit: `${FOOTPRINT_NS}unit`,
  edge: `${FOOTPRINT_NS}edge`,
  to: `${FOOTPRINT_NS}to`,
  relation: `${FOOTPRINT_NS}relation`,
  meaning: `${FOOTPRINT_NS}meaning`,
} as const);

export type JsonLdNode = Readonly<Record<string, unknown>>;

/** A resolved `@context`: term → IRI, prefix → IRI, an optional `@vocab` and default `@language`. */
export interface SkosContext {
  readonly terms: ReadonlyMap<string, string>;
  readonly prefixes: ReadonlyMap<string, string>;
  readonly vocab?: string;
  readonly language?: string;
}

export function isRecord(value: unknown): value is JsonLdNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || value.startsWith('urn:');
}

/**
 * Read a `@context` (an object, an array of objects, or a URL — the last
 * is not fetched). A term whose value is a string or `{ "@id": … }` maps
 * to that IRI; a term whose value ends in `#` or `/` is also a prefix.
 */
export function readContext(context: unknown): SkosContext {
  const terms = new Map<string, string>();
  const prefixes = new Map<string, string>(Object.entries(KNOWN_PREFIXES));
  let vocab: string | undefined;
  let language: string | undefined;
  const parts = Array.isArray(context) ? context : [context];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    for (const [key, raw] of Object.entries(part)) {
      if (key === '@vocab' && typeof raw === 'string') vocab = raw;
      else if (key === '@language' && typeof raw === 'string') language = raw;
      else if (key.startsWith('@')) continue;
      else {
        const iri = typeof raw === 'string' ? raw : isRecord(raw) ? raw['@id'] : undefined;
        if (typeof iri !== 'string') continue;
        const expanded = expandCompact(iri, prefixes) ?? iri;
        terms.set(key, expanded);
        if (expanded.endsWith('#') || expanded.endsWith('/')) prefixes.set(key, expanded);
      }
    }
  }
  return { terms, prefixes, ...(vocab && { vocab }), ...(language && { language }) };
}

/** `prefix:local` → IRI when the prefix is known; else undefined. */
function expandCompact(value: string, prefixes: ReadonlyMap<string, string>): string | undefined {
  const colon = value.indexOf(':');
  if (colon <= 0 || isAbsoluteIri(value)) return undefined;
  const base = prefixes.get(value.slice(0, colon));
  return base === undefined ? undefined : base + value.slice(colon + 1);
}

/**
 * Resolve a key or a `@type` / `@id` value to an IRI: a keyword stays a
 * keyword; a term the context maps; `prefix:local`; a full IRI; a bare
 * name under `@vocab`. Anything else stays as written (a bare literal),
 * which no SKOS IRI ever equals — so it is ignored, not misread.
 */
export function expandIri(value: string, context: SkosContext): string {
  if (value.startsWith('@')) return value;
  const term = context.terms.get(value);
  if (term !== undefined) return term;
  const compact = expandCompact(value, context.prefixes);
  if (compact !== undefined) return compact;
  if (isAbsoluteIri(value)) return value;
  if (context.vocab !== undefined && !value.includes(':')) return context.vocab + value;
  return value;
}

/** A node's properties keyed by expanded IRI (keywords keep their `@` names). */
export function expandNode(node: JsonLdNode, context: SkosContext): ReadonlyMap<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(node)) out.set(expandIri(key, context), value);
  return out;
}

/** Every value under a property as a flat list (`@list`, arrays and singles alike). */
export function valuesOf(node: ReadonlyMap<string, unknown>, iri: string): readonly unknown[] {
  const raw = node.get(iri);
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw['@list'])) return raw['@list'];
  return [raw];
}

/** The `@type` IRIs of a node. */
export function typesOf(
  node: ReadonlyMap<string, unknown>,
  context: SkosContext,
): readonly string[] {
  return valuesOf(node, '@type')
    .filter((t): t is string => typeof t === 'string')
    .map((t) => expandIri(t, context));
}

/** A language-tagged or plain literal. */
export interface Literal {
  readonly value: string;
  readonly language?: string;
}

/** The literals under a property: plain strings, numbers and `{ "@value", "@language"? }` objects. */
export function literalsOf(
  node: ReadonlyMap<string, unknown>,
  iri: string,
  context: SkosContext,
): readonly Literal[] {
  const out: Literal[] = [];
  for (const raw of valuesOf(node, iri)) {
    if (typeof raw === 'string' || typeof raw === 'number') {
      out.push({ value: String(raw), ...(context.language && { language: context.language }) });
    } else if (
      isRecord(raw) &&
      (typeof raw['@value'] === 'string' || typeof raw['@value'] === 'number')
    ) {
      const language = typeof raw['@language'] === 'string' ? raw['@language'] : context.language;
      out.push({ value: String(raw['@value']), ...(language && { language }) });
    }
  }
  return out;
}

/** The IRIs a property points at: strings (resolved) and `{ "@id": … }` objects. */
export function irisOf(
  node: ReadonlyMap<string, unknown>,
  iri: string,
  context: SkosContext,
): readonly string[] {
  const out: string[] = [];
  for (const raw of valuesOf(node, iri)) {
    if (typeof raw === 'string') out.push(expandIri(raw, context));
    else if (isRecord(raw) && typeof raw['@id'] === 'string')
      out.push(expandIri(raw['@id'], context));
  }
  return out;
}

/**
 * The literal in the asked language: a label TAGGED with it wins; a label
 * with no tag at all serves any language (it is not tagged as another);
 * a label tagged with a different language is never taken. Tags compare
 * case-insensitively and exactly (`en` is not `en-US`).
 */
export function inLanguage(literals: readonly Literal[], language: string): readonly string[] {
  const wanted = language.toLowerCase();
  const tagged = literals.filter((l) => l.language?.toLowerCase() === wanted);
  const untagged = literals.filter((l) => l.language === undefined);
  return [...tagged, ...untagged].map((l) => l.value);
}

/**
 * A concept id from its IRI: the last `/` or `#` segment, percent-decoded,
 * lower-cased, `-` and spaces to `_`. Empty when the IRI ends in a delimiter.
 */
export function idFromIri(iri: string): string {
  const stripped = iri.replace(/[?].*$/, '');
  const last = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf('#'));
  const segment = last < 0 ? stripped : stripped.slice(last + 1);
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Not percent-encoded: the segment is used as written.
  }
  return decoded
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}
