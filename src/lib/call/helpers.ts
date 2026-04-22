/**
 * Shared helpers for call module stages.
 */

import type { LLMResponse, AdapterResult, ToolCall, Message } from '../../types';
import { toolResultMessage } from '../../types';
import type { ToolRegistry } from '../../tools';
import { isAskHumanResult } from '../../tools/askHuman';
import { validateToolInput, formatValidationErrors } from '../../tools/validateInput';
import type { ToolProvider } from '../../core';
import type {
  LLMInstruction,
  InstructionContext,
  RuntimeFollowUp,
  InstructionTemplate,
} from '../instructions';
import type { ResolvedInstruction } from '../instructions';
import { processInstructions } from '../instructions';
import type { AgentStreamEventHandler } from '../../streaming';

// ── Repeated-failure escalation ──────────────────────────────────────────────
//
// When the LLM gets stuck calling a tool with the exact same (name, args) that
// keeps failing, some models loop until `maxIterations` is hit. To escape that
// trap, we inject a one-shot escalation message into the tool result content
// telling the LLM to change its approach. The escalation fires exactly once
// per (name, args) key — further identical failures are left alone, so we
// don't bloat tokens with repeated hectoring.
//
// Detection uses strict JSON parsing (not substring sniffing) so that a tool
// legitimately returning prose containing `"error":true` is not misclassified.

/**
 * Default threshold for escalating repeated-identical-failure feedback.
 * Override per-agent with `AgentBuilder.maxIdenticalFailures(n)`; pass `0` to
 * disable escalation entirely.
 */
export const REPEATED_FAILURE_ESCALATION_THRESHOLD = 3;

/**
 * Stable JSON.stringify — keys sorted at every object level — so two calls
 * with the same logical arguments but different key insertion order are
 * treated as identical. Only handles plain JSON values (strings, numbers,
 * booleans, nulls, arrays, plain objects), which matches the JSON-Schema
 * shape of tool arguments.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * True iff the given message is a tool result that we wrote as an error — i.e.
 * a top-level JSON object with `error === true`. Strict JSON parse: no
 * substring sniffing, so tool content containing the literal phrase
 * `"error":true` but not as a top-level field is not misclassified.
 */
function isErrorToolMessage(m: Message): boolean {
  if (m.role !== 'tool') return false;
  const content = typeof m.content === 'string' ? m.content : '';
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>).error === true
    );
  } catch {
    return false;
  }
}

/**
 * Count prior tool-result messages in `messages` that match the given
 * (toolName, argsJson) key AND represent an error.
 *
 * Cost: O(M × K) worst-case where M is messages.length and K is the average
 * number of tool calls per assistant message. In practice K ≈ 1–3.
 */
function scanPriorFailures(
  messages: readonly Message[],
  toolName: string,
  argsJson: string,
): { failures: number } {
  let failures = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'tool') continue;
    if (!isErrorToolMessage(m)) continue;
    const toolCallId = m.toolCallId;

    // Find the originating assistant tool call (nearest preceding assistant
    // message that declares a tool call with this result's toolCallId).
    let matchedCall: ToolCall | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const prev = messages[j];
      if (prev.role === 'assistant' && prev.toolCalls) {
        matchedCall = prev.toolCalls.find((tc) => tc.id === toolCallId);
        if (matchedCall) break;
      }
    }
    if (!matchedCall) continue;
    if (matchedCall.name !== toolName) continue;
    if (stableStringify(matchedCall.arguments ?? {}) !== argsJson) continue;
    failures++;
  }
  return { failures };
}

/**
 * If the current call is a real error AND the (toolName, args) key has failed
 * a multiple of `threshold` times (i.e. on the threshold-th, 2×threshold-th,
 * 3×threshold-th … identical failure), inject an `escalation` field into
 * the JSON result content.
 *
 * ## Why periodic, not one-shot
 *
 * A single escalation message early in the loop is easy for an LLM to skim
 * past — especially when multiple parallel tool calls fail in the same
 * turn. Firing periodically (every Nth identical failure) keeps nudging
 * the LLM to change strategy while bounding token bloat to at most
 * `maxIterations / threshold` escalations per key.
 *
 * Returns the possibly-enriched content. Pure — does not mutate inputs.
 *
 * Guarantees:
 *   - No false positives from substring matching (strict JSON parse).
 *   - Fires at every `N × threshold`-th failure, never between.
 *   - Stable under argument key reordering (uses `stableStringify`).
 *   - No-op when `threshold <= 0` (user-disabled).
 *   - No-op when `didError` is false OR content is non-JSON.
 */
