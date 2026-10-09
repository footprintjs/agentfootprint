/**
 * thinking — extended-thinking subsystem (v2.14+).
 *
 * **Two-layer architecture:**
 *
 *   • CONSUMER-FACING:    `ThinkingHandler` — simple function-pair
 *                          implemented by provider authors.
 *   • FRAMEWORK-INTERNAL: each handler is auto-wrapped in a real
 *                         footprintjs subflow at chart build time;
 *                         shows in trace as own runtimeStageId.
 *
 * **Declared by the provider:**
 *
 *   ```ts
 *   import { Agent } from 'agentfootprint';
 *
 *   // anthropic() declares `thinkingHandler: anthropicThinkingHandler`;
 *   // the agent mounts it as a sub-subflow of sf-call-llm. A wrapper that
 *   // forwards the field (withRetry, withFallback, your own) keeps it.
 *   const agent = Agent.create({ provider: anthropic({...}), model: '...' })
 *     .build();
 *
 *   // Opt out:
 *   //   .thinkingHandler(null)
 *   // Override with a custom handler:
 *   //   .thinkingHandler(myCustomHandler)
 *   ```
 *
 * **Custom handlers:**
 *
 *   ```ts
 *   import { type ThinkingHandler } from 'agentfootprint/providers';
 *
 *   export const geminiThinkingHandler: ThinkingHandler = {
 *     id: 'gemini',
 *     normalize(raw) { ... },
 *     parseChunk(chunk) { ... },  // optional
 *   };
 *   // …declared by the adapter: { name: 'gemini', thinkingHandler: geminiThinkingHandler, … }
 *   ```
 *
 * Failure isolation: handler `normalize()` throws are caught by the
 * framework — emit `agentfootprint.agent.thinking_parse_failed`, drop
 * the blocks, continue. Same graceful pattern as v2.11.6
 * `tools.discovery_failed`.
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/providers`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

export type { ThinkingBlock, ThinkingHandler, ThinkingMode } from './types.js';

export { UnsupportedThinkingError } from './errors.js';

export { mockThinkingHandler, mockAnthropicRaw, mockOpenAIRaw } from './MockThinkingHandler.js';

export { anthropicThinkingHandler } from './AnthropicThinkingHandler.js';

export { openAIThinkingHandler } from './OpenAIThinkingHandler.js';

export {
  ollamaThinkingHandler,
  extractInlineThinking,
  type OllamaRawThinking,
} from './OllamaThinkingHandler.js';

export { SHIPPED_THINKING_HANDLERS } from './registry.js';
export { thinkingHandlerFor } from './thinkingHandlerFor.js';
