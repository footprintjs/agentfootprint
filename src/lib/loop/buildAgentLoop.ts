/**
 * Loop assembler — builds the full agent ReAct loop flowchart.
 *
 * Mounts the three API slots as subflows, then wires CallLLM → ParseResponse →
 * RouteResponse (decider) with branches for tool execution and finalization.
 *
 * Supports two loop patterns (AgentPattern enum):
 *
 * Regular ReAct (default): loopTo('call-llm')
 *   Seed → [sf-system-prompt] → [sf-messages] → ApplyPreparedMessages
 *     → [sf-tools] → AssemblePrompt → CallLLM → ParseResponse
 *     → RouteResponse(decider) → [CommitMemory?] → loopTo('call-llm')
 *   Slots resolve ONCE before the loop.
 *
 * Dynamic ReAct: loopTo('sf-system-prompt')
 *   Same flowchart, but loop jumps back to SystemPrompt subflow.
 *   All three API slots (prompt, tools, messages) re-evaluate each iteration.
 *   Strategies receive updated context (tool results, incremented loopCount)
 *   and can return different configurations based on what happened.
 *
 * Design choices:
 *   - Seed stage initializes loopCount + maxIterations + messages
 *   - Messages subflow uses internal keys (inputMapper/outputMapper), then
 *     ApplyPreparedMessages copies to the real 'messages' key
 *   - Each slot is ALWAYS a subflow — zero overhead, free drill-down + narrative
 *   - RouteResponse is a proper decider — visible in flowchart as diamond with branches
 *   - Tool execution is a subflow — enables drill-down in BTS
 *   - Chart is self-contained — no wrapping needed
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import { systemMessage, userMessage } from '../../types/messages';
import { buildSystemPromptSubflow } from '../slots/system-prompt';
import { buildMessagesSubflow } from '../slots/messages';
import { buildToolsSubflow } from '../slots/tools';
import type { TypedScope } from 'footprintjs';
import { createCallLLMStage } from '../call/callLLMStage';
import { createStreamingCallLLMStage } from '../call/streamingCallLLMStage';
import { parseResponseStage } from '../call/parseResponseStage';
import { buildToolExecutionSubflow } from '../call/toolExecutionSubflow';
import { createCommitMemoryStage } from '../../stages/commitMemory';
import { getTextContent } from '../../types/content';
import { lastAssistantMessage } from '../../memory';
import { AgentPattern } from './types';
import type { AgentLoopConfig, AgentLoopSeedOptions, RoutingConfig } from './types';
import { applyInstructionOverrides } from '../instructions';
import type { ResolvedFollowUp, ResolvedInstruction, LLMInstruction, InstructedToolDefinition } from '../instructions';

// ── Default Agent Routing ─────────────────────────────────────────────────────

/**
 * Default routing for the Agent loop: tool-calls | final.
 *
 * Expressed as a RoutingConfig so buildAgentLoop has ONE code path
 * for both Agent and Swarm routing.
 */
function defaultAgentRouting(toolExecutionSubflow: FlowChart, useCommitFlag: boolean): RoutingConfig {
  return {
    deciderName: 'RouteResponse',
    deciderId: 'route-response',
    deciderDescription: 'Route to tool execution or finalization based on LLM response',
    decider: (scope: any) => {
      const parsed = scope.parsedResponse;
      if (parsed?.hasToolCalls) return 'tool-calls';
      return 'final';
    },
    branches: [
      {
        id: 'tool-calls',
        kind: 'subflow',
        chart: toolExecutionSubflow,
        name: 'ExecuteTools',
        mount: {
          inputMapper: (parent: Record<string, unknown>) => ({
            parsedResponse: parent.parsedResponse,
            currentMessages: parent.messages,
            currentLoopCount: parent.loopCount,
            maxIterations: parent.maxIterations,
          }),
          outputMapper: (sfOutput: Record<string, unknown>) => ({
            messages: sfOutput.toolResultMessages,
            loopCount: sfOutput.updatedLoopCount,
          }),
        },
      },
      {
        id: 'final',
        kind: 'fn',
        fn: createFinalizeStage({ useCommitFlag }),
        description: 'Extract final answer and stop the loop',
        name: 'Finalize',
      },
    ],
    defaultBranch: 'final',
  };
}

