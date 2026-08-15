/**
 * The two coverage primitives — `absent()` and `coverage()`.
 *
 * The door: what the main barrel publishes, and the one import path the
 * dispatch loop, the evidence index and the final-answer stage use. Both
 * primitives came from FIELD USE — a production triage agent that had
 * invented them because the library had no answer for either. See README.md
 * for the arguments; nothing here is new machinery, it is a smaller version
 * of what already worked.
 */

export { ABSENCE_MARKER, ABSENCE_NOTE, absent, coverageOfAbsence, readAbsence } from './absent.js';
export { composeAnswerWithCoverage, COVERAGE_BLOCK_HEADING } from './answer.js';
export { absenceEvidenceProjection } from './evidence.js';
export { mergeItems, normalizeCoverageList, sameItem } from './items.js';
export {
  coverage,
  COVERAGE_MARKER,
  COVERAGE_NOTE,
  coverageOfLedger,
  readCoverageLedger,
} from './ledger.js';
export { readCoverageResult, type CoverageFacts, type CoverageReading } from './read.js';
export type {
  AbsenceDeclaration,
  Coverage,
  CoverageDeclaration,
  CoverageInput,
  CoverageItem,
  CoveredResult,
  DeclaredCoverage,
  ToolAbsence,
} from './types.js';
