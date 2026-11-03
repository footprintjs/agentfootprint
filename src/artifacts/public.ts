/* The vendor-neutral artifact surface shared by the root and artifact door. */
export {
  ARTIFACT_REF_PREFIX,
  ArtifactIntegrityError,
  bindArtifacts,
  // Recordings-as-artifacts (9.26.0) — a completed run's
  // `{ snapshot, events, structure }` checked in under kind 'recording/run',
  // so the existing artifact wire ops serve the Lens with no new operation.
  RECORDING_ARTIFACT_KIND,
  RECORDING_MEDIA_TYPE,
  recordingPutInput,
  // The chart-walk kind (9.76.0) — a runbook's inner walk, one row per
  // execution step with the decide() evidence in the `condition` rows,
  // checked in under 'recording/chart-walk' beside 'recording/run'.
  CHART_WALK_ARTIFACT_KIND,
  chartWalkPutInput,
  UnserializableRecordingError,
  DEFAULT_IN_MEMORY_ARTIFACT_RETENTION,
  fileArtifacts,
  inMemoryArtifacts,
  InvalidArtifactError,
  isArtifactRef,
  mintArtifactRef,
  sqliteArtifacts,
  unconfiguredArtifacts,
  UnknownParentRefError,
  UnreadableArtifactFileError,
  UnreadableArtifactStoreError,
  type ArtifactEventFact,
  type ArtifactEventSink,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
  type ArtifactOp,
  type ArtifactOrigin,
  type ArtifactPutResult,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactRefusalReason,
  type ArtifactRetention,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactSweepReason,
  type BindArtifactsOptions,
  type FileArtifactsOptions,
  type InMemoryArtifacts,
  type InMemoryArtifactsOptions,
  type PutArtifactInput,
  type RecordingMintFacts,
  type SqliteArtifacts,
  type SqliteArtifactsOptions,
  type SweptArtifact,
  type ToolArtifactPutInput,
  type ToolArtifacts,
  withDatasetArtifacts,
  stageDatasetArtifacts,
  type DatasetArtifactInput,
  type DatasetArtifactReceipt,
  type DatasetPublication,
  type DatasetResultAdapter,
  type DatasetResultPlan,
  describeTimeAxis,
  normaliseInstants,
  readTimeAxis,
  timeAxisIssues,
  TIME_AXIS_AGGREGATES,
  TIME_AXIS_UNITS,
  type AxisCounts,
  type AxisOverlapNote,
  type AxisPoint,
  type AxisPrecision,
  type DatasetTimeAxis,
  type NaiveValues,
  type NormalisedAxis,
  type NormaliseOptions,
  type TimeAxisAggregate,
  type TimeAxisReading,
  type TimeAxisUnit,
} from './index.js';
// Artifacts, the optional streaming leg (9.25.0) — `putStream`/`getStream` are
// FEATURE-DETECTED members of the port, so a store that cannot move bytes
// without holding them whole leaves them absent rather than faking one. The
// guards narrow the type, so calling an absent member is a compile error.
export {
  canGetArtifactStream,
  canPutArtifactStream,
  canStreamArtifacts,
  type ArtifactStreamPutInput,
  type ArtifactStreamRecord,
  type StreamingArtifactStore,
} from './index.js';
// Artifacts, the CONFORMANCE battery — the laws a store must hold to claim the
// port, written once against the port and run against every store, in-tree or
// out. On the main barrel because that is where `ArtifactStore` itself ships:
// somebody implementing the port imports the check from the same door as the
// interface. Nothing in it imports a test framework — a case throws to fail —
// so it runs under vitest, jest, `node:test` or a plain script.
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
} from './index.js';
// Artifacts, the data legs (9.22.0) — refs the model ROUTES: `wants` (ref
// arguments resolved at dispatch, the declare-and-push precedent applied to
// data), the auto-attached `present` tool (hand a ref to the screen with a
// description snapshot the transcript keeps), and the placement threshold
// (`artifacts: { store, placement }` — oversized results become claim
// tickets). All zero-cost without a store.
export {
  assertToolWants,
  isPlacedToolResult,
  placedResultKind,
  PRESENT_TOOL_NAME,
  type ArtifactPlacement,
  type PlacedToolResult,
  type PresentedResult,
  type PresentSnapshot,
  type ToolWants,
} from './index.js';
