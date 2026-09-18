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
 * Ontology v3 — at most six lines (v3, 9.108.0: the tool → skill line). Every sentence is about the model's own
 * conduct with a map that holds no data: read the question in its terms,
 * look where a source and its tool are declared, walk a relation from what
 * is held to what is needed, say where an unmet need WOULD be met, never a
 * value read off a definition — and speak to the person of sources, tools
 * and terms, never of the map (v1 made the model cite "the ontology" in five
 * of eight measured answers; docs/design/2026-09-ontology.md § Measured).
 */
export const ONTOLOGY_INSTRUCTION = [
  'Ontology v3. A declared map of the domain is served as a system piece headed ' +
    '"[AgentFootprint ontology": what each term means, which source holds it, which tool reads ' +
    'it from there, how terms relate, and which terms are known but held nowhere here. The map ' +
    'holds no data and fetches none.',
  "Read the question in the map's terms and aliases. Where a term is held by a declared source, " +
    'the tool named beside it is where to look, and where that tool is named with the skill that ' +
    'declares it, that skill id is what read_skill takes; a relation is the way from a term ' +
    'already held to the term needed.',
  'When the results did not meet a need, say which declared source, tool or neighbouring term ' +
    'the map names for it — as a proposal, never as a claim that data exists there. A term ' +
    'known but held nowhere here has no declared source: report that as declared, without ' +
    'guessing one.',
  'Never invent a value from the map: a meaning, unit or coverage sentence is a definition, ' +
    'not an observation.',
  'Speak to the person of sources, tools and terms — never of the map, the ontology or a ' +
    'declaration. Those are how the answer knows where to look, not what the person asked.',
].join('\n');
