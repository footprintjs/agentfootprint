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
 * Subpath:  `agentfootprint/observe`
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
 * import { agentcoreObservability } from 'agentfootprint/observe';
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
 *   logGroupName: '/agentfootprint/test',
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
import {
  otelObservability,
  type OtelObservabilityOptions,
  type OtelObservabilityStrategy,
} from './otel.js';

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

/**
 * The instrumentation-scope name AgentCore **Evaluations** classifies spans by.
 *
 * Their span classifier reads `scope.name` and considers only names beginning
 * `opentelemetry.instrumentation.` (or `openinference.instrumentation.`);
 * anything else is skipped without a message. This is the one spelling that
 * makes agentfootprint's spans visible to it — and it lives HERE, in the
 * vendor's own file, because the requirement is theirs, not
 * OpenTelemetry's and not ours.
 */
export const AGENTCORE_EVALUATIONS_SCOPE_NAME = 'opentelemetry.instrumentation.agentfootprint';

/**
 * OTel spans shaped so AgentCore **Evaluations** can read and score them.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * A CONFIGURATION of {@link otelObservability}, not a second implementation:
 * the same spans, the same attributes, with the two settings that vendor
 * requires already correct — the scope name it classifies by, and the
 * turn-level content its scorers read. Everything else is passed through
 * untouched, so nothing about your telemetry becomes AgentCore-shaped except
 * the two things that had to be.
 *
 * ── Why you would use it ─────────────────────────────────────────────────────
 * Since July 2026 AgentCore Evaluations scores agents that DO NOT run on AWS —
 * any agent whose spans reach CloudWatch and match its contract. That makes
 * AWS's built-in evaluators available to an agentfootprint agent hosted
 * anywhere. It does not make your agent an AWS agent, and it replaces nothing:
 * their evaluators say what the score is, and agentfootprint's own trace is
 * still what says why.
 *
 * ── Read this before enabling ────────────────────────────────────────────────
 * It turns `captureContent` ON, which puts the turn's prompt and answer text on
 * the span — that is the point (a scorer cannot grade a turn it cannot read),
 * and it is also an export of raw content to your OTel backend. Pass
 * `captureContent: false` to opt back out and keep the scope name alone;
 * scores will then be based on an empty turn, which is worse than not scoring.
 *
 * Getting the spans to CloudWatch is separate and yours: point an OTLP exporter
 * at the AgentCore log group per AWS's documented header contract, or run
 * inside a runtime that does it for you.
 *
 * @example
 *   import { agentCoreEvaluationSpans } from 'agentfootprint/observe';
 *
 *   agent.enable.observability({
 *     strategy: agentCoreEvaluationSpans({ serviceName: 'support-agent' }),
 *   });
 */
export function agentCoreEvaluationSpans(
  opts: OtelObservabilityOptions,
): OtelObservabilityStrategy {
  return otelObservability({
    captureContent: true,
    ...opts,
    // Not spreadable-over: a caller who overrode this would silently produce
    // spans the service skips, which is the exact failure this function exists
    // to prevent. The scope name is the whole reason it is a named function.
    scopeName: AGENTCORE_EVALUATIONS_SCOPE_NAME,
  });
}