export function enrichIfRepeatedFailure(
  resultContent: string,
  toolCall: ToolCall,
  priorMessages: readonly Message[],
  options: { didError: boolean; threshold: number },
): string {
  const { didError, threshold } = options;
  if (!didError) return resultContent;
  if (!Number.isFinite(threshold) || threshold <= 0) return resultContent;

  // Must be well-formed JSON we can extend. If it isn't, we still could wrap
  // it — but that changes public tool-result shape unexpectedly, so skip.
  const trimmed = resultContent.trim();
  if (!trimmed.startsWith('{')) return resultContent;
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(trimmed) as unknown;
    if (typeof raw !== 'object' || raw === null) return resultContent;
    parsed = raw as Record<string, unknown>;
  } catch {
    return resultContent;
  }

  const argsJson = stableStringify(toolCall.arguments ?? {});
  const { failures } = scanPriorFailures(priorMessages, toolCall.name, argsJson);
  const total = failures + 1;

  // Fire on every Nth multiple of `threshold` — total in {threshold,
  // 2*threshold, 3*threshold, ...}. Below threshold, or between multiples,
  // return the bare error content. The LLM gets a fresh escalation nudge
  // periodically without flooding the context.
  if (total < threshold) return resultContent;
  if (total % threshold !== 0) return resultContent;

  parsed.repeatedFailures = total;
  parsed.escalation =
    `STOP — this call to '${toolCall.name}' with these EXACT arguments has now failed ${total} times in a row. ` +
    `Retrying with the same arguments will fail again. You MUST change course: ` +
    `(1) call '${toolCall.name}' with DIFFERENT arguments (see expectedSchema above), ` +
    `(2) use a different tool, or ` +
    `(3) stop calling tools and reply with a plain text final answer.`;
  return JSON.stringify(parsed);
}

/**
 * Normalize an LLMResponse into an AdapterResult discriminated union.
 */
export function normalizeAdapterResponse(response: LLMResponse): AdapterResult {
  if (response.toolCalls && response.toolCalls.length > 0) {
    return {
      type: 'tools',
      content: response.content ?? '',
      toolCalls: response.toolCalls,
      usage: response.usage,
      model: response.model,
    };
  }
  return {
    type: 'final',
    content: response.content,
    usage: response.usage,
    model: response.model,
  };
}

/**
 * Optional instruction processing config for executeToolCalls.
 * When provided, instructions are evaluated after each tool call
 * and injected into the tool result message content.
 */
/** Function that mutates the Decision Scope after a tool result. */
export type DecideFn = (decision: Record<string, unknown>, ctx: InstructionContext) => void;

export interface InstructionConfig {
  /** Build-time instructions keyed by tool ID. */
  readonly instructionsByToolId: Map<string, readonly LLMInstruction[]>;
  /** Optional custom template for formatting. */
  readonly template?: InstructionTemplate;
  /** Callback when instructions fire (for InstructionRecorder). */
  readonly onInstructionsFired?: (toolId: string, fired: ResolvedInstruction[]) => void;
  /**
   * decide() functions keyed by instruction rule ID.
   * Built at loop construction time from AgentInstruction.onToolResult rules + per-tool instructions.
   * Functions can't travel through scope (stripped on write), so they're captured by closure.
   */
  readonly decideFunctions?: ReadonlyMap<string, DecideFn>;
  /**
   * Agent-level response rules captured at build time.
   * These are the onToolResult rules from matched AgentInstructions.
   * Captured by closure because functions (`when`, `decide`, `followUp.params`)
   * are stripped when values pass through footprintjs scope.
   */
  readonly agentResponseRules?: readonly LLMInstruction[];
  /** Stream event handler for tool lifecycle events (tool_start, tool_end). */
  readonly onStreamEvent?: AgentStreamEventHandler;
}

/**
 * Execute tool calls and append results to conversation messages.
 *
 * Tries ToolProvider.execute() first (for remote tools like MCP/A2A),
 * falls back to ToolRegistry.get().handler (for local ToolDefinitions).
 *
 * When `instructionConfig` is provided, evaluates LLM instructions after
 * each tool call and appends matched instruction text to the tool result
 * message — landing in the LLM's recency window.
 */
