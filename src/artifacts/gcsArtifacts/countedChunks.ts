import { InvalidArtifactError } from '../types.js';

/**
 * Yield a web stream's chunks while COUNTING them against the declared
 * length, so a producer that lied about its own payload fails with this
 * library's sentence rather than as a truncated upload.
 */
export async function* countedChunks(
  body: ReadableStream<Uint8Array>,
  declared: number,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > declared) {
        await reader.cancel();
        throw new InvalidArtifactError(
          `gcsArtifacts: the streamed payload is longer than the ${declared} bytes it ` +
            `declared. The upload was cut off rather than completed under a meta that ` +
            `describes a different payload. State the exact byte length.`,
        );
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== declared) {
    throw new InvalidArtifactError(
      `gcsArtifacts: the streamed payload ended after ${total} bytes but declared ${declared}. ` +
        `The upload fails rather than storing a ticket that misdescribes its own payload.`,
    );
  }
}
