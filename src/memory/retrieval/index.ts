/**
 * memory/retrieval — what a retrieval considered, and the seam that
 * decides what it keeps.
 *
 * @see ./types.ts   the record + the strategy interface
 * @see ./topK.ts    the strategy 8.7.0 had, now written down as one
 */
export type {
  RetrievalEvidence,
  RetrievalRejectReason,
  RetrievalStrategy,
  RetrievalVerdict,
  RetrievedCandidate,
  ScoredCandidate,
} from './types.js';
export { topK, type TopKOptions } from './topK.js';
export { chunkProvenance, chunkText, type ChunkProvenance } from './provenance.js';
