/**
 * Call module types.
 *
 * The call module contains the three stages that happen AFTER the three API slots:
 *   CallLLM → ParseResponse → HandleResponse
 *
 * These stages consume what the slots wrote to scope and produce the LLM result.
 */

import type { LLMProvider } from '../../types';

/**
 * Config for CallLLM stage.
 */
export interface CallLLMConfig {
  /** The LLM provider to call (Anthropic, OpenAI, mock, etc.). */
  readonly provider: LLMProvider;
}
