import type { LLMMessage } from '../../../../provider-contract/types.js';
import { FINDINGS_DATA_FRAME_PREFIX } from '../../../../lib/saidByPerson.js';
import { toolBytesOf } from '../../../../lib/toolBytes.js';
import { isRecoveryFeedback } from './requestOnly.js';

/**
 * The frame's non-assistant messages as GROUNDS for the unsupported-argument
 * seam — each tool result read as the TOOL's own bytes (`lib/toolBytes.ts` ·
 * `toolBytesOf`), so a value only the inputs layer's note carries ("the call
 * ran with "production", the value the tool's rule assumes") grounds nothing:
 * library-authored text is never evidence for a value (honesty law 4).
 *
 * The frame is the wire copy, which has lost the boundary field
 * (`composeRequest.ts` · `stripFrameworkFields` removes it and keeps every
 * message, in order), so the cut is read off the COMMITTED twin at the same
 * index — and applied only while the frame still holds that twin's text byte
 * for byte. A result the findings collapse turned into a ticket, or a cache
 * strategy rewrote, is read as it was sent; the staged-refs nudge after the
 * last committed message has no twin and is read as sent.
 */
export function groundedTextOf(
  frame: readonly LLMMessage[],
  committed: readonly LLMMessage[],
  historyPositions?: readonly (number | undefined)[],
): string[] {
  const grounds: string[] = [];
  frame.forEach((message, i) => {
    if (
      message.role === 'assistant' ||
      isRecoveryFeedback(message) ||
      (message.role === 'user' && message.content.startsWith(FINDINGS_DATA_FRAME_PREFIX))
    )
      return;
    const historyIndex =
      historyPositions !== undefined && i < historyPositions.length ? historyPositions[i] : i;
    if (historyIndex === undefined) return;
    const twin = committed[historyIndex];
    grounds.push(
      twin !== undefined && twin.role === 'tool' && twin.content === message.content
        ? toolBytesOf(twin)
        : message.content,
    );
  });
  return grounds;
}
