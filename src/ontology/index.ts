/**
 * ontology/ — the declared map: what exists, where it is held, how it is
 * reached — never a way to fetch it.
 *
 * The implementation barrel behind `agentfootprint/ontology`
 * (`src/doors/ontology.ts`), the `classify/index.ts` shape. `defineOntology`
 * is the ONE way to build an `Ontology`; `.ontology(...)` on the agent
 * builder is the ONE way to mount it; `ontologyPiece` is the ONE composer of
 * what the model is served, called by the wire and by the rebuild.
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
