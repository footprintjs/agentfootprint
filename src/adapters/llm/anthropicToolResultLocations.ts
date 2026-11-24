import type { LLMMessage } from '../../provider-contract/types.js';
import type { AnthropicMessageParam, AnthropicToolResultBlock } from './anthropicMessagesWire.js';

interface AnthropicToolResultLocation {
  readonly source: LLMMessage;
  readonly messageIndex: number;
  readonly blockIndex: number;
  readonly blockNumber: number;
  readonly body: string;
}

/** Read the exact emitted tool-result blocks in final wire order. Each visited
 * message and content block consumes one scan unit. An incomplete or ambiguous
 * scan yields no evidence. A missing block cannot be recovered by ID or text. */
export function findAnthropicToolResultLocations(
  messages: readonly AnthropicMessageParam[],
  sourceByBlock: ReadonlyMap<AnthropicToolResultBlock, LLMMessage>,
  scanLimit: number,
): readonly AnthropicToolResultLocation[] | undefined {
  if (!Number.isSafeInteger(scanLimit) || scanLimit < 0) return undefined;
  if (sourceByBlock.size === 0) return [];
  const seen = new Set<AnthropicToolResultBlock>();
  const locations: AnthropicToolResultLocation[] = [];
  let remaining = scanLimit;
  let blockNumber = 0;
  for (const [messageIndex, message] of messages.entries()) {
    if (remaining-- === 0) return undefined;
    if (typeof message.content === 'string') continue;
    for (const [blockIndex, block] of message.content.entries()) {
      if (remaining-- === 0) return undefined;
      if (block.type !== 'tool_result') continue;
      blockNumber += 1;
      const source = sourceByBlock.get(block);
      if (source === undefined) continue;
      if (seen.has(block)) return undefined;
      seen.add(block);
      locations.push({ source, messageIndex, blockIndex, blockNumber, body: block.content });
    }
  }
  return locations;
}
