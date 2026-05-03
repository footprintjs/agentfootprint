/**
 * agentcoreObservability — AWS Bedrock AgentCore observability adapter.
 *
 * Ships every `AgentfootprintEvent` to **CloudWatch Logs** in a
 * structured-JSON shape AgentCore's hosted-agent telemetry layer
 * understands. Use when:
 *
 *   1. Your agent runs INSIDE AgentCore — events show up alongside
 *      AgentCore's own runtime telemetry in the same log group.
 *   2. Your agent runs OUTSIDE AgentCore but you want to query agent
 *      behavior in CloudWatch Insights / X-Ray traces using the same
 *      schema AgentCore uses internally.
 *
 * Subpath:  `agentfootprint/observability-providers`
 * Peer dep: `@aws-sdk/client-cloudwatch-logs` (OPTIONAL — installed
 *           only when this adapter is used; declared via
 *           `peerDependenciesMeta.{name}.optional = true`).
 *
 * **Implementation:** thin wrapper over `cloudwatchObservability`'s
 * shared base. The only difference is the strategy `name` (used for
 * registry lookup + diagnostics). All batching, flush, error-routing,
 * and SDK-loading behavior is identical. As we evolve the CloudWatch
 * shipping path (retry, sequence tokens, metrics emission), every
 * CloudWatch-shaped adapter inherits the improvement.
 *
 * @example Basic
 * ```ts
 * import { agentcoreObservability } from 'agentfootprint/observability-providers';
 * import { microtaskBatchDriver } from 'footprintjs/detach';
 *
 * agent.enable.observability({
 *   strategy: agentcoreObservability({
 *     region: 'us-east-1',
 *     logGroupName: '/agentfootprint/my-agent',
 *     logStreamName: `${process.env.HOSTNAME}/${Date.now()}`,
 *   }),
 *   detach: { driver: microtaskBatchDriver, mode: 'forget' },
 * });
 * ```
 *
 * @example Test injection (skip SDK require entirely)
 * ```ts
 * agentcoreObservability({
 *   _client: {
 *     putLogEvents: async (input) => { capturedBatches.push(input); },
 *   },
 * });
 * ```
 */

import type { ObservabilityStrategy } from '../../strategies/types.js';

import {
  _buildCloudWatchObservability,
  type CloudwatchObservabilityOptions,
} from './cloudwatch.js';

/**
 * AgentCore-specific options. Currently identical to the generic
 * `CloudwatchObservabilityOptions` — kept as a separate type for
 * future-proofing (AgentCore-specific knobs like
 * `agentcoreSessionId` propagation could land here without a
 * breaking change).
 */
export type AgentcoreObservabilityOptions = CloudwatchObservabilityOptions;

/**
 * Build an AgentCore-flavored CloudWatch Logs observability strategy.
 * Functionally identical to `cloudwatchObservability` except for the
 * strategy `name`, which lets registry-lookup + diagnostics
 * distinguish AgentCore-targeted shipping from generic CloudWatch.
 */
export function agentcoreObservability(opts: AgentcoreObservabilityOptions): ObservabilityStrategy {
  return _buildCloudWatchObservability(opts, 'agentcore');
}
