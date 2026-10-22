/** The provider wait that stopped making progress. Not a whole-run budget. */
const TIMEOUT_WAITS = [
  'credentials',
  'response',
  'first-output',
  'chunk',
  'body',
  'close',
  'fallback',
] as const;
/** The named allowance that expired, shared by every timeout adapter. */
export type ProviderTimeoutWait = (typeof TIMEOUT_WAITS)[number];

/** Shared discriminator for live adapter errors and retry reports. JSON storage may discard Error fields; this guard does not establish saved evidence. */
export const ERR_PROVIDER_TIMEOUT = 'ERR_PROVIDER_TIMEOUT' as const;

/**
 * A provider wait exceeded the host's explicit limit. afterOutput includes
 * generated tool arguments/thinking, even when no public chunk was delivered.
 * Opaque complete/fallback waits refuse automatic replay. A streamed pre-output
 * retry is only an advisory: a timed-out request may still have
 * consumed input tokens. Missing usage and remote settlement remain unknown.
 */
export class ProviderTimeoutError extends Error {
  override readonly name: string = 'ProviderTimeoutError';
  readonly code = ERR_PROVIDER_TIMEOUT;
  /** The adapter, never the model or a request identifier. */
  readonly provider: string;
  /** The wait whose allowance expired. */
  readonly waitingFor: ProviderTimeoutWait;
  /** The host-selected cap on that wait, in milliseconds. */
  readonly timeoutMs: number;
  /** Output has started, including tool blocks not yet exposed as text. */
  readonly afterOutput: boolean;
  /** False after output starts or when an opaque answer cannot be observed.
   * True before visible output is not a zero-cost guarantee. */
  readonly retryable: boolean;

  constructor(details: {
    provider: string;
    waitingFor: ProviderTimeoutWait;
    timeoutMs: number;
    afterOutput: boolean;
    /** An opaque whole-answer wait can refuse retry even before output is visible. */
    retryable?: boolean;
  }) {
    super(
      details.waitingFor === 'credentials'
        ? 'The API key lookup exceeded its configured wait limit. No provider request was sent.'
        : 'The provider wait exceeded its configured limit. Output and remote settlement remain unknown.',
    );
    this.provider = details.provider;
    this.waitingFor = details.waitingFor;
    this.timeoutMs = details.timeoutMs;
    this.afterOutput = details.afterOutput;
    this.retryable = !details.afterOutput && details.retryable !== false;
  }
}

/** Recognizes the shared contract, including an adapter error composing it.
 * Own data fields only: examining an unknown error never invokes its getters. */
export function isProviderTimeout(error: unknown): error is ProviderTimeoutError {
  try {
    if (typeof error !== 'object' || error === null) return false;
    const field = (key: string): unknown => Object.getOwnPropertyDescriptor(error, key)?.value;
    const wait = field('waitingFor');
    const milliseconds = field('timeoutMs');
    return (
      typeof field('name') === 'string' &&
      typeof field('message') === 'string' &&
      field('code') === ERR_PROVIDER_TIMEOUT &&
      typeof field('provider') === 'string' &&
      (TIMEOUT_WAITS as readonly unknown[]).includes(wait) &&
      typeof milliseconds === 'number' &&
      Number.isFinite(milliseconds) &&
      milliseconds > 0 &&
      typeof field('afterOutput') === 'boolean' &&
      typeof field('retryable') === 'boolean' &&
      !(field('afterOutput') === true && field('retryable') === true)
    );
  } catch {
    return false;
  }
}