/**
 * Well-known scope key for the user message in subflow mode.
 * Parent charts must set this key in their inputMapper:
 * `inputMapper: (p) => ({ message: p.userMessage })`
 */
export const SUBFLOW_MESSAGE_KEY = 'message';

/**
 * Build the full agent loop flowchart from config.
 *
 * Returns a self-contained FlowChart ready for FlowChartExecutor.
 * Includes a Seed stage that initializes scope with the provided messages.
 *
 * Usage:
 * ```typescript
 * const chart = buildAgentLoop(config, { messages: [userMessage('hello')] });
 * const executor = new FlowChartExecutor(chart);
 * await executor.run();
 * ```
 */
export interface StrictFollowUpResult {
  followUp: ResolvedFollowUp;
  sourceToolId: string;
}

export interface AgentLoopBuild {
  chart: FlowChart;
  /** Get strict follow-up that fired during the last execution (if any). */
  getStrictFollowUp: () => StrictFollowUpResult | undefined;
}

export interface AgentLoopResult extends AgentLoopBuild {
  spec: unknown;
}

export function buildAgentLoop(config: AgentLoopConfig, seed?: AgentLoopSeedOptions): AgentLoopBuild;
export function buildAgentLoop(config: AgentLoopConfig, seed: AgentLoopSeedOptions | undefined, options: { captureSpec: true }): AgentLoopResult;
export function buildAgentLoop(config: AgentLoopConfig, seed?: AgentLoopSeedOptions, options?: { captureSpec: boolean }): AgentLoopBuild | AgentLoopResult {
  validateConfig(config);

  const maxIterations = config.maxIterations ?? 10;
  const seedMessages = seed?.messages ?? [];
  const existingMessages = seed?.existingMessages ?? [];
  const subflowMode = seed?.subflowMode ?? false;

  // Auto-enable useCommitFlag when commitMemory is provided
  const useCommitFlag = config.useCommitFlag || !!config.commitMemory;

  // Build slot subflows
  const systemPromptSubflow = buildSystemPromptSubflow(config.systemPrompt);
  const messagesSubflow = buildMessagesSubflow(config.messages);
  const toolsSubflow = buildToolsSubflow(config.tools);

  // Build instruction config from registry — collect tools that have instructions
  // Apply agent-level overrides if provided
  const instructionsByToolId = new Map<string, readonly LLMInstruction[]>();
  for (const tool of config.registry.all()) {
    const instructed = tool as InstructedToolDefinition;
    if (instructed.instructions?.length) {
      const override = config.instructionOverrides?.get(tool.id);
      if (override) {
        instructionsByToolId.set(tool.id, applyInstructionOverrides(instructed.instructions, override));
      } else {
        instructionsByToolId.set(tool.id, instructed.instructions);
      }
    }
  }
  // Capture strict follow-ups that fire during tool execution.
  // Stored in a closure variable — AgentRunner reads it after run() completes.
  let lastStrictFollowUp: ResolvedFollowUp | undefined;
  let lastStrictSourceToolId: string | undefined;

  const onInstructionsFired = (toolId: string, fired: ResolvedInstruction[]) => {
    // Find the first strict follow-up that fired (highest priority wins)
    if (!lastStrictFollowUp) {
      for (const instr of fired) {
        if (instr.resolvedFollowUp?.strict) {
          lastStrictFollowUp = instr.resolvedFollowUp;
          lastStrictSourceToolId = toolId;
          break;
        }
      }
    }
    // Forward to external callback (InstructionRecorder)
    config.onInstructionsFired?.(toolId, fired);
  };

  // Build call stages
  const callLLM = config.streaming
    ? createStreamingCallLLMStage(config.provider)
    : createCallLLMStage(config.provider);
  const toolExecutionSubflow = buildToolExecutionSubflow({
    registry: config.registry,
    toolProvider: config.toolProvider,
    // Always pass instruction config — even without build-time instructions,
    // tool handlers can return runtime instructions/followUps.
    instructionConfig: { instructionsByToolId, onInstructionsFired },
  });

  // Seed stage: initialize all required scope state.
  // In subflowMode, reads `message` from scope (set by parent's inputMapper).
  // In normal mode, uses baked-in seed/existing messages.
  // Named stage functions for readability and AI-agent understanding
  const seedStage = (scope: TypedScope<AgentLoopState>) => {
    if (subflowMode) {
      const msg = scope.message ?? '';
      scope.messages = msg ? [userMessage(msg)] : [];
    } else {
      scope.messages = [...existingMessages, ...seedMessages];
    }
    scope.loopCount = 0;
    scope.maxIterations = maxIterations;
  };

  let builder = flowChart<AgentLoopState>(
    'Seed', seedStage, 'seed', undefined, 'Initialize agent loop state',
  );

  // Mount SystemPrompt subflow
  builder = builder.addSubFlowChartNext(
    'sf-system-prompt',
    systemPromptSubflow,
    'SystemPrompt',
    {
      inputMapper: (parent: Record<string, unknown>) => ({
        messages: parent.messages,
        loopCount: parent.loopCount,
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        systemPrompt: sfOutput.systemPrompt,
      }),
    },
  );

  // Mount Messages subflow
  builder = builder.addSubFlowChartNext(
    'sf-messages',
    messagesSubflow,
    'Messages',
    {
      inputMapper: (parent: Record<string, unknown>) => ({
        currentMessages: parent.messages ?? [],
        loopCount: parent.loopCount ?? 0,
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        memory_preparedMessages: sfOutput.memory_preparedMessages,
        memory_storedHistory: sfOutput.memory_storedHistory,
      }),
    },
  );

  // ApplyPreparedMessages — copy prepared messages from temp key to 'messages'.
  // Clears memory_preparedMessages after reading to prevent applyOutputMapping
  // array concat from accumulating stale messages on Dynamic ReAct loop iterations.
  const applyPreparedMessagesStage = (scope: TypedScope<AgentLoopState>) => {
    const prepared = scope.memory_preparedMessages;
    if (prepared) {
      scope.messages = prepared;
      // Clear to prevent applyOutputMapping concat on next Dynamic ReAct iteration
      scope.$setValue('memory_preparedMessages', undefined);
    }
  };

  builder = builder.addFunction(
    'ApplyPreparedMessages', applyPreparedMessagesStage,
    'apply-prepared-messages', 'Copy prepared messages from Messages slot output to scope',
  );

  // Mount Tools subflow
  builder = builder.addSubFlowChartNext(
    'sf-tools',
    toolsSubflow,
    'Tools',
    {
      inputMapper: (parent: Record<string, unknown>) => ({
        messages: parent.messages,
        loopCount: parent.loopCount,
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        toolDescriptions: sfOutput.toolDescriptions,
      }),
    },
  );

  const assemblePromptStage = (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const sysPrompt = scope.systemPrompt;
    if (sysPrompt && (messages.length === 0 || messages[0].role !== 'system')) {
      scope.messages = [systemMessage(sysPrompt), ...messages];
    }
  };

  // AssemblePrompt: prepend system message if not already present
  builder = builder.addFunction(
    'AssemblePrompt', assemblePromptStage,
    'assemble-prompt', 'Prepend system prompt to messages before LLM call',
  );

  // CallLLM → ParseResponse → Routing(decider)
  //   Routing is pluggable via config.routing (RoutingConfig).
  //   Default: RouteResponse → {tool-calls | final}
  //   Swarm:   RouteSpecialist → {specialist-A | ... | swarm-tools | final}
  //
  // Add CallLLM — streaming or non-streaming
  if (config.streaming) {
    builder = builder.addStreamingFunction('CallLLM', callLLM, 'call-llm', 'llm-stream', 'Send messages + tools to LLM provider (streaming)');
  } else {
    builder = builder.addFunction('CallLLM', callLLM, 'call-llm', 'Send messages + tools to LLM provider');
  }
  builder = builder
    .addFunction('ParseResponse', parseResponseStage, 'parse-response', 'Parse LLM response into structured result');

  // ── Routing — one code path for both Agent and Swarm ──
  const routing: RoutingConfig = config.routing ?? defaultAgentRouting(toolExecutionSubflow, useCommitFlag);

  // Validate branches
  if (routing.branches.length === 0) {
    throw new Error('RoutingConfig must have at least one branch.');
  }
  const branchIds = new Set(routing.branches.map((b) => b.id));
  if (branchIds.size !== routing.branches.length) {
    throw new Error('RoutingConfig has duplicate branch IDs.');
  }
  if (!branchIds.has(routing.defaultBranch)) {
    throw new Error(`RoutingConfig.defaultBranch '${routing.defaultBranch}' does not match any branch ID: [${[...branchIds].join(', ')}]`);
  }

  // Wrap decider with structural maxIterations guard — no custom routing can bypass this.
  // If loopCount >= maxIterations, force-route to defaultBranch (typically 'final').
  const safeDecider: RoutingConfig['decider'] = (scope: any, breakFn, streamCb) => {
    const loopCount = scope.loopCount ?? 0;
    const maxIter = scope.maxIterations ?? 10;
    if (loopCount >= maxIter) return routing.defaultBranch;
    return routing.decider(scope, breakFn, streamCb);
  };

  let decider = builder.addDeciderFunction(
    routing.deciderName,
    // SAFETY: addDeciderFunction expects StageFunction (returns TOut | void) but deciders
    // return string (branch key). footprintjs uses the return value to select the branch.
    safeDecider as any,
    routing.deciderId,
    routing.deciderDescription,
  );

  for (const branch of routing.branches) {
    switch (branch.kind) {
      case 'subflow':
        decider = decider.addSubFlowChartBranch(branch.id, branch.chart, branch.name ?? branch.id, branch.mount);
        break;
      case 'lazy-subflow':
        decider = decider.addLazySubFlowChartBranch(branch.id, branch.factory, branch.name ?? branch.id, branch.mount);
        break;
      case 'fn':
        decider = decider.addFunctionBranch(branch.id, branch.name ?? branch.id, branch.fn, branch.description);
        break;
    }
  }

  builder = decider.setDefault(routing.defaultBranch).end();

  // Mount CommitMemory when persistent memory is configured.
  // CommitMemory saves full history to store (fire-and-forget) and calls $break().
  if (config.commitMemory) {
    const commitMemory = createCommitMemoryStage(config.commitMemory);
    builder = builder.addFunction('CommitMemory', commitMemory, 'commit-memory', 'Persist conversation history to store');
  }

  // Loop target depends on pattern:
  //   Regular (default): loop to CallLLM — slots resolve once
  //   Dynamic: loop to SystemPrompt — all slots re-evaluate each iteration
  const loopTarget = config.pattern === AgentPattern.Dynamic
    ? 'sf-system-prompt'
    : 'call-llm';
  builder = builder.loopTo(loopTarget);

  /** Get strict follow-up that fired during the last execution (if any). */
  const getStrictFollowUp = () => lastStrictFollowUp
    ? { followUp: lastStrictFollowUp, sourceToolId: lastStrictSourceToolId! }
    : undefined;

  if (options?.captureSpec) {
    const spec = builder.toSpec();
    return { chart: builder.build(), spec, getStrictFollowUp };
  }
  return { chart: builder.build(), getStrictFollowUp };
}

