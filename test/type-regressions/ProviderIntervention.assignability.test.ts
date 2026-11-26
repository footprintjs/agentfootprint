import { describe, expect, it } from 'vitest';
import {
  bedrock,
  BedrockProvider,
  ProviderBlockedError,
  ProviderInterventionUnknownError,
  ProviderGuardrailLimitError,
  type BedrockProviderOptions,
  type BedrockGuardrailOptions,
  type BedrockGuardrailTrace,
  type ProviderIntervention,
} from '../../src/doors/providers.js';

type Blocked = Extract<ProviderIntervention, { outcome: 'blocked' }>;
type Masked = Extract<ProviderIntervention, { outcome: 'masked' }>;
type Unknown = Extract<ProviderIntervention, { outcome: 'unknown' }>;

describe('provider intervention public discriminated contract', () => {
  it('keeps all three Extract arms inhabitable and independently narrowable', () => {
    const blocked: Blocked = { outcome: 'blocked', code: 'guardrail_intervened', filters: [] };
    const masked: Masked = { outcome: 'masked', code: 'guardrail_intervened', filters: [] };
    const unknown: Unknown = { outcome: 'unknown', code: 'content_filtered', filters: [] };
    const values: readonly ProviderIntervention[] = [blocked, masked, unknown];
    const classify = (value: ProviderIntervention): string => {
      switch (value.outcome) {
        case 'blocked': {
          const arm: Blocked = value;
          return arm.outcome;
        }
        case 'masked': {
          const arm: Masked = value;
          return arm.outcome;
        }
        case 'unknown': {
          const arm: Unknown = value;
          return arm.outcome;
        }
        default: {
          const exhaustive: never = value;
          return exhaustive;
        }
      }
    };
    expect(values.map(classify)).toEqual(['blocked', 'masked', 'unknown']);
    // @ts-expect-error Unknown is not the proved-block arm.
    const falseProof: Blocked = unknown;
    // @ts-expect-error A successful-looking fourth outcome is not admitted.
    const badOutcome: ProviderIntervention = { outcome: 'success', code: 'x', filters: [] };
    void falseProof;
    void badOutcome;
    // @ts-expect-error Metadata is read-only for a consumer.
    blocked.outcome = 'masked';
    // @ts-expect-error The original provider code cannot be replaced.
    blocked.code = 'changed';
  });

  it('exports distinct terminal error classes and their public codes', () => {
    const blocked: Blocked = { outcome: 'blocked', code: 'guardrail_intervened', filters: [] };
    const unknown: Unknown = { outcome: 'unknown', code: 'guardrail_intervened', filters: [] };
    const cause = new Error('scripted cause');
    const refused = new ProviderBlockedError(blocked, cause);
    const unresolved = new ProviderInterventionUnknownError(unknown, cause);
    const limited = new ProviderGuardrailLimitError();
    const blockCode: 'ERR_PROVIDER_BLOCKED' = refused.code;
    const unknownCode: 'ERR_PROVIDER_INTERVENTION_UNKNOWN' = unresolved.code;
    const limitCode: 'ERR_PROVIDER_GUARDRAIL_LIMIT' = limited.code;
    expect([blockCode, unknownCode, limitCode]).toEqual([
      'ERR_PROVIDER_BLOCKED',
      'ERR_PROVIDER_INTERVENTION_UNKNOWN',
      'ERR_PROVIDER_GUARDRAIL_LIMIT',
    ]);
    expect(refused.cause).toBe(cause);
    expect(unresolved.cause).toBe(cause);
    expect(refused).not.toBeInstanceOf(ProviderInterventionUnknownError);
    expect(unresolved).not.toBeInstanceOf(ProviderBlockedError);
  });

  it('types both constructors, all trace choices and only synchronous message formatting', () => {
    const traces: readonly BedrockGuardrailTrace[] = ['disabled', 'enabled', 'enabled_full'];
    const options = (trace: BedrockGuardrailTrace): BedrockProviderOptions => ({
      guardrail: {
        id: 'abc123',
        version: '1',
        trace,
        maxBufferedBytes: 1024,
        cleanMessage(value) {
          const safe: ProviderIntervention = value;
          // @ts-expect-error A formatter cannot mutate the admitted disposition.
          value.outcome = 'masked';
          // @ts-expect-error Descriptors cannot be appended in the callback.
          value.filters.push({ family: 'private' });
          // @ts-expect-error A formatter cannot replace a descriptor's label.
          value.filters[0].family = 'private';
          return safe.outcome === 'blocked' ? 'Withheld.' : 'Unresolved.';
        },
      },
    });
    const factory: (value: BedrockProviderOptions) => ReturnType<typeof bedrock> = bedrock;
    const construct: new (value?: BedrockProviderOptions) => BedrockProvider = BedrockProvider;
    // Keep this a free type-contract test: neither constructor is invoked,
    // so no SDK is loaded or client created.
    expect(typeof factory).toBe('function');
    expect(typeof construct).toBe('function');
    expect(traces.map((trace) => options(trace).guardrail?.trace)).toEqual(traces);
    // @ts-expect-error Tracing has a closed documented vocabulary.
    const badTrace: BedrockGuardrailTrace = 'verbose';
    // @ts-expect-error The formatter must synchronously return a string.
    const badHook: BedrockGuardrailOptions['cleanMessage'] = async () => 'later';
    // @ts-expect-error A boolean is not the formatter's presentation result.
    const badReturn: BedrockGuardrailOptions['cleanMessage'] = () => true;
    void badTrace;
    void badHook;
    void badReturn;
  });
});
