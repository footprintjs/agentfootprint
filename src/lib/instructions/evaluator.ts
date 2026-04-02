/**
 * Instruction evaluator — matches instructions against tool results.
 *
 * Evaluates `when` predicates, sorts by priority, and orders for injection:
 *   1. Follow-up bindings (structured actions)
 *   2. Behavioral instructions (free text guidance)
 *   3. Safety instructions LAST (closest to LLM generation = highest attention)
 *
 * Predicates that throw are skipped with a warning (fail-open for behavioral,
 * fail-closed for safety). This is the defensive behavior — a broken predicate
 * should not prevent the agent from working, but safety instructions should
 * fail-closed (fire when in doubt).
 */

import type { LLMInstruction, InstructionContext, RuntimeFollowUp } from './types';

// ── Evaluation Result ───────────────────────────────────────────────────

/** A resolved instruction — ready for injection into the recency window. */
export interface ResolvedInstruction {
  /** Instruction ID (for recording/tracking). */
  readonly id: string;
  /** Behavioral text to inject (if any). */
  readonly inject?: string;
  /** Resolved follow-up with concrete params (if any). */
  readonly resolvedFollowUp?: ResolvedFollowUp;
  /** Whether this is a safety instruction. */
  readonly safety: boolean;
  /** Original priority value. */
  readonly priority: number;
}

/** Follow-up binding with params already resolved from the tool result. */
export interface ResolvedFollowUp {
  readonly toolId: string;
  readonly params: Record<string, unknown>;
  readonly description: string;
  readonly condition: string;
  readonly strict: boolean;
}

// ── Evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate build-time instructions against a tool result context.
 *
 * Returns resolved instructions sorted for injection:
 *   1. Non-safety with follow-up only (structured actions first)
 *   2. Non-safety with inject (behavioral guidance)
 *   3. Safety instructions (LAST = highest attention weight)
 *
 * Within each group, sorted by priority (lower = first), then array order.
 *
 * @example
 * ```typescript
 * const fired = evaluateInstructions(tool.instructions, {
 *   content: { status: 'denied', traceId: 'tr_8f3a' },
 *   error: undefined,
 *   latencyMs: 42,
 *   input: { applicantId: 'a-1' },
 *   toolId: 'evaluate_loan',
 * });
 *
 * // fired: [{ id: 'denial-empathy', inject: '...', resolvedFollowUp: {...} }]
 * ```
 */
export function evaluateInstructions(
  instructions: readonly LLMInstruction[] | undefined,
  ctx: InstructionContext,
): ResolvedInstruction[] {
  if (!instructions || instructions.length === 0) return [];

  const matched: ResolvedInstruction[] = [];

  for (const instr of instructions) {
    // Evaluate predicate — skip on throw for behavioral, fire on throw for safety
    if (instr.when) {
      try {
        if (!instr.when(ctx)) continue; // predicate returned false
      } catch {
        if (instr.safety) {
          // Safety: fail-closed — fire the instruction when predicate errors
          // Better to inject a safety instruction unnecessarily than to miss it
        } else {
          // Behavioral: fail-open — skip broken predicate
          continue;
        }
      }
    }
    // No `when` = unconditional — always fires

    // Resolve follow-up params if present
    let resolvedFollowUp: ResolvedFollowUp | undefined;
    if (instr.followUp) {
      try {
        const params = instr.followUp.params(ctx);
        resolvedFollowUp = {
          toolId: instr.followUp.toolId,
          params,
          description: instr.followUp.description,
          condition: instr.followUp.condition,
          strict: instr.followUp.strict ?? false,
        };
      } catch {
        // If params resolution fails, skip the follow-up but keep the inject
        resolvedFollowUp = undefined;
      }
    }

    matched.push({
      id: instr.id,
      inject: instr.inject,
      resolvedFollowUp,
      safety: instr.safety ?? false,
      priority: instr.priority ?? 0,
    });
  }

  // Sort for injection order:
  // 1. Non-safety sorted by priority (lower first), then array order (stable sort)
  // 2. Safety instructions at the end (closest to generation = highest attention)
  return matched.sort((a, b) => {
    // Safety always after non-safety
    if (a.safety !== b.safety) return a.safety ? 1 : -1;
    // Within same safety group, sort by priority
    return a.priority - b.priority;
  });
}

/**
 * Merge build-time resolved instructions with runtime instructions/followUps.
 *
 * Runtime instructions (from handler return) are appended after build-time
 * behavioral instructions but before safety instructions.
 *
 * @example
 * ```typescript
 * const buildTime = evaluateInstructions(tool.instructions, ctx);
 * const runtime = {
 *   instructions: ['Service degraded. Set expectations.'],
 *   followUps: [{ toolId: 'status_page', params: {}, description: '...', condition: '...' }],
 * };
 * const merged = mergeRuntimeInstructions(buildTime, runtime);
 * ```
 */
export function mergeRuntimeInstructions(
  buildTime: ResolvedInstruction[],
  runtime?: {
    instructions?: readonly string[];
    followUps?: readonly RuntimeFollowUp[];
  },
): ResolvedInstruction[] {
  if (!runtime) return buildTime;

  const runtimeResolved: ResolvedInstruction[] = [];

  // Runtime follow-ups
  if (runtime.followUps) {
    for (const fu of runtime.followUps) {
      if (!fu.toolId || !fu.params) continue; // validate required fields
      runtimeResolved.push({
        id: `runtime-followup-${fu.toolId}`,
        resolvedFollowUp: {
          toolId: fu.toolId,
          params: fu.params,
          description: fu.description,
          condition: fu.condition,
          strict: fu.strict ?? false,
        },
        safety: false,
        priority: 0,
      });
    }
  }

  // Runtime behavioral instructions
  if (runtime.instructions) {
    for (let i = 0; i < runtime.instructions.length; i++) {
      runtimeResolved.push({
        id: `runtime-inject-${i}`,
        inject: runtime.instructions[i],
        safety: false,
        priority: 0,
      });
    }
  }

  // Merge: build-time non-safety → runtime → build-time safety
  const nonSafety = buildTime.filter((r) => !r.safety);
  const safety = buildTime.filter((r) => r.safety);
  return [...nonSafety, ...runtimeResolved, ...safety];
}
