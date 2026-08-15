/**
 * artifacts/conformance — the battery a store must pass to claim
 * {@link ArtifactStore}.
 *
 * Re-exported from `agentfootprint`, so an out-of-tree store imports it
 * exactly the way it imports the port it is implementing. See the README
 * beside this file for why it exists and how to run it.
 */

export { artifactStoreConformance } from './cases.js';
export {
  formatArtifactStoreReport,
  runArtifactStoreCase,
  runArtifactStoreConformance,
} from './run.js';
export type {
  ArtifactConformanceKit,
  ArtifactStoreCase,
  ArtifactStoreCaseName,
  ArtifactStoreHarness,
  ArtifactStoreHarnessHook,
  ArtifactStoreMember,
  ArtifactStoreOutcome,
  ArtifactStoreReport,
} from './types.js';
