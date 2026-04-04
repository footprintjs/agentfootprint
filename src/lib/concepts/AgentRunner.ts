/**
 * AgentRunner — executes the agent loop, manages conversation state.
 *
 * Created by Agent.build(). Not instantiated directly.
 */

import { FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartType, FlowChartExecutorOptions } from 'footprintjs';
import { buildAgentLoop, AgentPattern } from '../loop';
import { PendingFollowUpManager, InstructionRecorder } from '../instructions';
import type { InstructionOverride } from '../instructions';
import type { AgentLoopConfig } from '../loop';
import { createAgentRenderer } from '../narrative';
import { annotateSpecIcons } from '../../concepts/specIcons';
import type { SpecLike } from '../../concepts/specIcons';
import { staticPrompt } from '../../providers/prompt/static';
import { slidingWindow } from '../../providers/messages/slidingWindow';
import { noTools } from '../../providers/tools/noTools';
import { staticTools } from '../../providers/tools/staticTools';
import { ToolRegistry } from '../../tools';
import { lastAssistantMessage } from '../../memory';
import { getTextContent } from '../../types/content';
import { userMessage, toolResultMessage, assistantMessage } from '../../types';
import type { LLMProvider, LLMResponse, AgentResult, Message } from '../../types';
import type { MemoryConfig } from '../../adapters/memory/types';
import type { AgentRecorder, PromptProvider, ToolProvider } from '../../core';
import { RecorderBridge } from '../../recorders/v2/RecorderBridge';

/** Options for constructing an AgentRunner. Created by Agent.build(). */
export interface AgentRunnerOptions {
  readonly provider: LLMProvider;
  readonly name: string;
  readonly systemPromptText?: string;
  readonly registry: ToolRegistry;
  readonly maxIterations?: number;
  readonly recorders?: AgentRecorder[];
  readonly memoryConfig?: MemoryConfig;
  readonly pattern?: AgentPattern;
  readonly promptProvider?: PromptProvider;
  readonly toolProvider?: ToolProvider;
  readonly instructionOverrides?: ReadonlyMap<string, InstructionOverride>;
  readonly streaming?: boolean;
}

export class AgentRunner {
  private static _autoExecCounter = 0;
  private readonly provider: LLMProvider;
  readonly name: string;
  private readonly systemPromptText?: string;
  private readonly registry: ToolRegistry;
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private readonly memoryConfig?: MemoryConfig;
  private readonly agentPattern: AgentPattern;
  private readonly customPromptProvider?: PromptProvider;
  private readonly customToolProvider?: ToolProvider;
  private readonly instructionOverrides?: ReadonlyMap<string, InstructionOverride>;
  private readonly streamingEnabled: boolean;
  private conversationHistory: Message[] = [];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  private readonly narrativeRenderer = createAgentRenderer();
  private readonly pendingFollowUps = new PendingFollowUpManager();

  constructor(options: AgentRunnerOptions) {
    this.provider = options.provider;
    this.name = options.name;
    this.systemPromptText = options.systemPromptText;
    this.registry = options.registry;
    this.maxIter = options.maxIterations ?? 10;
    this.recorders = options.recorders ?? [];
    this.memoryConfig = options.memoryConfig;
    this.agentPattern = options.pattern ?? AgentPattern.Regular;
    this.customPromptProvider = options.promptProvider;
    this.customToolProvider = options.toolProvider;
    this.instructionOverrides = options.instructionOverrides;
    this.streamingEnabled = options.streaming ?? false;
  }

  /** Expose the agent's internal flowChart for subflow composition. */
  toFlowChart(): FlowChartType {
    const { chart, spec } = buildAgentLoop(this.buildConfig(), {
      messages: [],
      subflowMode: true,
    }, { captureSpec: true });
    this.lastSpec = annotateSpecIcons(spec as SpecLike);
    return chart;
  }

