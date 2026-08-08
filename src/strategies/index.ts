/**
 * strategies — typed strategy interfaces + default sinks for the v2.8
 * grouped-enabler architecture.
 *
 * See:
 *   - `docs/inspiration/strategy-everywhere.md` — design memo + AWS-first roadmap
 *   - `types.ts` — typed interfaces (Observability, Cost, LiveStatus, Lens)
 *   - `defaults/` — the 4 in-core default strategies
 *
 * Vendor strategies live in grouped files, all reachable through the one
 * `agentfootprint/observe` door — adding a vendor adds an export, never an
 * import path:
 *
 *   - `src/observability-providers.ts`
 *       agentcoreObservability (v2.8.1)
 *       cloudwatchObservability (v2.8.2)
 *       xrayObservability (v2.8.3)
 *       otelObservability (v2.9.x)
 *       datadogObservability (v2.9.x)
 *
 * Each adapter lazy-imports its vendor SDK via `lib/lazyRequire.ts`,
 * so consumers who never call a particular factory don't have to
 * install that SDK. Peer-deps are declared in package.json with
 * `peerDependenciesMeta.{name}.optional = true`.
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/observe`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

export * from './types.js';
export * from './defaults/index.js';
export { composeObservability, composeCost, composeLiveStatus, composeLens } from './compose.js';
export {
  attachObservabilityStrategy,
  attachCostStrategy,
  attachLiveStatusStrategy,
  type ObservabilityEnableOptions,
  type CostEnableOptions,
  type LiveStatusEnableOptions,
} from './attach.js';