/** Result of executeToolCalls — messages + optional ask_human pause info. */
export interface ToolCallsResult {
  messages: Message[];
  /** When set, one of the tools was ask_human — pause with this data. */
  askHumanPause?: { question: string; toolCallId: string };
}

export async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  messages: Message[],
  toolProvider?: ToolProvider,
  signal?: AbortSignal,
  instructionConfig?: InstructionConfig,
  decision?: Record<string, unknown>,
  options?: { parallel?: boolean; maxIdenticalFailures?: number },
): Promise<ToolCallsResult> {
  // Single copy upfront — O(M+N) instead of O(M*N) from repeated spreads
  const result = [...messages];
  let askHumanPause: ToolCallsResult['askHumanPause'];

  const onStreamEvent = instructionConfig?.onStreamEvent;
  const escalationThreshold =
    options?.maxIdenticalFailures ?? REPEATED_FAILURE_ESCALATION_THRESHOLD;

  // Parallel mode: run per-tool work concurrently, collect tool result messages in
  // original order, surface the first ask_human pause (if any). Decide() mutations
  // to the shared `decision` object are NOT serialized — parallel tools should not
  // rely on strict decide ordering. Sequential mode (default) preserves prior semantics.
  //
  // Escalation caveat: prior-failure scanning runs against `result` at the moment
  // each enrichment call is made, which in parallel mode means earlier tool calls
  // in the same batch (by LLM order, not wall-clock order) count as "prior" for
  // later ones. That's acceptable — what matters for the LLM's next turn is the
  // aggregate signal that identical calls keep failing, not the fine-grained
  // concurrency semantics inside one batch.
  if (options?.parallel && toolCalls.length > 1) {
    type PerTool = {
      resultMessage: Message;
      didError: boolean;
      askHumanMarker?: ToolCallsResult['askHumanPause'];
    };
    const perTool = await Promise.all(
      toolCalls.map(
        (toolCall): Promise<PerTool> =>
          executeOneToolCall(
            toolCall,
            registry,
            toolProvider,
            signal,
            instructionConfig,
            decision,
            onStreamEvent,
          ),
      ),
    );
    for (let i = 0; i < perTool.length; i++) {
      const { resultMessage, askHumanMarker, didError } = perTool[i];
      const originalContent =
        typeof resultMessage.content === 'string' ? resultMessage.content : '';
      const enriched = enrichIfRepeatedFailure(originalContent, toolCalls[i], result, {
        didError,
        threshold: escalationThreshold,
      });
      result.push(
        enriched === originalContent ? resultMessage : { ...resultMessage, content: enriched },
      );
      if (!askHumanPause && askHumanMarker) askHumanPause = askHumanMarker;
    }
    return { messages: result, askHumanPause };
  }

  for (const toolCall of toolCalls) {
    let resultContent = '';
    let runtimeInstructions: readonly string[] | undefined;
    let runtimeFollowUps: readonly RuntimeFollowUp[] | undefined;
    let errorInfo: { code?: string; message: string } | undefined;
    const startMs = Date.now();

    onStreamEvent?.({
      type: 'tool_start',
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      args: (toolCall.arguments ?? {}) as Record<string, unknown>,
    });

    // Try ToolProvider.execute() first (handles remote tools, gated tools, etc.)
    // Skip ToolProvider for ask_human — it must run locally (uses Symbol marker for pause detection).
    // If the provider reports the tool as unknown but the local registry has it,
    // fall through to the registry path — this lets callers use a narrow
    // resolve-time provider (e.g. staticTools([listSkills,readSkill])) while
    // still dispatching every tool the agent registered during `.skills()`.
    let handledByProvider = false;
    if (toolProvider?.execute && toolCall.name !== 'ask_human') {
      try {
        const execResult = await toolProvider.execute(toolCall, signal);
        const providerSawUnknown =
          execResult.error === true &&
          typeof execResult.content === 'string' &&
          execResult.content.startsWith('Unknown tool:') &&
          registry.get(toolCall.name) !== undefined;
        if (!providerSawUnknown) {
          resultContent = execResult.content;
          // Apply optional decision-scope update surfaced by the inner tool.
          // Shallow-merge into the shared `decision` ref so the next
          // iteration's InstructionsToLLM sees the new state. See
          // `ToolResult.decisionUpdate` + `ToolExecutionResult.decisionUpdate`.
          if (decision && execResult.decisionUpdate) {
            Object.assign(decision, execResult.decisionUpdate);
          }
          handledByProvider = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorInfo = { message: msg };
        resultContent = JSON.stringify({ error: true, message: msg });
        handledByProvider = true;
      }
    }
    if (!handledByProvider) {
      // Fall back to ToolRegistry (local ToolDefinition handlers)
      const tool = registry.get(toolCall.name);
      if (!tool) {
        // Sanitize tool name to prevent injection into error messages fed back to LLM
        const safeName = String(toolCall.name)
          .slice(0, 100)
          .replace(/[\n\r]/g, '');
        errorInfo = { code: 'NOT_FOUND', message: `Tool '${safeName}' not found` };
        resultContent = JSON.stringify({ error: true, message: errorInfo.message });
      } else {
        // Validate input against tool's inputSchema before calling handler
        const toolArgs = (toolCall.arguments ?? {}) as Record<string, unknown>;
        if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
          const validation = validateToolInput(toolArgs, tool.inputSchema);
          if (!validation.valid) {
            errorInfo = {
              code: 'INVALID_INPUT',
              message: `Invalid arguments for '${tool.id}': ${formatValidationErrors(
                validation.errors,
              )}`,
            };
            // Include the expected schema so the LLM has a concrete structural
            // target to conform to on retry — addresses the most common cause
            // of LLMs looping on validation errors (they can't see the schema
            // from the error message alone).
            resultContent = JSON.stringify({
              error: true,
              message: errorInfo.message,
              expectedSchema: tool.inputSchema,
              receivedArguments: toolArgs,
            });
            // Repeated-failure escalation also applies to invalid-input failures —
            // that's the primary symptom this catches. Fall through to the normal
            // emit/push path (no early `continue`) so enrichment runs.
            result.push(
              toolResultMessage(
                enrichIfRepeatedFailure(resultContent, toolCall, result, {
                  didError: true,
                  threshold: escalationThreshold,
                }),
                toolCall.id,
              ),
            );
            continue;
          }
        }

        try {
          const execResult = await tool.handler(toolArgs);
          resultContent = execResult.content;
          // Check for ask_human pause marker
          if (isAskHumanResult(execResult)) {
            askHumanPause = { question: execResult.question, toolCallId: toolCall.id };
          }
          // Apply optional decision-scope update surfaced by the tool.
          // See `ToolResult.decisionUpdate` for the full contract.
          if (decision && execResult.decisionUpdate) {
            Object.assign(decision, execResult.decisionUpdate);
          }
          // Check for InstructedToolResult (runtime instructions/followUps)
          const instructed = execResult as {
            instructions?: readonly string[];
            followUps?: readonly RuntimeFollowUp[];
          };
          runtimeInstructions = instructed.instructions;
          runtimeFollowUps = instructed.followUps;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errorInfo = { message: msg };
          resultContent = JSON.stringify({ error: true, message: msg });
        }
      }
    }

    // Capture tool execution latency BEFORE instruction processing overhead
    const toolExecLatencyMs = Date.now() - startMs;
    const latencyMs = toolExecLatencyMs;

    // Process instructions if config provided (build-time, agent-level, or runtime)
    if (instructionConfig) {
      const perToolInstructions = instructionConfig.instructionsByToolId.get(toolCall.name);
      const agentRules = instructionConfig.agentResponseRules;
      // Merge agent-level response rules (captured by closure) with per-tool instructions
      const buildTimeInstructions = agentRules?.length
        ? [...agentRules, ...(perToolInstructions ?? [])]
        : perToolInstructions;
      const hasInstructions =
        buildTimeInstructions?.length || runtimeInstructions?.length || runtimeFollowUps?.length;

      if (hasInstructions) {
        // Parse content for InstructionContext — try JSON, fall back to raw string
        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(resultContent);
        } catch {
          parsedContent = resultContent;
        }

        const ctx: InstructionContext = {
          content: parsedContent,
          error: errorInfo,
          latencyMs,
          input: toolCall.arguments,
          toolId: toolCall.name,
        };

        const injectionResult = processInstructions(
          resultContent,
          buildTimeInstructions,
          ctx,
          runtimeInstructions || runtimeFollowUps
            ? { instructions: runtimeInstructions, followUps: runtimeFollowUps }
            : undefined,
          instructionConfig?.template,
        );

        if (injectionResult.injected) {
          resultContent = injectionResult.content;
        }

        if (injectionResult.fired.length > 0 && instructionConfig?.onInstructionsFired) {
          instructionConfig.onInstructionsFired(toolCall.name, injectionResult.fired);
        }

        // Run decide() functions for matched instructions — updates Decision Scope.
        // decide functions are in the closure map (not in scope — functions stripped on scope write).
        if (decision && instructionConfig?.decideFunctions?.size) {
          for (const fired of injectionResult.fired) {
            const decideFn = instructionConfig.decideFunctions.get(fired.id);
            if (decideFn) {
              try {
                decideFn(decision, ctx);
              } catch {
                // decide errors are fail-open — don't crash tool execution
              }
            }
          }
        }
      }
    }

    // Enrich repeated identical failures with escalation text BEFORE emitting
    // tool_end and pushing the message — so both the stream consumer and the
    // LLM's next turn see the stronger feedback. Driven by the explicit
    // `didError` signal (not substring sniffing of the result content), so
    // tool handlers that legitimately include the phrase "error":true in their
    // content are not misclassified.
    resultContent = enrichIfRepeatedFailure(resultContent, toolCall, result, {
      didError: errorInfo !== undefined,
      threshold: escalationThreshold,
    });

    onStreamEvent?.({
      type: 'tool_end',
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      result: resultContent,
      error: !!errorInfo,
      latencyMs: toolExecLatencyMs,
    });

    result.push(toolResultMessage(resultContent, toolCall.id));
  }

  return { messages: result, askHumanPause };
}

