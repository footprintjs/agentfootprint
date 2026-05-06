/**
 * agentfootprint/thinking — extended-thinking subsystem (v2.14+).
 *
 * **Two-layer architecture:**
 *
 *   • CONSUMER-FACING:    `ThinkingHandler` — simple function-pair
 *                          implemented by provider authors.
 *   • FRAMEWORK-INTERNAL: each handler is auto-wrapped in a real
 *                         footprintjs subflow at chart build time;
 *                         shows in trace as own runtimeStageId.
 *
 * **Auto-wire by provider name:**
 *
 *   ```ts
 *   import { Agent } from 'agentfootprint';
 *
 *   // Library scans SHIPPED_THINKING_HANDLERS, finds the handler
 *   // whose providerNames includes provider.name. Mounted as a
 *   // sub-subflow of sf-call-llm.
 *   const agent = Agent.create({ provider: anthropic({...}), model: '...' })
 *     .build();
 *
 *   // Opt out:
 *   //   .thinkingHandler(undefined)
 *   // Override with a custom handler:
 *   //   .thinkingHandler(myCustomHandler)
 *   ```
 *
 * **Custom handlers:**
 *
 *   ```ts
 *   import { type ThinkingHandler } from 'agentfootprint/thinking';
 *
 *   export const geminiThinkingHandler: ThinkingHandler = {
 *     id: 'gemini',
 *     providerNames: ['gemini'],
 *     normalize(raw) { ... },
 *     parseChunk(chunk) { ... },  // optional
 *   };
 *   ```
 *
 * Failure isolation: handler `normalize()` throws are caught by the
 * framework — emit `agentfootprint.agent.thinking_parse_failed`, drop
 * the blocks, continue. Same graceful pattern as v2.11.6
 * `tools.discovery_failed`.
 */

export type { ThinkingBlock, ThinkingHandler } from './types.js';

export { mockThinkingHandler, mockAnthropicRaw, mockOpenAIRaw } from './MockThinkingHandler.js';

export { SHIPPED_THINKING_HANDLERS, findThinkingHandler } from './registry.js';
