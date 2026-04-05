/**
 * InstructionsToLLM subflow — evaluates agent-level instructions before the 3 API slots.
 *
 * Runs once per loop iteration (Dynamic pattern) or once before the loop (Regular).
 * Reads the current Decision Scope, evaluates all registered instructions'
 * `activeWhen` predicates, and outputs categorized injections for each slot:
 *
 *   promptInjections → consumed by SystemPrompt slot
 *   toolInjections   → consumed by Tools slot
 *   responseRules    → consumed by tool execution subflow
 *
 * The instruction registry is baked into the subflow via closure at build time.
 * This is a footprintjs flowchart subflow — visible in narrative/BTS.
 *
 * Loop position:
 *   Seed → [InstructionsToLLM] → [SystemPrompt] → [Messages] → [Tools] → ...
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { InstructionsToLLMState } from '../../scope/types';
import type { LLMToolDescription } from '../../types/llm';
import type { AgentInstruction } from './agentInstruction';
import { evaluateAgentInstructions } from './agentInstruction';

/**
 * Build the InstructionsToLLM subflow from a registry of agent-level instructions.
 *
 * The instructions array is captured by closure — immutable after build (shallow freeze).
 * The subflow reads `scope.decision` (from parent inputMapper) and writes
 * the categorized outputs for downstream slots to consume.
 *
 * **Parent state requirements:** The parent chart's `inputMapper` MUST map the
 * `decision` field. If `decision` is missing (undefined), all instructions with
 * `activeWhen` predicates will evaluate against `undefined` — behavioral predicates
 * will throw and be skipped (fail-open), safety predicates will fire (fail-closed).
 *
 * The `outputMapper` should map the 3 output fields back to the parent state:
 * `promptInjections`, `toolInjections`, `responseRules` (and optionally
 * `matchedInstructions` for narrative enrichment).
 *
 * @param instructions - Agent-level instructions registered via `.instruction()`.
 *   Empty array is valid (subflow becomes a no-op pass-through).
 *
 * @example
 * ```typescript
 * const subflow = buildInstructionsToLLMSubflow([refundInstruction, complianceInstruction]);
 *
 * // Mount in agent loop (parent state must include matching fields):
 * builder.addSubFlowChartNext('sf-instructions-to-llm', subflow, 'InstructionsToLLM', {
 *   inputMapper: (parent) => ({ decision: parent.decision }),
 *   outputMapper: (sf) => ({
 *     promptInjections: sf.promptInjections,
 *     toolInjections: sf.toolInjections,
 *     responseRules: sf.responseRules,
 *     matchedInstructions: sf.matchedInstructions,
 *   }),
 * });
 * ```
 */
export function buildInstructionsToLLMSubflow(
  instructions: readonly AgentInstruction[],
): FlowChart {
  // Freeze the instruction list — no mutations after build.
  // Note: shallow freeze — individual instruction objects are readonly-typed
  // but not deeply frozen. This is sufficient since TypeScript enforces readonly.
  const frozenInstructions = Object.freeze([...instructions]);

  return flowChart<InstructionsToLLMState>(
    'EvaluateInstructions',
    (scope: TypedScope<InstructionsToLLMState>) => {
      // Read decision scope from parent. If missing (inputMapper didn't map it),
      // pass through as-is — predicates will see undefined and fail-open/closed
      // according to their safety flag.
      const decision = scope.decision;
      const result = evaluateAgentInstructions(frozenInstructions, decision);

      scope.promptInjections = [...result.promptInjections];
      // Convert ToolDefinition → LLMToolDescription (strip handler for LLM consumption)
      scope.toolInjections = result.toolInjections.map((t): LLMToolDescription => ({
        name: t.id,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      scope.responseRules = [...result.responseRules];

      // Narrative enrichment — which instructions fired and why
      if (result.matchedIds.length > 0) {
        scope.matchedInstructions = `${result.matchedIds.length} matched: ${result.matchedIds.join(', ')}`;
      } else {
        scope.matchedInstructions = 'none matched';
      }
    },
    'evaluate-instructions',
    undefined,
    'Evaluate agent instructions against Decision Scope',
  ).build();
}
