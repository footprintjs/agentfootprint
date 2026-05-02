/**
 * `agentfootprint/strategies` — typed strategy interfaces + default
 * sinks for the v2.8 grouped-enabler architecture.
 *
 * See:
 *   - `docs/inspiration/strategy-everywhere.md` — design memo + AWS-first roadmap
 *   - `types.ts` — typed interfaces (Observability, Cost, LiveStatus, Lens)
 *   - `defaults/` — the 4 in-core default strategies
 *
 * Vendor strategies ship as separate subpaths:
 *   - `agentfootprint/observability-agentcore` (v2.8.1)
 *   - `agentfootprint/observability-cloudwatch` (v2.8.2)
 *   - `agentfootprint/observability-xray` (v2.8.3)
 *   - `agentfootprint/observability-otel` (v2.9.x)
 *   - `agentfootprint/observability-datadog` (v2.9.x)
 *   - `agentfootprint/cost-stripe` (v2.10.x)
 *   - `agentfootprint/lens-browser` / `lens-cli` (v2.12.x)
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
