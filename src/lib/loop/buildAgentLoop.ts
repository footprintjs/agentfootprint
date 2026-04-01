/**
 * Loop assembler — builds the full agent ReAct loop flowchart.
 *
 * Mounts the three API slots as subflows, then wires CallLLM → ParseResponse →
 * HandleResponse with a loopTo back to CallLLM.
 *
 * Flowchart:
 *   Seed → [sf-system-prompt] → [sf-messages] → ApplyPreparedMessages
 *     → [sf-tools] → AssemblePrompt → CallLLM → ParseResponse
 *     → HandleResponse → loopTo('call-llm')
 *
 * Slot subflows run ONCE before the loop (same as Agent.ts pattern).
 * The loopTo sends execution back to CallLLM, not the slots.
 * This is the standard ReAct pattern: resolve context once, loop the LLM calls.
 *
 * Design choices:
 *   - Seed stage initializes loopCount + maxIterations + messages
 *   - Messages subflow uses internal keys (inputMapper/outputMapper), then
 *     ApplyPreparedMessages copies to the real 'messages' key
 *   - Each slot is ALWAYS a subflow — zero overhead, free drill-down + narrative
 *   - Chart is self-contained — no wrapping needed
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import { AgentScope, AGENT_PATHS, MEMORY_PATHS } from '../../scope/AgentScope';
import type { Message } from '../../types/messages';
import { systemMessage, userMessage } from '../../types/messages';
import { buildSystemPromptSubflow } from '../slots/system-prompt';
import { buildMessagesSubflow } from '../slots/messages';
import { buildToolsSubflow } from '../slots/tools';
import { createCallLLMStage } from '../call/callLLMStage';
import { parseResponseStage } from '../call/parseResponseStage';
import { createHandleResponseStage } from '../call/handleResponseStage';
import { createCommitMemoryStage } from '../../stages/commitMemory';
import type { AgentLoopConfig, AgentLoopSeedOptions } from './types';

/**
 * Well-known scope key for the user message in subflow mode.
 * Parent charts must set this key in their inputMapper:
 * `inputMapper: (p) => ({ [SUBFLOW_MESSAGE_KEY]: p.userMessage })`
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
 * const executor = new FlowChartExecutor(chart, { scopeFactory: agentScopeFactory });
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
  const handleResponse = createHandleResponseStage({
    registry: config.registry,
    toolProvider: config.toolProvider,
    useCommitFlag,
  });

  // Seed stage: initialize all required scope state.
  // In subflowMode, reads `message` from scope (set by parent's inputMapper).
  // In normal mode, uses baked-in seed/existing messages.
  let builder = flowChart(
    'Seed',
    (scope: ScopeFacade) => {
      if (subflowMode) {
        const raw = scope.getValue(SUBFLOW_MESSAGE_KEY);
        const msg = typeof raw === 'string' ? raw : '';
        AgentScope.setMessages(scope, msg ? [userMessage(msg)] : []);
      } else {
        AgentScope.setMessages(scope, [...existingMessages, ...seedMessages]);
      }
      AgentScope.setLoopCount(scope, 0);
      AgentScope.setMaxIterations(scope, maxIterations);
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
        [AGENT_PATHS.MESSAGES]: parent[AGENT_PATHS.MESSAGES],
        [AGENT_PATHS.LOOP_COUNT]: parent[AGENT_PATHS.LOOP_COUNT],
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        [AGENT_PATHS.SYSTEM_PROMPT]: sfOutput[AGENT_PATHS.SYSTEM_PROMPT],
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
        currentMessages: parent[AGENT_PATHS.MESSAGES] ?? [],
        loopCount: parent[AGENT_PATHS.LOOP_COUNT] ?? 0,
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        [MEMORY_PATHS.PREPARED_MESSAGES]: sfOutput[MEMORY_PATHS.PREPARED_MESSAGES],
        [MEMORY_PATHS.STORED_HISTORY]: sfOutput[MEMORY_PATHS.STORED_HISTORY],
      }),
    },
  );

  // ApplyPreparedMessages — copy prepared messages from temp key to 'messages'
  builder = builder.addFunction(
    'ApplyPreparedMessages',
    (scope: ScopeFacade) => {
      const prepared = scope.getValue(MEMORY_PATHS.PREPARED_MESSAGES) as Message[] | undefined;
      if (prepared) {
        AgentScope.setMessages(scope, prepared);
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
        [AGENT_PATHS.MESSAGES]: parent[AGENT_PATHS.MESSAGES],
        [AGENT_PATHS.LOOP_COUNT]: parent[AGENT_PATHS.LOOP_COUNT],
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        [AGENT_PATHS.TOOL_DESCRIPTIONS]: sfOutput[AGENT_PATHS.TOOL_DESCRIPTIONS],
      }),
    },
  );

  // AssemblePrompt: prepend system message if not already present
  builder = builder.addFunction(
    'AssemblePrompt',
    (scope: ScopeFacade) => {
      const messages = AgentScope.getMessages(scope);
      const sysPrompt = AgentScope.getSystemPrompt(scope);
      if (sysPrompt && (messages.length === 0 || messages[0].role !== 'system')) {
        AgentScope.setMessages(scope, [systemMessage(sysPrompt), ...messages]);
      }
    },
    'assemble-prompt',
    'Prepend system prompt to messages before LLM call',
  );

  // CallLLM → ParseResponse → HandleResponse [→ CommitMemory] → loopTo('call-llm')
  builder = builder
    .addFunction('CallLLM', callLLM, 'call-llm', 'Send messages + tools to LLM provider')
    .addFunction('ParseResponse', parseResponseStage, 'parse-response', 'Parse LLM response into structured result')
    .addFunction('HandleResponse', handleResponse, 'handle-response', 'Execute tool calls or finalize turn');

  // Mount CommitMemory when persistent memory is configured.
  // CommitMemory saves full history to store (fire-and-forget) and calls breakPipeline.
  if (config.commitMemory) {
    const commitMemory = createCommitMemoryStage(config.commitMemory);
    builder = builder.addFunction('CommitMemory', commitMemory, 'commit-memory', 'Persist conversation history to store');
  }

  builder = builder.loopTo('call-llm');

  if (options?.captureSpec) {
    const spec = builder.toSpec();
    return { chart: builder.build(), spec };
  }
  return builder.build();
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
