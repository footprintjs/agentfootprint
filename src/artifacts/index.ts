/**
 * artifacts — barrel.
 *
 * The claim-check store: shapes + the five-verb port (`types`), the ref
 * grammar (`naming`), the payload laws (`payload`), the eviction law
 * (`retention`), the shared put pipeline (`minting`), three adapters, the
 * `ctx.artifacts` capability (`capability`) — and the Phase-2 data legs:
 * ref arguments at dispatch (`wants`), the hand-to-the-screen verb
 * (`present`), and the placement threshold (`placement`). See README.md in
 * this folder for the one-job map and the import direction.
 */

export {
  ArtifactIntegrityError,
  InvalidArtifactError,
  UnknownParentRefError,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
  type ArtifactOrigin,
  type ArtifactPutResult,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactStreamPutInput,
  type ArtifactStreamRecord,
  type ArtifactSweepReason,
  type PutArtifactInput,
  type SweptArtifact,
} from './types.js';
export { ARTIFACT_REF_PREFIX, isArtifactRef, mintArtifactRef } from './naming.js';
export { type ArtifactRetention } from './retention.js';
export {
  inMemoryArtifacts,
  DEFAULT_IN_MEMORY_ARTIFACT_RETENTION,
  type InMemoryArtifacts,
  type InMemoryArtifactsOptions,
} from './inMemoryArtifacts.js';
export {
  fileArtifacts,
  UnreadableArtifactFileError,
  type FileArtifactsOptions,
} from './fileArtifacts.js';
export {
  sqliteArtifacts,
  UnreadableArtifactStoreError,
  type SqliteArtifacts,
  type SqliteArtifactsOptions,
} from './sqliteArtifacts.js';
export { s3Artifacts, type S3ArtifactsOptions } from './s3Artifacts.js';
export { gcsArtifacts, type GcsArtifactsOptions } from './gcsArtifacts.js';
export {
  assertStreamBytes,
  bytesAsStream,
  canGetArtifactStream,
  canPutArtifactStream,
  canStreamArtifacts,
  collectStream,
  type GetStreamingArtifactStore,
  type PutStreamingArtifactStore,
  type StreamingArtifactStore,
} from './streaming.js';
export {
  bindArtifacts,
  unconfiguredArtifacts,
  type ArtifactEventFact,
  type ArtifactEventSink,
  type ArtifactOp,
  type ArtifactRefusalReason,
  type BindArtifactsOptions,
  type ToolArtifactPutInput,
  type ToolArtifacts,
} from './capability.js';
export {
  assertToolWants,
  resolveToolWants,
  wantsNeedsStoreRefusal,
  type ToolWants,
  type WantsRefusal,
  type WantsResolution,
} from './wants.js';
export {
  PRESENT_TOOL_NAME,
  presentArtifact,
  type PresentOutcome,
  type PresentSnapshot,
  type PresentedResult,
} from './present.js';
export {
  recordingPutInput,
  RECORDING_ARTIFACT_KIND,
  RECORDING_MEDIA_TYPE,
  UnserializableRecordingError,
  type RecordingMintFacts,
} from './recordingArtifact.js';
// The battery a store must pass to CLAIM the port, exported beside the port
// itself so an out-of-tree store imports the check the same way it imports the
// interface it is implementing. Imports no test framework — a case throws to
// fail. See conformance/README.md.
export {
  artifactStoreConformance,
  formatArtifactStoreReport,
  runArtifactStoreCase,
  runArtifactStoreConformance,
  type ArtifactConformanceKit,
  type ArtifactStoreCase,
  type ArtifactStoreCaseName,
  type ArtifactStoreHarness,
  type ArtifactStoreHarnessHook,
  type ArtifactStoreMember,
  type ArtifactStoreOutcome,
  type ArtifactStoreReport,
} from './conformance/index.js';
export {
  assertArtifactPlacement,
  isPlacedToolResult,
  placedResultKind,
  placedToolResult,
  type ArtifactPlacement,
  type PlacedToolResult,
} from './placement.js';
