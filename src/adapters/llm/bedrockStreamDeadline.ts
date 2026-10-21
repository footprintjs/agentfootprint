import { abortableIterable } from '../../lib/abort.js';
import type { WaitDeadline } from '../../lib/waitDeadline.js';

/** The wait that exceeded a Bedrock stream's configured cap. */
export type BedrockStreamWait = 'response' | 'chunk' | 'close' | 'fallback';

/**
 * An opted-in Bedrock stream made no progress within timeoutMs.
 * `withRetry` retries only before its first public chunk; a later timeout
 * must surface rather than replaying text the caller may have displayed.
 * Contains no request, credentials, model identifier or transport error.
 */
export class BedrockStreamTimeoutError extends Error {
  override readonly name = 'BedrockStreamTimeoutError';
  /** Stable discriminator for callers and stored error evidence. */
  readonly code = 'BEDROCK_STREAM_TIMEOUT';
  /** A retry advisory; never permission to replay already delivered chunks. */
  readonly retryable = true;

  constructor(
    /** Which provider wait stopped making progress. */
    readonly phase: BedrockStreamWait,
    /** The configured cap for this wait, in milliseconds. */
    readonly timeoutMs: number,
  ) {
    super(`[bedrock] no progress within ${timeoutMs} ms while waiting for stream ${phase}.`);
  }
}

/** Race each actual read/close, never the time the caller holds a chunk. */
export function timedBedrockEvents<T>(
  source: AsyncIterable<T>,
  deadline: WaitDeadline<BedrockStreamWait>,
): AsyncIterable<T> {
  const watched = abortableIterable(source, deadline.signal);
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = watched[Symbol.asyncIterator]();
      return {
        next: () => deadline.within(iterator.next(), 'chunk'),
        return: (value?: unknown) =>
          deadline.within(
            Promise.resolve(iterator.return?.(value) ?? { done: true, value: value as T }),
            'close',
          ),
      };
    },
  };
}

/**
 * A transport that ignored abort may hand back a stream after its request
 * was abandoned. Request cleanup without reading it or awaiting its close.
 */
export function closeLateBedrockStream(response: { stream?: AsyncIterable<unknown> }): void {
  try {
    const result = response.stream?.[Symbol.asyncIterator]().return?.();
    Promise.resolve(result).catch(() => undefined);
  } catch {
    // Best effort: the timeout/cancellation is already the caller's result.
  }
}
