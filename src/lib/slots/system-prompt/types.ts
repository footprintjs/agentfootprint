/**
 * SystemPrompt slot types.
 *
 * The SystemPrompt slot resolves the system prompt string before each LLM call.
 * It is always mounted as a subflow — even for a static string, the subflow
 * has one stage. Config determines what stages go inside.
 */

import type { PromptProvider } from '../../../core';

/**
 * Config for the SystemPrompt slot subflow.
 * Passed to buildSystemPromptSubflow() to create the subflow.
 */
export interface SystemPromptSlotConfig {
  /** The prompt provider strategy (static, template, composite, skill-based, etc.). */
  readonly provider: PromptProvider;
}
