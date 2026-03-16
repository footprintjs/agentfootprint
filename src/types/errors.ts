/**
 * Normalized error types for LLM provider errors.
 *
 * All adapters wrap SDK-specific errors into LLMError so that
 * compositions (withRetry, withFallback, withCircuitBreaker)
 * can make uniform decisions.
 */

export type LLMErrorCode =
  | 'auth' // Invalid API key or unauthorized
  | 'rate_limit' // Rate limited / throttled
  | 'context_length' // Input too long for model
  | 'invalid_request' // Malformed request
  | 'server' // Provider server error (5xx)
  | 'timeout' // Request timed out
  | 'aborted' // Cancelled via AbortSignal
  | 'network' // Network connectivity issue
  | 'unknown'; // Unclassified

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly provider: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly cause?: Error;

  constructor(opts: {
    message: string;
    code: LLMErrorCode;
    provider: string;
    statusCode?: number;
    cause?: Error;
  }) {
    super(opts.message);
    this.name = 'LLMError';
    this.code = opts.code;
    this.provider = opts.provider;
    this.statusCode = opts.statusCode;
    this.cause = opts.cause;
    this.retryable = isRetryable(opts.code);
  }
}

function isRetryable(code: LLMErrorCode): boolean {
  return code === 'rate_limit' || code === 'server' || code === 'timeout' || code === 'network';
}

/** Classify an HTTP status code into an LLMErrorCode. */
export function classifyStatusCode(status: number): LLMErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 400) return 'invalid_request';
  if (status === 413 || status === 422) return 'context_length';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Wrap an unknown SDK error into an LLMError. */
export function wrapSDKError(err: unknown, provider: string): LLMError {
  if (err instanceof LLMError) return err;

  const error = err instanceof Error ? err : new Error(String(err));
  const message = error.message;

  // AbortError from signal
  if (error.name === 'AbortError' || message.includes('aborted')) {
    return new LLMError({ message, code: 'aborted', provider, cause: error });
  }

  // Timeout
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new LLMError({ message, code: 'timeout', provider, cause: error });
  }

  // Network
  if (
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('fetch failed')
  ) {
    return new LLMError({ message, code: 'network', provider, cause: error });
  }

  // HTTP status code from SDK errors (Anthropic and OpenAI both expose .status)
  const statusCode = (err as { status?: number }).status;
  if (statusCode) {
    return new LLMError({
      message,
      code: classifyStatusCode(statusCode),
      provider,
      statusCode,
      cause: error,
    });
  }

  return new LLMError({ message, code: 'unknown', provider, cause: error });
}
