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
import type { AgentStreamEvent } from '../../streaming';
import { STREAM_EMIT_PREFIX } from '../../streaming';
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
  /**
   * When true, multiple tool calls within a single turn run concurrently via Promise.all.
   * Results are appended to the conversation in the order the LLM requested them.
   * Default: false (sequential).
   */
  readonly parallel?: boolean;
  /**
   * Consecutive-identical-failure threshold for repeated-failure escalation.
   * Forwarded to `executeToolCalls`. Passing `0` (or any non-positive number)
   * disables escalation entirely. Defaults to the library default when omitted.
   */
  readonly maxIdenticalFailures?: number;
}

// ── Builder ──────────────────────────────────────────────────

/**
 * Build the tool execution subflow.
 *
 * Registry and toolProvider are closed over — they don't travel
 * through inputMapper. Only scope state (parsedResponse, messages,
 * loopCount) is mapped.
 */
export function buildToolExecutionSubflow(config: ToolExecutionSubflowConfig): FlowChart {
  const { registry, toolProvider, instructionConfig, parallel, maxIdenticalFailures } = config;

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

    // Copy decision scope for tool-driven mutations.
    // Two mutation paths feed into this ref:
    //   1. `decide()` inside tool flowcharts — mutates the ref in-place
    //   2. `ToolResult.decisionUpdate` — shallow-merged by executeToolCalls
    // Always allocate `{}` when the scope arrives without a decision so
    // autoActivate-style decision writes land on the first turn too
    // (footprintjs inputMapper drops empty-object decisions; without an
    // allocation here, a skill's `read_skill` decisionUpdate would be
    // dropped on the first iteration — surfaced by the 1.17.0 test
    // `autoActivate — scenario: end-to-end: read_skill flips decision`).
    const rawDecision = scope.currentDecision;
    const decisionRef: Record<string, unknown> = rawDecision ? { ...rawDecision } : {};

    // `helpers.executeToolCalls` takes an `onStreamEvent` callback in its
    // instruction config for `tool_start` / `tool_end` lifecycle events.
    // We construct that callback as a thin scope-emit wrapper so events
    // flow through the same emit channel as everything else — zero
    // closure capture of per-run handlers. `StreamEventRecorder`
    // (attached by AgentRunner) consumes them and forwards to `onEvent`.
    const emitAsScope = (event: AgentStreamEvent): void => {
      scope.$emit(`${STREAM_EMIT_PREFIX}${event.type}`, event);
    };
    const effectiveInstructionConfig: InstructionConfig | undefined = instructionConfig
      ? { ...instructionConfig, onStreamEvent: emitAsScope }
      : {
          instructionsByToolId: new Map(),
          onStreamEvent: emitAsScope,
        };

    const { messages: resultMessages, askHumanPause } = await executeToolCalls(
      parsed.toolCalls,
      registry,
      messages,
      toolProvider,
      signal,
      effectiveInstructionConfig,
      decisionRef,
      {
        ...(parallel ? { parallel: true } : {}),
        ...(maxIdenticalFailures !== undefined ? { maxIdenticalFailures } : {}),
      },
    );

    // Output DELTA only — footprintjs applyOutputMapping concatenates arrays,
    // so the parent's outputMapper maps this to `messages` and concat appends correctly.
    scope.toolResultMessages = resultMessages.slice(messages.length);
    scope.updatedLoopCount = (scope.currentLoopCount ?? 0) + 1;

    // Write mutated decision as output so it flows through outputMapper.
    // Always writes — even if no decide() and no decisionUpdate ran, the
    // decision may need to propagate for the next iteration's InstructionsToLLM.
    scope.updatedDecision = decisionRef;

    // If ask_human was called, store pause data on scope and return it.
    // Engine: non-void return from isPausable stage → PauseSignal with this as pauseData.
    if (askHumanPause) {
      scope.askHumanPause = askHumanPause;
      return askHumanPause;
    }
    return undefined;
  };

  const resumeStageFn = (
    scope: TypedScope<ToolExecutionSubflowState>,
    humanResponse: unknown,
  ): void => {
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
  // Cast needed: executeStageFn has wider return type (includes pause data object)
  // than PausableHandler.execute's generic — this is the standard pattern for stages
  // that conditionally return pause data.
  const handler = {
    execute: executeStageFn as (scope: TypedScope<ToolExecutionSubflowState>) => Promise<void>,
    resume: resumeStageFn,
  };

  return flowChart<ToolExecutionSubflowState>(
    'ExecuteToolCalls',
    handler,
    'execute-tool-calls',
    undefined,
    'Execute tool calls and append results to conversation',
  ).build();
}