  /** Run the agent with a user message. */
  async run(
    message: string,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onToken?: (token: string) => void;
    },
  ): Promise<AgentResult> {
    // Check for pending strict follow-up from previous turn
    const pendingMatch = this.pendingFollowUps.checkAndConsume(message);
    if (pendingMatch) {
      const tool = this.registry.get(pendingMatch.followUp.toolId);
      if (tool) {
        const toolResult = await tool.handler(pendingMatch.followUp.params);
        const autoMessages: Message[] = [
          ...this.conversationHistory,
          userMessage(message),
          assistantMessage(`Using ${pendingMatch.followUp.description}.`, [{ id: `auto-strict-${++AgentRunner._autoExecCounter}`, name: pendingMatch.followUp.toolId, arguments: pendingMatch.followUp.params }]),
          toolResultMessage(toolResult.content, `auto-strict-${AgentRunner._autoExecCounter}`),
        ];
        this.conversationHistory = autoMessages;
      }
    }

    const existingMessages = this.memoryConfig?.store ? [] : this.conversationHistory;

    const { chart, spec, getStrictFollowUp } = buildAgentLoop(this.buildConfig(), {
      messages: message ? [userMessage(message)] : [],
      existingMessages,
    }, { captureSpec: true });
    this.lastSpec = annotateSpecIcons(spec as SpecLike);
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;

    bridge?.dispatchTurnStart(message);

    const executorOpts: FlowChartExecutorOptions = { enrichSnapshots: true };
    if (options?.onToken && this.streamingEnabled) {
      executorOpts.streamHandlers = {
        onToken: (_streamId: string, token: string) => options.onToken!(token),
        onStart: () => {},
        onEnd: () => {},
      };
    }
    const executor = new FlowChartExecutor(chart, executorOpts);
    executor.enableNarrative({ renderer: this.narrativeRenderer });
    executor.attachRecorder(new MetricRecorder('metrics'));
    const startMs = Date.now();

    try {
      await executor.run({
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      this.lastExecutor = executor;
      bridge?.dispatchError('llm', err);
      throw err;
    }

    this.lastExecutor = executor;

    // Check for pause (ask_human tool) — return early, no recorder dispatch
    if (executor.isPaused()) {
      return this.buildResult(executor);
    }

    const agentResult = this.buildResult(executor);

    if (bridge) {
      const state = executor.getSnapshot()?.sharedState ?? {};
      const response = state.adapterRawResponse as LLMResponse | undefined;
      if (response) bridge.dispatchLLMCall(response, Date.now() - startMs);
      bridge.dispatchTurnComplete(agentResult.content, agentResult.messages.length, agentResult.iterations);
    }

    const strictFU = getStrictFollowUp();
    if (strictFU) {
      this.pendingFollowUps.setPending({
        followUp: strictFU.followUp,
        sourceToolId: strictFU.sourceToolId,
      });
    }

    return agentResult;
  }

  /**
   * Resume a paused agent (after ask_human tool).
   *
   * Provides the human's response, which becomes the tool result for ask_human.
   * The agent loop continues from where it paused.
   *
   * @example
   * ```typescript
   * const result = await agent.run('Process my refund');
   * if (result.paused) {
   *   const final = await agent.resume('Yes, order ORD-123');
   * }
   * ```
   */
  async resume(humanResponse: string): Promise<AgentResult> {
    const executor = this.lastExecutor;
    if (!executor || !executor.isPaused()) {
      throw new Error('Cannot resume: agent is not paused. Call run() first.');
    }

    const checkpoint = executor.getCheckpoint();
    if (!checkpoint) {
      throw new Error('Cannot resume: no checkpoint available.');
    }

    await executor.resume(checkpoint, humanResponse);

    return this.buildResult(executor);
  }

  /** Extract AgentResult from executor state — shared by run() and resume(). */
  private buildResult(executor: FlowChartExecutor): AgentResult {
    if (executor.isPaused()) {
      const cp = executor.getCheckpoint();
      const pausedMessages = (executor.getSnapshot()?.sharedState?.messages as Message[]) ?? [];
      this.conversationHistory = pausedMessages;
      return {
        content: '',
        messages: pausedMessages,
        iterations: (executor.getSnapshot()?.sharedState?.loopCount as number) ?? 0,
        paused: true,
        pauseData: cp?.pauseData as { question: string; toolCallId: string } | undefined,
      };
    }

    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const messages = (state.messages as Message[]) ?? [];
    const lastAsst = lastAssistantMessage(messages);
    const result = (state.result as string) ?? (lastAsst ? getTextContent(lastAsst.content) : '');
    const iterations = (state.loopCount as number) ?? 0;

    this.conversationHistory = messages;

    return { content: result, messages, iterations };
  }

  getNarrative(): string[] { return this.lastExecutor?.getNarrative() ?? []; }
  getNarrativeEntries() { return this.lastExecutor?.getNarrativeEntries() ?? []; }
  getSnapshot() { return this.lastExecutor?.getSnapshot(); }

  getSpec(): unknown {
    if (!this.lastSpec) {
      const { spec } = buildAgentLoop(this.buildConfig(), { messages: [], subflowMode: true }, { captureSpec: true });
      this.lastSpec = annotateSpecIcons(spec as SpecLike);
    }
    return this.lastSpec;
  }

  getMessages(): Message[] { return [...this.conversationHistory]; }
  resetConversation(): void { this.conversationHistory = []; }

  private buildConfig(): AgentLoopConfig {
    const hasTools = this.registry.size > 0;
    const promptProvider = this.customPromptProvider ?? staticPrompt(this.systemPromptText ?? '');
    const toolsProvider = this.customToolProvider ?? (hasTools ? staticTools(this.registry.all()) : noTools());

    return {
      provider: this.provider,
      systemPrompt: { provider: promptProvider },
      messages: {
        strategy: this.memoryConfig?.strategy ?? slidingWindow({ maxMessages: 100 }),
        store: this.memoryConfig?.store,
        conversationId: this.memoryConfig?.conversationId,
      },
      tools: { provider: toolsProvider },
      registry: this.registry,
      maxIterations: this.maxIter,
      commitMemory: this.memoryConfig ? {
        store: this.memoryConfig.store,
        conversationId: this.memoryConfig.conversationId,
      } : undefined,
      pattern: this.agentPattern,
      instructionOverrides: this.instructionOverrides,
      streaming: this.streamingEnabled,
      onInstructionsFired: (toolId, fired) => {
        for (const rec of this.recorders) {
          if (rec instanceof InstructionRecorder) rec.recordFirings(toolId, fired);
        }
      },
    };
  }
}
