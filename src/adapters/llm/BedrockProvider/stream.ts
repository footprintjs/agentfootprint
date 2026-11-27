/** Unconfigured streaming preserves live deltas and admits the actual terminal disposition. */
import type { LLMChunk, LLMRequest, LLMResponse } from '../../../provider-contract/types.js';
import { abortableIterable } from '../../../lib/abort.js';
import { readCacheUsage } from '../bedrockCacheWire.js';
import { ensureHonestToolUse, normalizeStopReason, parseToolArgs } from './response.js';
import { wrapError } from './client.js';
import { classifyGuardrail } from './guardrailClassify.js';
import { terminalGuardrailResponse } from './guardrailResponse.js';
import type { BedrockStreamEvent } from './types.js';

export async function* streamBedrock(
  stream: AsyncIterable<BedrockStreamEvent>,
  req: LLMRequest,
): AsyncIterable<LLMChunk> {
  const textParts: string[] = [];
  let stopReason = 'stop';
  let originalStopReason: string | undefined;
  let usage: LLMResponse['usage'] = { input: 0, output: 0 };
  let tokenIndex = 0;

  // Tool-use blocks under construction, keyed by `contentBlockIndex`.
  // Keying by index (not arrival order) is what makes PARALLEL tool
  // calls work: Bedrock interleaves their argument fragments.
  const toolUseByIndex = new Map<number, { id: string; name: string; fragments: string[] }>();
  const completedBlocks: Array<{
    id: string;
    name: string;
    fragments: string[];
    index: number;
  }> = [];

  try {
    // An abort ends this loop at once, even when a read is still pending,
    // and closes the event stream (lib/abort.ts, laws 2–3).
    for await (const event of abortableIterable(stream, req.signal)) {
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

      // Keep completed arguments private until the actual terminal stop is
      // known. An intrinsic intervention must precede even malformed parsing.
      const stopIndex = event.contentBlockStop?.contentBlockIndex;
      if (typeof stopIndex === 'number') {
        const tu = toolUseByIndex.get(stopIndex);
        if (tu) {
          toolUseByIndex.delete(stopIndex);
          completedBlocks.push({ ...tu, index: stopIndex });
        }
      }

      if (event.messageStop?.stopReason) {
        originalStopReason = event.messageStop.stopReason;
        stopReason = normalizeStopReason(originalStopReason);
      }
      if (event.metadata?.usage) {
        usage = {
          input: event.metadata.usage.inputTokens,
          output: event.metadata.usage.outputTokens,
          ...readCacheUsage(event.metadata.usage),
        };
      }
    }

    const intervention = classifyGuardrail({ stopReason: originalStopReason }, undefined);
    if (intervention !== undefined) {
      // Live unconfigured prefixes cannot be recalled. The terminal result
      // still withholds content/tools and cannot become a final-memory write.
      yield {
        tokenIndex,
        content: '',
        done: true,
        response: terminalGuardrailResponse(intervention, usage),
      };
      return;
    }

    // A block still open here never received its `contentBlockStop` —
    // truncated wire data. Emitting a half-parsed call would run a
    // tool with incomplete arguments, so we drop it and let the
    // honesty invariant below catch the resulting contradiction.
    const finalResponse: LLMResponse = ensureHonestToolUse({
      content: textParts.join(''),
      toolCalls: completedBlocks.map(({ id, name, fragments, index }) => ({
        id,
        name,
        args: parseToolArgs(fragments.join(''), name, id, index),
      })),
      usage,
      stopReason,
    });
    yield { tokenIndex, content: '', done: true, response: finalResponse };
  } catch (err) {
    throw wrapError(err, req.signal);
  }
}
