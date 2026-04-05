/**
 * Tool Execution Subflow — executes tool calls as a visible subflow.
 *
 * Replaces inline executeToolCalls() in HandleResponse with a proper subflow
 * that appears in the flowchart and narrative. Enables:
 *   - BTS drill-down into tool execution
 *   - Per-tool visibility in narrative
 *   - Future: parallel fork stages for individual tool calls
 *
 * The subflow has a single stage (ExecuteToolCalls) that runs all tools
 * sequentially and appends results to messages.
 *
 * Config (registry, toolProvider) is closed over at build time — not
 * passed through inputMapper.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { Message } from '../../types';
import type { ToolRegistry } from '../../tools';
import type { ToolProvider } from '../../core';
import type { InstructionConfig } from './helpers';
import type { ParsedResponse } from '../../scope/types';
import { executeToolCalls } from './helpers';

// ── Subflow state ────────────────────────────────────────────

/** State for the tool execution subflow.
 *
 * Uses prefixed input keys (currentMessages, currentLoopCount) to avoid
 * read-only input conflict — subflow inputs from inputMapper are frozen.
 *
 * Output keys:
 * - `toolResultMessages`: DELTA only (new tool result messages), not the full array.
 *   footprintjs's applyOutputMapping uses array concat for arrays, so the parent's
 *   outputMapper maps this to `messages` and the concat correctly appends the delta.
 * - `updatedLoopCount`: incremented loop count (scalar → replaced).
 */
export interface ToolExecutionSubflowState {
  /** Input: parsed response with tool calls (read-only from inputMapper). */
  parsedResponse: ParsedResponse;
  /** Input: current conversation messages (read-only from inputMapper). */
  currentMessages: Message[];
  /** Input: current loop iteration (read-only from inputMapper). */
  currentLoopCount: number;
  /** Input: max iterations allowed (read-only from inputMapper). */
  maxIterations: number;
  /** Output: NEW tool result messages only (delta for array concat). */
  toolResultMessages: Message[];
  /** Output: incremented loop count. */
  updatedLoopCount: number;
  // agentResponseRules removed — functions stripped by scope, now in InstructionConfig closure
  /** Input: current Decision Scope (read-only from inputMapper). */
  currentDecision?: Record<string, unknown>;
  /** Output: updated Decision Scope after decide() mutations. */
  updatedDecision?: Record<string, unknown>;
  /** @internal Set when ask_human tool fires — used for pause detection. */
  askHumanPause?: { question: string; toolCallId: string };
}

// ── Config ───────────────────────────────────────────────────

export interface ToolExecutionSubflowConfig {
  readonly registry: ToolRegistry;
  readonly toolProvider?: ToolProvider;
  /** Instruction processing config — when provided, instructions are evaluated after each tool call. */
  readonly instructionConfig?: InstructionConfig;
}

// ── Builder ──────────────────────────────────────────────────

/**
 * Build the tool execution subflow.
 *
 * Registry and toolProvider are closed over — they don't travel
 * through inputMapper. Only scope state (parsedResponse, messages,
 * loopCount) is mapped.
 */
export function buildToolExecutionSubflow(
  config: ToolExecutionSubflowConfig,
): FlowChart {
  const { registry, toolProvider, instructionConfig } = config;

  const executeStageFn = async (scope: TypedScope<ToolExecutionSubflowState>) => {
    const parsed = scope.parsedResponse;
    const loopCount = scope.currentLoopCount ?? 0;
    const maxIter = scope.maxIterations ?? 10;

    // Defense-in-depth: the RouteResponse decider already routes to 'final'
    // when loopCount >= maxIter, but this guard protects against standalone
    // subflow usage without a preceding decider.
    if (!parsed?.toolCalls?.length || loopCount >= maxIter) {
      scope.toolResultMessages = [];
      scope.updatedLoopCount = loopCount;
      return;
    }

    const messages = scope.currentMessages ?? [];
    // $getEnv() is a TypedScope proxy method — always available, not in state interface
    const signal = scope.$getEnv()?.signal;

    // Copy decision scope for `decide` field mutations.
    // decide() functions mutate the copy in-place; we write it back as updatedDecision.
    // currentDecision may be undefined when initial decision is {} (empty objects
    // are dropped by footprintjs inputMapper). Use {} as fallback when instructions are configured.
    const rawDecision = scope.currentDecision;
    const decisionRef = rawDecision ? { ...rawDecision } : (instructionConfig?.decideFunctions?.size ? {} : undefined);

    const { messages: resultMessages, askHumanPause } = await executeToolCalls(
      parsed.toolCalls,
      registry,
      messages,
      toolProvider,
      signal,
      instructionConfig,
      decisionRef,
    );

    // Output DELTA only — footprintjs applyOutputMapping concatenates arrays,
    // so the parent's outputMapper maps this to `messages` and concat appends correctly.
    scope.toolResultMessages = resultMessages.slice(messages.length);
    scope.updatedLoopCount = (scope.currentLoopCount ?? 0) + 1;

    // Write mutated decision as output so it flows through outputMapper.
    // Always write when decisionRef exists — even if no decide() ran, the
    // decision may need to propagate for the next iteration's InstructionsToLLM.
    if (decisionRef) {
      scope.updatedDecision = decisionRef;
    }

    // If ask_human was called, store pause data on scope and return it.
    // Engine: non-void return from isPausable stage → PauseSignal with this as pauseData.
    if (askHumanPause) {
      scope.askHumanPause = askHumanPause;
      return askHumanPause;
    }
    return undefined;
  };

  const resumeStageFn = (scope: TypedScope<ToolExecutionSubflowState>, humanResponse: unknown): void => {
    const pauseInfo = scope.askHumanPause;
    if (pauseInfo && humanResponse !== undefined) {
      const toolCallId = pauseInfo.toolCallId;
      scope.toolResultMessages = (scope.toolResultMessages ?? []).map((msg: Message) =>
        msg.role === 'tool' && msg.toolCallId === toolCallId
          ? { ...msg, content: String(humanResponse) }
          : msg,
      );
    }
  };

  // Pausable root stage — flowChart() accepts PausableHandler directly (footprintjs v4.4.1+).
  // No post-build graph mutation needed.
  return flowChart<ToolExecutionSubflowState>(
    'ExecuteToolCalls',
    { execute: executeStageFn, resume: resumeStageFn } as any,
    'execute-tool-calls',
    undefined,
    'Execute tool calls and append results to conversation',
  ).build();
}
