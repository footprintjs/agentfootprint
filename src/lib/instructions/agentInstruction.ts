/**
 * Agent-level Instruction type — conditional context injection across all 3 LLM API positions.
 *
 * Unlike tool-level `LLMInstruction` (fires on a specific tool result),
 * an `AgentInstruction` fires based on accumulated Decision Scope state
 * and can inject into system prompt, tools, AND tool response rules.
 *
 * Evaluated by the InstructionsToLLM subflow BEFORE the 3 API slots.
 *
 * Naming:
 *   `activeWhen` (agent-level, reads decision scope) vs
 *   `when` (tool-level, reads tool result context) — no collision.
 */

import type { ToolDefinition } from '../../types/tools';
import type { LLMInstruction } from './types';

const isDevMode = () => typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production';

// ── Agent Instruction ──────────────────────────────────────────────────

/**
 * An instruction that spans all 3 LLM API input positions.
 *
 * Evaluated per iteration by the InstructionsToLLM subflow. When `activeWhen`
 * matches the current Decision Scope, the instruction's outputs are injected
 * into the corresponding API slot.
 *
 * @example
 * ```typescript
 * const refundInstruction: AgentInstruction<MyDecision> = {
 *   id: 'refund-handling',
 *   activeWhen: (d) => d.orderStatus === 'denied',
 *   prompt: 'Handle denied orders with empathy. Follow refund policy.',
 *   tools: [processRefund, getTrace],
 *   onToolResult: [
 *     { id: 'empathy', text: 'Be empathetic. Do NOT promise reversal.' },
 *   ],
 * };
 * ```
 */
export interface AgentInstruction<TDecision = unknown> {
  /** Unique instruction identifier. */
  readonly id: string;

  /** Human-readable description (for narrative, docs, debug). */
  readonly description?: string;

  /**
   * Condition: when does this instruction activate?
   * Receives `scope.decision` — the bounded decision scope, not the full agent state.
   * Omit for unconditional (always active).
   *
   * Must be synchronous and side-effect-free.
   * Predicates that throw are skipped (fail-open) unless `safety: true` (fail-closed).
   */
  readonly activeWhen?: (decision: TDecision) => boolean;

  /**
   * Position 1: Text merged into system prompt.
   * Appended after the base prompt from PromptProvider.
   */
  readonly prompt?: string;

  /**
   * Position 2: Tools added to the tools list.
   * Merged with the base tools from ToolProvider. Deduplicated by ID.
   */
  readonly tools?: readonly ToolDefinition[];

  /**
   * Position 3: Rules evaluated against tool results (in recency window).
   * Reuses the existing LLMInstruction type — `when`, `text`, `followUp`, `safety`.
   * These fire during tool execution, same as tool-level instructions.
   *
   * Note: Rules from multiple matched instructions are accumulated (not deduplicated
   * by ID). If you need unique rules, use unique IDs per AgentInstruction.
   */
  readonly onToolResult?: readonly LLMInstruction[];

  /**
   * Priority for ordering when multiple instructions match.
   * Lower = higher priority. Ties broken by registration order.
   *
   * Safety instructions are always sorted LAST regardless of priority,
   * mirroring the tool-level `LLMInstruction` ordering convention.
   * @default 0
   */
  readonly priority?: number;

  /**
   * Controls predicate evaluation behavior when `activeWhen` throws.
   *
   * - `false` (default): fail-open — broken predicate skips the instruction.
   * - `true`: fail-closed — broken predicate fires the instruction.
   *
   * Safety instructions are also sorted LAST in the output (highest priority
   * position for system prompt injection). This is the predicate-level safety
   * flag; for Position 3 injection ordering, use `LLMInstruction.safety`
   * on individual `onToolResult` rules.
   *
   * @default false
   */
  readonly safety?: boolean;
}

// ── Evaluation Result ──────────────────────────────────────────────────

/** Output of evaluating agent instructions against the decision scope. */
export interface InstructionEvaluationResult {
  /** Prompt text fragments to merge into system prompt (Position 1). */
  readonly promptInjections: readonly string[];
  /** Tool definitions to merge into tools list (Position 2). */
  readonly toolInjections: readonly ToolDefinition[];
  /** Tool-result rules to evaluate during tool execution (Position 3). */
  readonly responseRules: readonly LLMInstruction[];
  /** IDs of instructions that matched (for narrative/recorder). */
  readonly matchedIds: readonly string[];
}

// ── Evaluator ──────────────────────────────────────────────────────────

