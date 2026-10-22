import { abortableIterable } from '../../lib/abort.js';
import { type WaitDeadline } from '../../lib/waitDeadline.js';
import { type ProviderTimeoutWait } from '../../provider-contract/timeout.js';
import type { BedrockStreamEvent } from './bedrockWireTypes.js';
import { isBedrockOutputEvent } from './bedrockOutput.js';

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
  afterOutput: () => boolean,
  onOutput: () => void,
): AsyncIterable<BedrockStreamEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<BedrockStreamEvent> {
      const iterator = abortableIterable(source, deadline.signal)[Symbol.asyncIterator]();
      return {
        async next() {
          try {
            const result = await deadline.within(
              iterator.next(),
              afterOutput() ? 'chunk' : 'first-output',
            );
            if (!result.done) {
              if (isBedrockOutputEvent(result.value)) onOutput();
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
