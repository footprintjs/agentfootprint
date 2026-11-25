/** Safe provider intervention evidence. Raw provider assessments never cross this port. */
interface InterventionDetails {
  /** Original bounded provider stop code, or a fixed incomplete-response code. */
  readonly code: string;
  /** Closed provider policy families and authorized labels, never matched text. */
  readonly filters: readonly { readonly family: string; readonly type?: string }[];
  /** Optional bounded application-authored presentation; never changes the outcome. */
  readonly message?: string;
}

/** One discriminant, so consumers can narrow each disposition independently. */
export type ProviderIntervention = InterventionDetails &
  (
    | { readonly outcome: 'blocked' }
    | { readonly outcome: 'masked' }
    | { readonly outcome: 'unknown' }
  );

export class ProviderBlockedError extends Error {
  readonly code = 'ERR_PROVIDER_BLOCKED';
  readonly retryable = false;
  constructor(
    readonly intervention: Extract<ProviderIntervention, { outcome: 'blocked' }>,
    cause?: unknown,
  ) {
    super(intervention.message ?? 'The provider blocked this response.', { cause });
    this.name = 'ProviderBlockedError';
  }
}

export class ProviderInterventionUnknownError extends Error {
  readonly code = 'ERR_PROVIDER_INTERVENTION_UNKNOWN';
  readonly retryable = false;
  constructor(
    readonly intervention: Extract<ProviderIntervention, { outcome: 'unknown' }>,
    cause?: unknown,
  ) {
    super(intervention.message ?? 'The provider intervention outcome is unknown.', { cause });
    this.name = 'ProviderInterventionUnknownError';
  }
}

/** A configured stream exceeded its private pre-release buffer; it is never resent. */
export class ProviderGuardrailLimitError extends Error {
  readonly code = 'ERR_PROVIDER_GUARDRAIL_LIMIT';
  readonly retryable = false;
  constructor() {
    super('The guarded response exceeded the configured private buffer limit.');
    this.name = 'ProviderGuardrailLimitError';
  }
}

export function interventionErrorOf(
  intervention: ProviderIntervention,
  cause?: unknown,
): ProviderBlockedError | ProviderInterventionUnknownError {
  if (intervention.outcome === 'blocked') return new ProviderBlockedError(intervention, cause);
  if (intervention.outcome === 'unknown')
    return new ProviderInterventionUnknownError(intervention, cause);
  throw new TypeError('A usable masked response is not a terminal intervention.');
}

export function isProviderInterventionError(
  error: unknown,
): error is ProviderBlockedError | ProviderInterventionUnknownError | ProviderGuardrailLimitError {
  return (
    error instanceof ProviderBlockedError ||
    error instanceof ProviderInterventionUnknownError ||
    error instanceof ProviderGuardrailLimitError
  );
}

/** Response data may come from a custom adapter: no accessor is an admitted fact. */
function own(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== 'object') throw new TypeError('Invalid intervention');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError('Invalid intervention');
  return descriptor.value;
}

function bounded(value: unknown, scalars: number, bytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= scalars * 2 &&
    Array.from(value).length <= scalars &&
    new TextEncoder().encode(value).length <= bytes
  );
}

const UNKNOWN: ProviderIntervention = Object.freeze({
  outcome: 'unknown',
  code: 'unrecognized_intervention',
  filters: Object.freeze([]),
});

/**
 * One owned, bounded port projection before tools, output parsing or persistence.
 * A present malformed intervention cannot turn into an ordinary successful response.
 * Reflection can execute Proxy traps; arbitrary injected JavaScript cannot be preempted.
 */
export function providerInterventionOf(response: unknown): ProviderIntervention | undefined {
  try {
    const raw = own(response, 'intervention');
    if (raw === undefined) return undefined;
    const outcome = own(raw, 'outcome');
    const code = own(raw, 'code');
    if (
      (outcome !== 'blocked' && outcome !== 'masked' && outcome !== 'unknown') ||
      !bounded(code, 128, 512)
    )
      return UNKNOWN;
    const input = own(raw, 'filters');
    if (!Array.isArray(input)) return UNKNOWN;
    const length = own(input, 'length');
    if (typeof length !== 'number' || length > 32) return UNKNOWN;
    const filters: { family: string; type?: string }[] = [];
    for (let index = 0; index < length; index++) {
      const filter = own(input, String(index));
      const family = own(filter, 'family');
      const type = own(filter, 'type');
      if (!bounded(family, 128, 512) || (type !== undefined && !bounded(type, 128, 512)))
        return UNKNOWN;
      filters.push(Object.freeze({ family, ...(type !== undefined && { type }) }));
    }
    const message = own(raw, 'message');
    if (message !== undefined && !bounded(message, 1024, 4096)) return UNKNOWN;
    return Object.freeze({
      outcome,
      code,
      filters: Object.freeze(filters),
      ...(message !== undefined && { message }),
    });
  } catch {
    return UNKNOWN;
  }
}

export function isTerminalIntervention(response: unknown): boolean {
  const intervention = providerInterventionOf(response);
  return intervention !== undefined && intervention.outcome !== 'masked';
}
