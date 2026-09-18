/**
 * ontology/ — the declared map: what exists, where it is held, how it is
 * reached — never a way to fetch it.
 *
 * The implementation barrel behind `agentfootprint/ontology`
 * (`src/doors/ontology.ts`), the `classify/index.ts` shape. `defineOntology`
 * is the ONE way to build an `Ontology`; `.ontology(...)` on the agent
 * builder is the ONE way to mount it; `ontologyPiece` is the ONE composer of
 * what the model is served, called by the wire and by the rebuild.
 * `fromSkos` / `readSkos` / `toSkos` (9.112.0) are the SKOS adapter — a
 * customer's concept scheme in, our spec out, and back — never a second
 * validation path: `defineOntology` still reads the result.
 */

export { defineOntology, ontologyHash, ONTOLOGY_LIMITS } from './define.js';
export { ONTOLOGY_INSTRUCTION, ONTOLOGY_INSTRUCTION_ID } from './instruction.js';
export { ontologyPiece, ONTOLOGY_PIECE_LIMITS, type OntologyPiece } from './serve.js';
export {
  scoreAbsence,
  summarizeAbsence,
  type AbsenceExpectation,
  type AbsenceScore,
  type AbsenceSummary,
  type AbsenceTurn,
} from './score.js';
export {
  fromSkos,
  readSkos,
  SkosError,
  type ReadSkosOptions,
  type SkosConcept,
  type SkosErrorCode,
  type SkosInput,
  type SkosJoin,
  type SkosScheme,
} from './fromSkos.js';
export { toSkos, SKOS_IRI_BASE, type SkosDocument, type ToSkosOptions } from './toSkos.js';
export { SKOS_NS, FOOTPRINT_NS } from './skosJsonLd.js';
export type {
  Ontology,
  OntologyAsk,
  OntologyEdge,
  OntologyJoin,
  OntologyNode,
  OntologyNodeSource,
  OntologyRecord,
  OntologySource,
  OntologySpec,
} from './types.js';
