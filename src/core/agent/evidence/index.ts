/**
 * The evidence gate — `.namesAndNumbersFromEvidence()` (9.35.0).
 *
 * This file is the folder's door: it re-exports the handful of names the main
 * barrel publishes and nothing else. The machinery (`extract`, `normalize`,
 * `evidenceIndex`) stays internal — those are the parts we expect to tune as
 * more domains are measured, and a consumer who pinned them would make that
 * impossible. See ./README.md for the design.
 */

export { EVIDENCE_CHECK_FRAME_PREFIX } from './gate.js';
export type {
  EvidencePosture,
  EvidenceShape,
  EvidenceVerdict,
  NamesAndNumbersOptions,
  UnsupportedValue,
} from './types.js';