/**
 * Execute a single tool call and return its result message + optional pause marker.
 * Pure in the sense of side-effect-on-messages — does not mutate any shared array.
 * DOES mutate `decision` via decide() functions when instructions fire (shared by design).
 *
 * Used by executeToolCalls in parallel mode so multiple tool calls can run concurrently
 * while the caller appends results in toolCall order.
 */
async function executeOneToolCall(
  toolCall: ToolCall,
  registry: ToolRegistry,
  toolProvider: ToolProvider | undefined,
  signal: AbortSignal | undefined,
  instructionConfig: InstructionConfig | undefined,
  decision: Record<string, unknown> | undefined,
  onStreamEvent: AgentStreamEventHandler | undefined,
): Promise<{
  resultMessage: Message;
  didError: boolean;
  askHumanMarker?: { question: string; toolCallId: string };
}> {
  let resultContent = '';
  let runtimeInstructions: readonly string[] | undefined;
  let runtimeFollowUps: readonly RuntimeFollowUp[] | undefined;
  let errorInfo: { code?: string; message: string } | undefined;
  let askHumanMarker: { question: string; toolCallId: string } | undefined;
  const startMs = Date.now();

  onStreamEvent?.({
    type: 'tool_start',
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    args: (toolCall.arguments ?? {}) as Record<string, unknown>,
  });

  // Try ToolProvider.execute() first (handles remote tools, gated tools, etc.)
  // Skip ToolProvider for ask_human — it must run locally (uses Symbol marker for pause detection).
  // Matches the sequential path: if the provider reports the tool as unknown
  // but the local registry has it, fall through to the registry handler.
  let handledByProvider = false;
  if (toolProvider?.execute && toolCall.name !== 'ask_human') {
    try {
      const execResult = await toolProvider.execute(toolCall, signal);
      const providerSawUnknown =
        execResult.error === true &&
        typeof execResult.content === 'string' &&
        execResult.content.startsWith('Unknown tool:') &&
        registry.get(toolCall.name) !== undefined;
      if (!providerSawUnknown) {
        resultContent = execResult.content;
        if (decision && execResult.decisionUpdate) {
          Object.assign(decision, execResult.decisionUpdate);
        }
        handledByProvider = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorInfo = { message: msg };
      resultContent = JSON.stringify({ error: true, message: msg });
      handledByProvider = true;
    }
  }
  if (!handledByProvider) {
    const tool = registry.get(toolCall.name);
    if (!tool) {
      const safeName = String(toolCall.name)
        .slice(0, 100)
        .replace(/[\n\r]/g, '');
      errorInfo = { code: 'NOT_FOUND', message: `Tool '${safeName}' not found` };
      resultContent = JSON.stringify({ error: true, message: errorInfo.message });
    } else {
      const toolArgs = (toolCall.arguments ?? {}) as Record<string, unknown>;
      if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
        const validation = validateToolInput(toolArgs, tool.inputSchema);
        if (!validation.valid) {
          errorInfo = {
            code: 'INVALID_INPUT',
            message: `Invalid arguments for '${tool.id}': ${formatValidationErrors(
              validation.errors,
            )}`,
          };
          // Include the expected schema + what the LLM actually sent so it can
          // self-correct on retry (the narrow error message alone is often
          // not enough for the LLM to reconstruct the required shape).
          resultContent = JSON.stringify({
            error: true,
            message: errorInfo.message,
            expectedSchema: tool.inputSchema,
            receivedArguments: toolArgs,
          });
          return {
            resultMessage: toolResultMessage(resultContent, toolCall.id),
            didError: true,
            askHumanMarker: undefined,
          };
        }
      }
      try {
        const execResult = await tool.handler(toolArgs);
        resultContent = execResult.content;
        if (isAskHumanResult(execResult)) {
          askHumanMarker = { question: execResult.question, toolCallId: toolCall.id };
        }
        // Apply optional decision-scope update returned by the tool. Shallow
        // merge into the shared `decision` ref so downstream
        // AgentInstruction.activeWhen predicates see the new state on the
        // next iteration. Used by SkillRegistry.autoActivate and any
        // consumer-authored tool that flips a routing flag.
        if (decision && execResult.decisionUpdate) {
          Object.assign(decision, execResult.decisionUpdate);
        }
        const instructed = execResult as {
          instructions?: readonly string[];
          followUps?: readonly RuntimeFollowUp[];
        };
        runtimeInstructions = instructed.instructions;
        runtimeFollowUps = instructed.followUps;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorInfo = { message: msg };
        resultContent = JSON.stringify({ error: true, message: msg });
      }
    }
  }

  const toolExecLatencyMs = Date.now() - startMs;

  if (instructionConfig) {
    const perToolInstructions = instructionConfig.instructionsByToolId.get(toolCall.name);
    const agentRules = instructionConfig.agentResponseRules;
    const buildTimeInstructions = agentRules?.length
      ? [...agentRules, ...(perToolInstructions ?? [])]
      : perToolInstructions;
    const hasInstructions =
      buildTimeInstructions?.length || runtimeInstructions?.length || runtimeFollowUps?.length;

    if (hasInstructions) {
      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(resultContent);
      } catch {
        parsedContent = resultContent;
      }

      const ctx: InstructionContext = {
        content: parsedContent,
        error: errorInfo,
        latencyMs: toolExecLatencyMs,
        input: toolCall.arguments,
        toolId: toolCall.name,
      };

      const injectionResult = processInstructions(
        resultContent,
        buildTimeInstructions,
        ctx,
        runtimeInstructions || runtimeFollowUps
          ? { instructions: runtimeInstructions, followUps: runtimeFollowUps }
          : undefined,
        instructionConfig?.template,
      );

      if (injectionResult.injected) {
        resultContent = injectionResult.content;
      }

      if (injectionResult.fired.length > 0 && instructionConfig?.onInstructionsFired) {
        instructionConfig.onInstructionsFired(toolCall.name, injectionResult.fired);
      }

      if (decision && instructionConfig?.decideFunctions?.size) {
        for (const fired of injectionResult.fired) {
          const decideFn = instructionConfig.decideFunctions.get(fired.id);
          if (decideFn) {
            try {
              decideFn(decision, ctx);
            } catch {
              // decide errors are fail-open — don't crash tool execution
            }
          }
        }
      }
    }
  }

  onStreamEvent?.({
    type: 'tool_end',
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    result: resultContent,
    error: !!errorInfo,
    latencyMs: toolExecLatencyMs,
  });

  return {
    resultMessage: toolResultMessage(resultContent, toolCall.id),
    didError: errorInfo !== undefined,
    askHumanMarker,
  };
}
