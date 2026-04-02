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
import { parseResponseStage } from '../call/parseResponseStage';
import { buildToolExecutionSubflow } from '../call/toolExecutionSubflow';
import { createCommitMemoryStage } from '../../stages/commitMemory';
import { getTextContent } from '../../types/content';
import { lastAssistantMessage } from '../../memory';
import { AgentPattern } from './types';
import type { AgentLoopConfig, AgentLoopSeedOptions } from './types';

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
export interface AgentLoopResult {
  chart: FlowChart;
  spec: unknown;
}

export function buildAgentLoop(config: AgentLoopConfig, seed?: AgentLoopSeedOptions): FlowChart;
export function buildAgentLoop(config: AgentLoopConfig, seed: AgentLoopSeedOptions | undefined, options: { captureSpec: true }): AgentLoopResult;
export function buildAgentLoop(config: AgentLoopConfig, seed?: AgentLoopSeedOptions, options?: { captureSpec: boolean }): FlowChart | AgentLoopResult {
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

  // Build call stages
  const callLLM = createCallLLMStage(config.provider);
  const toolExecutionSubflow = buildToolExecutionSubflow({
    registry: config.registry,
    toolProvider: config.toolProvider,
  });

  // Seed stage: initialize all required scope state.
  // In subflowMode, reads `message` from scope (set by parent's inputMapper).
  // In normal mode, uses baked-in seed/existing messages.
  let builder = flowChart<AgentLoopState>(
    'Seed',
    (scope) => {
      if (subflowMode) {
        const msg = scope.message ?? '';
        scope.messages = msg ? [userMessage(msg)] : [];
      } else {
        scope.messages = [...existingMessages, ...seedMessages];
      }
      scope.loopCount = 0;
      scope.maxIterations = maxIterations;
    },
    'seed',
    undefined,
    'Initialize agent loop state',
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

  // ApplyPreparedMessages — copy prepared messages from temp key to 'messages'
  builder = builder.addFunction(
    'ApplyPreparedMessages',
    (scope) => {
      const prepared = scope.memory_preparedMessages;
      if (prepared) {
        scope.messages = prepared;
      }
    },
    'apply-prepared-messages',
    'Copy prepared messages from Messages slot output to scope',
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

  // AssemblePrompt: prepend system message if not already present
  builder = builder.addFunction(
    'AssemblePrompt',
    (scope) => {
      const messages = scope.messages ?? [];
      const sysPrompt = scope.systemPrompt;
      if (sysPrompt && (messages.length === 0 || messages[0].role !== 'system')) {
        scope.messages = [systemMessage(sysPrompt), ...messages];
      }
    },
    'assemble-prompt',
    'Prepend system prompt to messages before LLM call',
  );

  // CallLLM → ParseResponse → RouteResponse(decider)
  //   ├─ 'tool-calls' → [sf-execute-tools]   (loop continues)
  //   └─ 'final'      → Finalize ($break)
  // → [CommitMemory?] → loopTo('call-llm')
  //
  // RouteResponse is a decider: visible as a diamond in the flowchart.
  // 'tool-calls' branch executes tools via subflow, then falls through to loopTo.
  // 'final' branch extracts result + breaks (or sets shouldCommit flag).
  builder = builder
    .addFunction('CallLLM', callLLM, 'call-llm', 'Send messages + tools to LLM provider')
    .addFunction('ParseResponse', parseResponseStage, 'parse-response', 'Parse LLM response into structured result')
    .addDeciderFunction(
      'RouteResponse',
      (scope) => {
        const parsed = scope.parsedResponse;
        const loopCount = scope.loopCount ?? 0;
        const maxIter = scope.maxIterations ?? 10;

        if (parsed?.hasToolCalls && loopCount < maxIter) {
          return 'tool-calls';
        }
        return 'final';
      },
      'route-response',
      'Route to tool execution or finalization based on LLM response',
    )
    .addSubFlowChartBranch(
      'tool-calls',
      toolExecutionSubflow,
      'ExecuteTools',
      {
        inputMapper: (parent: Record<string, unknown>) => ({
          parsedResponse: parent.parsedResponse,
          currentMessages: parent.messages,
          currentLoopCount: parent.loopCount,
          maxIterations: parent.maxIterations,
        }),
        outputMapper: (sfOutput: Record<string, unknown>) => ({
          // toolResultMessages is a DELTA (new tool results only).
          // applyOutputMapping concatenates arrays, so mapping delta → messages
          // correctly appends tool results to the existing conversation.
          messages: sfOutput.toolResultMessages,
          loopCount: sfOutput.updatedLoopCount,
        }),
      },
    )
    .addFunctionBranch(
      'final',
      'Finalize',
      createFinalizeStage({ useCommitFlag }),
      'Extract final answer and stop the loop',
    )
    .setDefault('final')
    .end();

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

  if (options?.captureSpec) {
    const spec = builder.toSpec();
    return { chart: builder.build(), spec };
  }
  return builder.build();
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
