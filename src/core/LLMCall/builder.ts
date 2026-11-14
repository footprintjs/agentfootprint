import { LLMCall } from '../LLMCall.js';
import type { LLMCallOptions } from './types.js';

/**
 * Tiny fluent builder. Validates required fields at build() time.
 */
export class LLMCallBuilder {
  private readonly opts: LLMCallOptions;
  private systemPromptValue = '';
  /** Whether `.system()` has been called — see the refusal below for why the
   *  flag exists separately from the value. */
  private systemPromptSet = false;

  constructor(opts: LLMCallOptions) {
    this.opts = opts;
  }

  /**
   * Set the system prompt. Once per call — a second `.system()` used to
   * REPLACE the first in silence, so the instructions written first were
   * never sent and nothing said so. Join the parts yourself and pass one
   * string.
   */
  system(prompt: string): this {
    if (this.systemPromptSet) {
      throw new Error(
        'LLMCallBuilder.system: already set. An LLMCall has one system prompt — a second call ' +
          'used to REPLACE the first silently, so the instructions you wrote first were never ' +
          'sent. Join the parts into one string and pass it once. (An Agent has richer options ' +
          'here: .steering(...) for a second always-on block, .configure(...) for a per-run ' +
          'prompt.)',
      );
    }
    this.systemPromptSet = true;
    this.systemPromptValue = prompt;
    return this;
  }

  build(): LLMCall {
    return new LLMCall(this.opts, this.systemPromptValue);
  }
}
