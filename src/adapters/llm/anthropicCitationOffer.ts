import {
  observesCitationOffers,
  prepareCitationOffer,
} from '../../provider-contract/requestObserver.js';
import type { LLMCallHooks, LLMMessage, LLMRequest } from '../../provider-contract/types.js';
import type { AnthropicToolResultObserver } from './anthropicMessageProjection.js';
import type { AnthropicMessagesBody, AnthropicToolResultBlock } from './anthropicMessagesWire.js';
import { findAnthropicToolResultLocations } from './anthropicToolResultLocations.js';

const MAX_WIRE_SCAN = 4096;

interface CitationProjection {
  readonly observeToolResult: AnthropicToolResultObserver;
  prepare(body: AnthropicMessagesBody): ReturnType<typeof prepareCitationOffer>;
}

/** The SDK path can attest exactly which tool-result blocks it submits. Keep
 * offer text out of requests that hold or can acquire a signed replay prefix:
 * changing the system prompt would invalidate that prefix on the next call. */
export function anthropicCitationProjection(
  request: LLMRequest,
  hooks: LLMCallHooks | undefined,
): CitationProjection | undefined {
  if (
    !observesCitationOffers(hooks) ||
    request.thinking ||
    request.messages.length > MAX_WIRE_SCAN ||
    request.messages.some(
      (message) => message.role === 'assistant' && (message.thinkingBlocks?.length ?? 0) > 0,
    )
  )
    return undefined;

  const sources = new Map<AnthropicToolResultBlock, LLMMessage>();
  return {
    observeToolResult(source, block) {
      if (sources.size < MAX_WIRE_SCAN) sources.set(block, source);
    },
    prepare(body) {
      if (body.thinking !== undefined) return undefined;
      const locations = findAnthropicToolResultLocations(body.messages, sources, MAX_WIRE_SCAN);
      if (locations === undefined || locations.length === 0) return undefined;
      const offer = prepareCitationOffer(
        hooks,
        locations.map(({ source, body, blockNumber }) => ({ source, body, blockNumber })),
      );
      if (offer === undefined) return undefined;

      // The existing cache-marked system block remains byte-identical.
      const instruction = { type: 'text' as const, text: offer.instruction };
      const { system } = body;
      body.system =
        typeof system === 'string'
          ? [{ type: 'text', text: system }, instruction]
          : [...(system ?? []), instruction];
      return offer;
    },
  };
}
