/** Removed APIs must fail at the public type boundary, not just disappear at runtime. */
import { describe, expect, it } from 'vitest';
import * as security from '../../src/doors/security.js';
import { ALL_EVENT_TYPES, EVENT_NAMES } from '../../src/events.js';
import type { AgentfootprintEventType, DomainWildcard, Payloads } from '../../src/events.js';
import { FIELD_NAMES, keepKnownValues, LIBRARY_WORDS } from '../../src/redaction/knownStrings.js';
import { SERVED_PLACEHOLDER } from '../../src/redaction/placeholder.js';
// @ts-expect-error removed unused context port
import type { ResolveCtx } from '../../src/index.js';
// @ts-expect-error removed unused context port
import type { ContextContribution } from '../../src/index.js';
// @ts-expect-error removed unused context port
import type { ContextSourceAdapter } from '../../src/index.js';
// @ts-expect-error use Embedder from agentfootprint/providers
import type { EmbeddingProvider } from '../../src/index.js';
// @ts-expect-error removed unused risk port
import type { RiskContext } from '../../src/index.js';
// @ts-expect-error removed unused risk port
import type { RiskResult } from '../../src/index.js';
// @ts-expect-error use tool middleware for application risk policy
import type { RiskDetector } from '../../src/index.js';
// @ts-expect-error retired factory is not a supported API
import type { agentCorePolicy } from '../../src/doors/security.js';
// @ts-expect-error retired factory's error is removed with its only producer
import type { AgentCorePolicyRetiredError } from '../../src/doors/security.js';
// @ts-expect-error retired factory's options are removed
import type { AgentCorePolicyOptions } from '../../src/doors/security.js';
// @ts-expect-error retired factory's client is removed
import type { AgentCorePolicyClientLike } from '../../src/doors/security.js';
// @ts-expect-error retired factory's evaluation is removed
import type { AgentCorePolicyEvaluation } from '../../src/doors/security.js';
// @ts-expect-error retired factory's fallback mode is removed
import type { AgentCorePolicyUnavailable } from '../../src/doors/security.js';
// @ts-expect-error retired factory's SDK shim is removed
import type { BedrockAgentCorePolicySdkModule } from '../../src/doors/security.js';

// @ts-expect-error no producer exists for this removed payload
type RemovedRiskPayload = Payloads.RiskFlaggedPayload;
// @ts-expect-error subscriptions cannot name an event that was never emitted
const removedRiskEvent: AgentfootprintEventType = 'agentfootprint.risk.flagged';
// @ts-expect-error removed domains cannot be subscribed to via a wildcard
const removedRiskWildcard: DomainWildcard = 'agentfootprint.risk.*';

describe('removed security and risk public contracts', () => {
  it('does not expose the retired factory or its error at runtime', () => {
    expect(security).not.toHaveProperty('agentCorePolicy');
    expect(security).not.toHaveProperty('AgentCorePolicyRetiredError');
    expect(typeof security.PermissionPolicy.fromRoles).toBe('function');
  });

  it('has no event name or domain for the removed risk contract', () => {
    expect(ALL_EVENT_TYPES).not.toContain(removedRiskEvent);
    expect(EVENT_NAMES).not.toHaveProperty('risk');
    expect(removedRiskWildcard).toBe('agentfootprint.risk.*');
  });

  it('no longer treats the removed risk vocabulary as safe event metadata', () => {
    const words = [
      'agentfootprint.risk.flagged',
      'cost_overrun',
      'critical',
      'hallucination_flag',
      'llama_guard',
      'nemo_guardrails',
      'pii',
      'prompt_injection',
      'redact',
      'runaway_loop',
    ];
    for (const word of words) expect(LIBRARY_WORDS).not.toHaveProperty(word);
    for (const field of ['category', 'detector', 'severity']) {
      expect(FIELD_NAMES).not.toHaveProperty(field);
    }
    expect(keepKnownValues(words)).toEqual(words.map(() => SERVED_PLACEHOLDER));
    expect(keepKnownValues({ category: 'scope', detector: 'custom', severity: 'high' })).toEqual({
      [SERVED_PLACEHOLDER]: SERVED_PLACEHOLDER,
    });
    const permission = { type: 'agentfootprint.permission.check', result: 'deny', iteration: 1 };
    expect(keepKnownValues(permission)).toEqual(permission);
  });
});
