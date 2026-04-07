/**
 * previewInstructions — dry-run showing what gets injected for a mock tool result.
 *
 * Invaluable for debugging instruction behavior during development and for
 * generating documentation of tool behavior.
 *
 * @example
 * ```typescript
 * const preview = previewInstructions(
 *   orderTool.instructions,
 *   { content: { status: 'cancelled', trackingId: 'TRK-1' }, toolId: 'check_order' },
 * );
 *
 * console.log(preview);
 * // {
 * //   fired: [{ id: 'empathy', text: '...', safety: false }, ...],
 * //   injectedText: '[INSTRUCTION] Be empathetic...\n\n[AVAILABLE ACTION]...',
 * //   estimatedTokens: 47,
 * //   followUps: [{ toolId: 'track_package', params: { trackingId: 'TRK-1' } }],
 * // }
 * ```
 */

import type { LLMInstruction, InstructionContext, InstructionOverride } from './types';
import type { InstructionTemplate } from './template';
import type { ResolvedInstruction, ResolvedFollowUp } from './evaluator';
import { evaluateInstructions, applyInstructionOverrides } from './evaluator';
import { renderInstructions } from './template';

// ── Types ───────────────────────────────────────────────────

/** Input for previewInstructions — minimal context for evaluation. */
export interface PreviewContext {
  /** Mock tool result content (parsed object or raw string). */
  readonly content: unknown;
  /** Tool ID that produced this result. */
  readonly toolId: string;
  /** Optional error state. */
  readonly error?: { code?: string; message: string };
  /** Optional latency in ms. Default: 0. */
  readonly latencyMs?: number;
  /** Optional original input. Default: {}. */
  readonly input?: Record<string, unknown>;
}

/** Result of previewInstructions — what the LLM would see. */
export interface InstructionPreview {
  /** Instructions that fired (in injection order). */
  readonly fired: ResolvedInstruction[];
  /** The text that would be appended to the tool result message. */
  readonly injectedText: string | undefined;
  /** Rough token estimate (~4 chars per token). */
  readonly estimatedTokens: number;
  /** Follow-ups that were offered (with resolved params). */
  readonly followUps: ResolvedFollowUp[];
  /** IDs of instructions that fired. */
  readonly firedIds: string[];
  /** IDs of instructions that did NOT fire. */
  readonly skippedIds: string[];
}

// ── Preview Function ────────────────────────────────────────

/**
 * Preview which instructions would fire for a given mock tool result.
 *
 * Does NOT run the agent — purely evaluates instructions against the mock context.
 * Use for debugging, testing, and generating tool behavior documentation.
 *
 * @param instructions - The tool's instruction array (or overridden version)
 * @param context - Mock tool result context
 * @param options - Optional: overrides to apply, custom template
 *
 * @example
 * ```typescript
 * // Basic preview
 * const preview = previewInstructions(tool.instructions, {
 *   content: { status: 'denied', traceId: 'tr_1' },
 *   toolId: 'evaluate_loan',
 * });
 *
 * // With overrides applied
 * const preview = previewInstructions(tool.instructions, ctx, {
 *   overrides: { suppress: ['low-priority'] },
 * });
 * ```
 */
export function previewInstructions(
  instructions: readonly LLMInstruction[] | undefined,
  context: PreviewContext,
  options?: {
    overrides?: InstructionOverride;
    template?: InstructionTemplate;
  },
): InstructionPreview {
  // Apply overrides if provided
  let effectiveInstructions = instructions;
  if (options?.overrides && instructions) {
    effectiveInstructions = applyInstructionOverrides(instructions, options.overrides);
  }

  // Build full InstructionContext from preview context
  const ctx: InstructionContext = {
    content: context.content,
    error: context.error,
    latencyMs: context.latencyMs ?? 0,
    input: context.input ?? {},
    toolId: context.toolId,
  };

  // Evaluate
  const fired = evaluateInstructions(effectiveInstructions, ctx);

  // Render
  const injectedText = renderInstructions(fired, options?.template);

  // Extract follow-ups
  const followUps = fired.filter((f) => f.resolvedFollowUp).map((f) => f.resolvedFollowUp!);

  // Compute skipped IDs
  const firedIds = fired.map((f) => f.id);
  const firedSet = new Set(firedIds);
  const allIds = (effectiveInstructions ?? []).map((i) => i.id);
  const skippedIds = allIds.filter((id) => !firedSet.has(id));

  // Rough token estimate
  const estimatedTokens = injectedText ? Math.ceil(injectedText.length / 4) : 0;

  return {
    fired,
    injectedText,
    estimatedTokens,
    followUps,
    firedIds,
    skippedIds,
  };
}