/**
 * Create the Finalize stage function (decider 'final' branch).
 *
 * Extracts the final answer text from the last assistant message and stops
 * the loop. When useCommitFlag is set, writes memory_shouldCommit instead
 * of calling $break() directly — the downstream CommitMemory stage will break.
 */
function createFinalizeStage(options: { useCommitFlag: boolean }) {
  const { useCommitFlag } = options;
  return (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const lastAsst = lastAssistantMessage(messages);
    scope.result = lastAsst ? getTextContent(lastAsst.content) : '';

    if (useCommitFlag) {
      scope.memory_shouldCommit = true;
    } else {
      scope.$break();
    }
  };
}

/**
 * Validate the AgentLoopConfig at build time.
 */
function validateConfig(config: AgentLoopConfig): void {
  if (!config.provider) {
    throw new Error('AgentLoopConfig: provider is required');
  }
  if (!config.systemPrompt) {
    throw new Error('AgentLoopConfig: systemPrompt config is required');
  }
  if (!config.messages) {
    throw new Error('AgentLoopConfig: messages config is required');
  }
  if (!config.tools) {
    throw new Error('AgentLoopConfig: tools config is required');
  }
  if (!config.registry) {
    throw new Error('AgentLoopConfig: registry is required');
  }
  if (config.maxIterations !== undefined && config.maxIterations < 0) {
    throw new Error('AgentLoopConfig: maxIterations must be non-negative');
  }
}
