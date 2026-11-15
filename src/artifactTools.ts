/** Public tools for governed stored JSON and exact historical source evidence. */
export { artifactDetailTool, type ArtifactDetailOptions } from './tools/artifactDetailTool.js';
export { ArtifactDetailError, type ArtifactDetailErrorCode } from './artifacts/detailError.js';
export type {
  ArtifactDetailAction,
  ArtifactDetailArgs,
  ArtifactDetailChild,
  ArtifactDetailResult,
} from './artifacts/detailTypes.js';
export { withSourceEvidence } from './tools/sourceEvidence.js';
export type {
  SourceEvidenceOptions,
  SourceEvidenceDescriptor,
  SourceEvidencePreparationContext,
  SourceEvidenceMetadata,
  SourceEvidenceRecentArgs,
  SourceEvidenceRecentResult,
  SourceEvidencePreparation,
} from './tools/sourceEvidence.js';
export type {
  SourceEvidenceSubject,
  SourceEvidenceScalar,
  SourceEvidenceScope,
  SourceEvidenceDataset,
  SourceEvidenceDeclaration,
  SourceEvidenceProjection,
  SourceEvidenceCandidate,
  SourceEvidenceIndex,
  SourceEvidenceLimits,
  SourceEvidenceFindArgs,
  SourceEvidenceReadArgs,
  SourceEvidenceDatasetDeclaration,
  SourceEvidenceSource,
} from './artifacts/sourceEvidence/types.js';
