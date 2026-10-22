import { abortableIterable } from '../../lib/abort.js';
import { waitDeadline, type WaitDeadline } from '../../lib/waitDeadline.js';
import { ProviderTimeoutError, type ProviderTimeoutWait } from '../../provider-contract/timeout.js';
import type { BedrockStreamEvent } from './BedrockProvider.js';

/** The adapter chooses allowances; the shared leaf owns timers/cancellation. */
export function bedrockDeadline(
  timeoutMs: number | undefined,
  firstEventTimeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  afterOutput: () => boolean,
): WaitDeadline<ProviderTimeoutWait> {
  return waitDeadline<ProviderTimeoutWait>(
    firstEventTimeoutMs === timeoutMs
      ? timeoutMs
      : (phase) =>
          phase === 'response' || phase === 'first-event' ? firstEventTimeoutMs : timeoutMs,
    signal,
    (waitingFor, milliseconds) =>
      new ProviderTimeoutError({
        provider: 'bedrock',
        waitingFor,
        timeoutMs: milliseconds,
        afterOutput: afterOutput(),
      }),
  );
}

/** One SDK send under its allowance. Never start/advance an abandoned stream:
 * the SDK's abortSignal owns its socket; a new generator's return cannot close it. */
export async function sendBedrock<T>(
  send: () => Promise<unknown>,
  deadline: WaitDeadline<ProviderTimeoutWait>,
  wrapError: (error: unknown, signal?: AbortSignal) => Error,
  waitingFor: ProviderTimeoutWait = 'response',
): Promise<T> {
  try {
    return await deadline.within(send() as Promise<T>, waitingFor);
  } catch (error) {
    throw wrapError(error, deadline.signal);
  }
}

/** Each real read/close is bounded. Observe generated output before yielding
 * it to the assembler: tool-only output must not license a paid replay. */
export function timedBedrockEvents(
  source: AsyncIterable<BedrockStreamEvent>,
  deadline: WaitDeadline<ProviderTimeoutWait>,
  wrapError: (error: unknown, signal?: AbortSignal) => Error,
  onOutput: () => void,
): AsyncIterable<BedrockStreamEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<BedrockStreamEvent> {
      const iterator = abortableIterable(source, deadline.signal)[Symbol.asyncIterator]();
      let first = true;
      return {
        async next() {
          try {
            const result = await deadline.within(iterator.next(), first ? 'first-event' : 'chunk');
            if (!result.done) {
              first = false;
              const event = result.value;
              if (
                event.contentBlockStart?.start?.toolUse ||
                (event.contentBlockDelta?.delta &&
                  Object.keys(event.contentBlockDelta.delta).length > 0) ||
                (event.metadata?.usage?.outputTokens ?? 0) > 0
              )
                onOutput();
            }
            return result;
          } catch (error) {
            throw wrapError(error, deadline.signal);
          }
        },
        async return(value?: unknown) {
          try {
            return await deadline.within(
              Promise.resolve(
                iterator.return?.(value) ?? { done: true, value: value as BedrockStreamEvent },
              ),
              'close',
            );
          } catch (error) {
            throw wrapError(error, deadline.signal);
          }
        },
      };
    },
  };
}
