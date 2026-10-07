/**
 * The thinking handler a provider DECLARES, and the list the library ships.
 *
 * Pattern: capability declaration, like `promptCaching`. The provider adapter
 *          knows the shape its wire's thinking arrives in, so it declares the
 *          handler that normalizes it (`LLMProvider.thinkingHandler`); the
 *          agent uses that declaration. It used to scan this list for a
 *          handler whose `providerNames` held `provider.name`, so every
 *          renaming wrapper (`withRetry` → `anthropic+retry`, an app's
 *          routing wrapper) silently lost thinking — and with it the signed
 *          blocks Anthropic needs echoed back after a tool call.
 *
 * `SHIPPED_THINKING_HANDLERS` is the list the shared contract test
 * (`test/thinking/cross-cutting.test.ts`) holds every shipped handler to;
 * `thinkingHandlerFor` (its own module, so the agent pulls in no handler it
 * does not use) reads the declaration.
 */

import { anthropicThinkingHandler } from './AnthropicThinkingHandler.js';
import { mockThinkingHandler } from './MockThinkingHandler.js';
import { ollamaThinkingHandler } from './OllamaThinkingHandler.js';
import { openAIThinkingHandler } from './OpenAIThinkingHandler.js';
import type { ThinkingHandler } from './types.js';

/**
 * All thinking handlers shipped with the library. Append in alphabetical
 * order (by `id`) so diffs stay readable as new handlers land.
 */
export const SHIPPED_THINKING_HANDLERS: readonly ThinkingHandler[] = [
  anthropicThinkingHandler,
  mockThinkingHandler,
  ollamaThinkingHandler,
  openAIThinkingHandler,
];
