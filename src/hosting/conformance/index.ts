/**
 * hosting/conformance — the battery a store must pass to claim
 * {@link SessionLifecycle}.
 *
 * Re-exported from `agentfootprint/hosting`, so an out-of-tree store imports
 * it exactly the way it imports the port it is implementing. See the README
 * beside this file for why it exists and how to run it.
 */

export { sessionLifecycleConformance } from './cases.js';
export {
  formatConformanceReport,
  runSessionLifecycleCase,
  runSessionLifecycleConformance,
} from './run.js';
export type {
  ConformanceKit,
  SessionLifecycleCase,
  SessionLifecycleCaseName,
  SessionLifecycleOutcome,
  SessionLifecycleReport,
  SessionStoreHarness,
  SessionStoreMember,
} from './types.js';
