/**
 * Instruction injection — appends rendered instructions to tool result content.
 *
 * This is the bridge between the evaluator (which resolves instructions)
 * and the tool result message (which the LLM reads). The injected text
 * lands in the recency window — the last tokens before LLM generation.
 *
 * The function is intentionally simple: evaluate → render → append.
 * Side effects (recording, logging) are handled by callers.
 */

import type { LLMInstruction, InstructionContext, RuntimeFollowUp } from './types';
import type { InstructionTemplate } from './template';
import type { ResolvedInstruction } from './evaluator';
import { evaluateInstructions, mergeRuntimeInstructions } from './evaluator';
import { renderInstructions } from './template';

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Result of processing instructions for a tool result.
 */
export interface InstructionInjectionResult {
  /** The original content with instructions appended (or unchanged if none fired). */
  readonly content: string;
  /** All resolved instructions that fired (for recording/tracking). */
  readonly fired: ResolvedInstruction[];
  /** Whether any instructions were injected. */
  readonly injected: boolean;
}

/**
 * Process instructions for a tool result and return augmented content.
 *
 * Full pipeline: evaluate predicates → merge runtime → render → append.
 *
 * @param originalContent - The tool result content string
 * @param buildTimeInstructions - Instructions from tool definition
 * @param ctx - Full execution context (content, error, latency, input, toolId)
 * @param runtime - Runtime instructions/followUps from handler return
 * @param template - Optional custom template for formatting
 *
 * @example
 * ```typescript
 * const result = processInstructions(
 *   toolResult.content,
 *   tool.instructions,
 *   { content: parsed, error: undefined, latencyMs: 42, input, toolId: tool.id },
 *   toolResult.instructions ? { instructions: toolResult.instructions } : undefined,
 * );
 *
 * // result.content has instructions appended
 * // result.fired lists which instructions matched
 * // result.injected is true if any text was added
 * ```
 */
export function processInstructions(
  originalContent: string,
  buildTimeInstructions: readonly LLMInstruction[] | undefined,
  ctx: InstructionContext,
  runtime?: {
    instructions?: readonly string[];
    followUps?: readonly RuntimeFollowUp[];
  },
  template?: InstructionTemplate,
): InstructionInjectionResult {
  // 1. Evaluate build-time instructions
  const buildTime = evaluateInstructions(buildTimeInstructions, ctx);

  // 2. Merge with runtime instructions
  const all = mergeRuntimeInstructions(buildTime, runtime);

  if (all.length === 0) {
    return { content: originalContent, fired: [], injected: false };
  }

  // 3. Render to text
  const text = renderInstructions(all, template);

  if (!text) {
    return { content: originalContent, fired: all, injected: false };
  }

  // 4. Append to tool result content
  const augmented = originalContent + '\n\n' + text;
  return { content: augmented, fired: all, injected: true };
}