/**
 * Check if an instruction has at least one output (prompt, tools, or onToolResult).
 */
function hasOutputs<T>(instr: AgentInstruction<T>): boolean {
  return !!(instr.prompt || (instr.tools && instr.tools.length > 0) || (instr.onToolResult && instr.onToolResult.length > 0));
}

/**
 * Evaluate agent-level instructions against the current decision scope.
 *
 * Returns categorized outputs for each of the 3 LLM API positions.
 * Instructions are sorted by priority (lower = first), with safety
 * instructions always sorted LAST (matching tool-level convention).
 *
 * Error handling follows the same pattern as tool-level instructions:
 *   - Behavioral (safety: false): predicate throws → skip (fail-open)
 *   - Safety (safety: true): predicate throws → fire (fail-closed)
 *
 * @example
 * ```typescript
 * const result = evaluateAgentInstructions(instructions, { orderStatus: 'denied' });
 * // result.promptInjections → ['Handle denied orders with empathy.']
 * // result.toolInjections → [processRefund, getTrace]
 * // result.responseRules → [{ id: 'empathy', text: '...' }]
 * // result.matchedIds → ['refund-handling']
 * ```
 */
export function evaluateAgentInstructions<TDecision>(
  instructions: readonly AgentInstruction<TDecision>[] | undefined,
  decision: TDecision,
): InstructionEvaluationResult {
  const empty: InstructionEvaluationResult = {
    promptInjections: [],
    toolInjections: [],
    responseRules: [],
    matchedIds: [],
  };

  if (!instructions || instructions.length === 0) return empty;

  // Sort by priority, safety instructions LAST (matching tool-level convention).
  // Stable sort preserves registration order for ties.
  const sorted = [...instructions].sort((a, b) => {
    const aSafety = a.safety ?? false;
    const bSafety = b.safety ?? false;
    if (aSafety !== bSafety) return aSafety ? 1 : -1;
    return (a.priority ?? 0) - (b.priority ?? 0);
  });

  const promptInjections: string[] = [];
  const toolInjections: ToolDefinition[] = [];
  const responseRules: LLMInstruction[] = [];
  const matchedIds: string[] = [];
  const seenToolIds = new Set<string>();

  for (const instr of sorted) {
    // Evaluate predicate
    if (instr.activeWhen) {
      try {
        if (!instr.activeWhen(decision)) continue;
      } catch {
        if (instr.safety) {
          // Safety: fail-closed — fire when predicate errors
        } else {
          // Behavioral: fail-open — skip broken predicate
          continue;
        }
      }
    }

    // P0 review fix: warn in dev mode when safety instruction has no outputs
    if (instr.safety && !hasOutputs(instr)) {
      if (isDevMode()) {
        console.warn(
          `[agentfootprint] Safety instruction '${instr.id}' matched but has no outputs (prompt, tools, or onToolResult). ` +
          `It will appear in matchedIds but inject nothing.`,
        );
      }
    }

    matchedIds.push(instr.id);

    if (instr.prompt) {
      promptInjections.push(instr.prompt);
    }

    if (instr.tools) {
      for (const tool of instr.tools) {
        // Deduplicate by tool ID — first registration wins
        if (!seenToolIds.has(tool.id)) {
          seenToolIds.add(tool.id);
          toolInjections.push(tool);
        }
      }
    }

    if (instr.onToolResult) {
      responseRules.push(...instr.onToolResult);
    }
  }

  return { promptInjections, toolInjections, responseRules, matchedIds };
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Create a validated agent-level instruction.
 *
 * This is the preferred way to create instructions — validates the `id` field
 * at build time and provides good TypeScript inference for the decision type.
 *
 * @example
 * ```typescript
 * interface MyDecision {
 *   orderStatus: 'pending' | 'denied' | null;
 *   riskLevel: 'low' | 'high';
 * }
 *
 * const refund = defineInstruction<MyDecision>({
 *   id: 'refund-handling',
 *   activeWhen: (d) => d.orderStatus === 'denied',
 *   prompt: 'Handle denied orders with empathy.',
 *   tools: [processRefund, getTrace],
 *   onToolResult: [
 *     { id: 'empathy', text: 'Do NOT promise reversal.' },
 *   ],
 * });
 * ```
 */
export function defineInstruction<TDecision = unknown>(
  config: AgentInstruction<TDecision>,
): AgentInstruction<TDecision> {
  if (!config.id) {
    throw new Error('defineInstruction: id is required');
  }
  return config;
}
