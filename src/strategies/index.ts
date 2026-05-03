/**
 * `agentfootprint/strategies` — typed strategy interfaces + default
 * sinks for the v2.8 grouped-enabler architecture.
 *
 * See:
 *   - `docs/inspiration/strategy-everywhere.md` — design memo + AWS-first roadmap
 *   - `types.ts` — typed interfaces (Observability, Cost, LiveStatus, Lens)
 *   - `defaults/` — the 4 in-core default strategies
 *
 * Vendor strategies ship under three GROUPED subpaths (matching the
 * parallel-providers pattern v2.5 established for `llm-providers` /
 * `tool-providers` / `memory-providers`). Each subpath holds N
 * vendor-named factories — adding a vendor never adds a new subpath:
 *
 *   - `agentfootprint/observability-providers`
 *       agentcoreObservability (v2.8.1)
 *       cloudwatchObservability (v2.8.2)
 *       xrayObservability (v2.8.3)
 *       otelObservability (v2.9.x)
 *       datadogObservability (v2.9.x)
 *
 *   - `agentfootprint/cost-providers`
 *       stripeCost (v2.10.x)
 *
 *   - `agentfootprint/lens-providers`
 *       browserLens / cliLens (v2.12.x)
 *
 * Each adapter lazy-imports its vendor SDK via `lib/lazyRequire.ts`,
 * so consumers who never call a particular factory don't have to
 * install that SDK. Peer-deps are declared in package.json with
 * `peerDependenciesMeta.{name}.optional = true`.
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
