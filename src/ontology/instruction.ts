/**
 * ontology/instruction — the always-on ask `.ontology(...)` registers.
 *
 * Pattern: one versioned string constant and its injection id; a
 *          zero-import leaf (`AgentBuilder` imports it on the default graph,
 *          so it carries nothing else).
 * Role:    Lens. It says what the model may DO with the served map and
 *          promises nothing about serving; the map itself is the request-only
 *          piece `serve.ts · ontologyPiece` composes. Registered through
 *          `defineInstruction` the way `outputSchema()` and `.findings()`
 *          register theirs, so it is a system piece the receipt hashes per
 *          request and never a `history` turn. Judged by `unprovable` in
 *          `test/modelFacingSurfaces.test.ts`.
 * Emits:   N/A.
 */

/** The injection id under which the ask is registered — one per agent. */
export const ONTOLOGY_INSTRUCTION_ID = 'ontology';

/**
 * Ontology v1 — at most six lines. Every sentence is about the model's own
 * conduct with a map that holds no data: say where a need WOULD be met,
 * never that data exists there, never a value read off a definition.
 */
export const ONTOLOGY_INSTRUCTION = [
  'Ontology v1. A declared map of the domain is served as a system piece headed ' +
    '"[AgentFootprint ontology": what each term means, which source holds it, which tool reads ' +
    'it from there, and how terms relate. The map holds no data and fetches none.',
  'When the results did not meet a need, say which declared source, tool or neighbouring node ' +
    'the map names for that need — as a proposal, never as a claim that data exists there.',
  'Never invent a value from the map: a meaning, unit or coverage sentence is a definition, ' +
    'not an observation.',
  'A node listed as known but not held here has no declared source: report that as declared, ' +
    'without guessing a source for it.',
].join('\n');
