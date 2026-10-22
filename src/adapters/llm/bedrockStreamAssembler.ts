import type { LLMChunk, LLMResponse } from '../../provider-contract/types.js';
import type { BedrockStreamEvent } from './BedrockProvider.js';
import { readCacheUsage } from './bedrockCacheWire.js';
import { ensureHonestToolUse, normalizeStopReason, parseToolArgs } from './bedrockOutput.js';
import { closePreservingFailure } from '../../lib/preserveFailure.js';

/** Fold the wire only; no SDK, timer or retry policy. Preserve an observed
 * read/parse failure if closing the iterator subsequently also fails. */
export async function* foldBedrockEvents(
  events: AsyncIterable<BedrockStreamEvent>,
): AsyncIterable<LLMChunk> {
  const textParts: string[] = [];
  let stopReason = 'stop';
  let usage: LLMResponse['usage'] = { input: 0, output: 0 };
  let tokenIndex = 0;

  // Tool-use blocks under construction, keyed by `contentBlockIndex`.
  // Keying by index (not arrival order) is what makes PARALLEL tool
  // calls work: Bedrock interleaves their argument fragments.
  const toolUseByIndex = new Map<number, { id: string; name: string; fragments: string[] }>();
  const completedToolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }> = [];

  const iterator = events[Symbol.asyncIterator]();
  let ended = false;
  let failed = false;
  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done) {
        ended = true;
        break;
      }
      const event = step.value;
      // ── Block start: id + name arrive here; arguments follow as
      //    JSON string fragments on deltas at the same index. ──
      const startIndex = event.contentBlockStart?.contentBlockIndex;
      const startToolUse = event.contentBlockStart?.start?.toolUse;
      if (startToolUse && typeof startIndex === 'number') {
        toolUseByIndex.set(startIndex, {
          id: startToolUse.toolUseId ?? '',
          name: startToolUse.name ?? '',
          fragments: [],
        });
      }

      if (event.contentBlockDelta?.delta?.text) {
        const text = event.contentBlockDelta.delta.text;
        textParts.push(text);
        yield { tokenIndex, content: text, done: false };
        tokenIndex++;
      }

      // ── Argument fragment. `LLMChunk` has no tool-delta field, so
      //    these are NOT yielded as chunks (same as both Browser
      //    providers) — they surface on the terminal `response`. ──
      const inputFragment = event.contentBlockDelta?.delta?.toolUse?.input;
      if (typeof inputFragment === 'string') {
        const deltaIndex = event.contentBlockDelta?.contentBlockIndex;
        const open = typeof deltaIndex === 'number' ? toolUseByIndex.get(deltaIndex) : undefined;
        // Bedrock sends `input: ''` fragments for no-arg tools; push
        // them anyway — the join below collapses them to ''.
        if (open) open.fragments.push(inputFragment);
      }

      // ── Block complete: join the fragments and parse. ──
      const stopIndex = event.contentBlockStop?.contentBlockIndex;
      if (typeof stopIndex === 'number') {
        const tu = toolUseByIndex.get(stopIndex);
        if (tu) {
          toolUseByIndex.delete(stopIndex);
          completedToolCalls.push({
            id: tu.id,
            name: tu.name,
            args: parseToolArgs(tu.fragments.join(''), tu.name, tu.id, stopIndex),
          });
        }
      }

      if (event.messageStop?.stopReason) {
        stopReason = normalizeStopReason(event.messageStop.stopReason);
      }
      if (event.metadata?.usage) {
        usage = {
          input: event.metadata.usage.inputTokens,
          output: event.metadata.usage.outputTokens,
          ...readCacheUsage(event.metadata.usage),
        };
      }
    }
    // A block still open here never received its `contentBlockStop` —
    // truncated wire data. Emitting a half-parsed call would run a
    // tool with incomplete arguments, so we drop it and let the
    // honesty invariant below catch the resulting contradiction.
    const finalResponse: LLMResponse = ensureHonestToolUse({
      content: textParts.join(''),
      toolCalls: completedToolCalls,
      usage,
      stopReason,
    });
    yield { tokenIndex, content: '', done: true, response: finalResponse };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) {
      await closePreservingFailure(() => iterator.return?.(), failed);
    }
  }
}
