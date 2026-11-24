/** Capture foreign intervention evidence once before any downstream observer can re-read it. */
import type { LLMResponse } from './types.js';
import { providerInterventionOf } from './intervention.js';

function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function nonnegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function ownedUsage(response: unknown): LLMResponse['usage'] {
  const raw = ownValue(response, 'usage');
  const usage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    thinking?: number;
  } = {
    input: nonnegative(ownValue(raw, 'input')) ?? 0,
    output: nonnegative(ownValue(raw, 'output')) ?? 0,
  };
  for (const key of ['cacheRead', 'cacheWrite', 'thinking'] as const) {
    const value = nonnegative(ownValue(raw, key));
    if (value !== undefined) usage[key] = value;
  }
  return Object.freeze(usage);
}

const RESPONSE_FIELDS = [
  'content',
  'toolCalls',
  'usage',
  'stopReason',
  'providerRef',
  'replay',
  'replayOmissions',
  'rawThinking',
  'wireManifest',
] as const;

/**
 * The absent arm is identity and reads no additional response fields. On the
 * intervention arm later policy/admission reads only the owned discriminant.
 * A terminal outcome never reads content, tools, replay or arbitrary raw fields.
 */
export function captureProviderResponse(response: LLMResponse): LLMResponse {
  const intervention = providerInterventionOf(response);
  if (intervention === undefined) return response;
  if (intervention.outcome !== 'masked') {
    const providerRef = ownValue(response, 'providerRef');
    return Object.freeze({
      content: '',
      toolCalls: Object.freeze([]),
      usage: ownedUsage(response),
      stopReason: intervention.code,
      intervention,
      ...(typeof providerRef === 'string' &&
        providerRef.length <= 256 &&
        Array.from(providerRef).length <= 128 &&
        new TextEncoder().encode(providerRef).length <= 512 && { providerRef }),
    });
  }
  // Only the documented response port crosses this boundary. Reading a data
  // descriptor does not invoke an accessor; no unknown property is enumerated.
  const captured: Record<string, unknown> = { intervention };
  for (const key of RESPONSE_FIELDS) {
    const value = ownValue(response, key);
    if (value !== undefined) captured[key] = value;
  }
  return Object.freeze(captured) as unknown as LLMResponse;
}
