/**
 * agentfootprint/observability-providers — vendor observability strategies.
 *
 * Grouped subpath following the parallel-providers pattern v2.5
 * established for `llm-providers` / `tool-providers` /
 * `memory-providers`. Adding a new vendor adds an export here, NOT
 * a new subpath — keeps `package.json#exports` from sprawling.
 *
 * Each adapter lazy-imports its vendor SDK via `lib/lazyRequire.ts`,
 * so consumers who never call a particular factory don't have to
 * install that SDK. Peer-deps are declared in package.json with
 * `peerDependenciesMeta.{name}.optional = true`.
 *
 * @example
 * ```ts
 * import { agentcoreObservability } from 'agentfootprint/observability-providers';
 * import { microtaskBatchDriver } from 'footprintjs/detach';
 *
 * agent.enable.observability({
 *   strategy: agentcoreObservability({
 *     region: 'us-east-1',
 *     logGroupName: '/agentfootprint/my-agent',
 *   }),
 *   // Recommended — keeps the agent loop unblocked by network latency.
 *   detach: { driver: microtaskBatchDriver, mode: 'forget' },
 * });
 * ```
 *
 * Roadmap:
 *   - agentcoreObservability   ← v2.8.1 (this release)
 *   - cloudwatchObservability  ← v2.8.2
 *   - xrayObservability        ← v2.8.3
 *   - otelObservability        ← v2.9.x
 *   - datadogObservability     ← v2.9.x
 */

export {
  agentcoreObservability,
  type AgentcoreObservabilityOptions,
} from './adapters/observability/agentcore.js';
