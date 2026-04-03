/**
 * AgentRunner — executes the agent loop, manages conversation state.
 *
 * Created by Agent.build(). Not instantiated directly.
 */

import { FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartType } from 'footprintjs';
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

  constructor(
    provider: LLMProvider,
    name: string,
    systemPromptText: string | undefined,
    registry: ToolRegistry,
    maxIter: number,
    recorders: AgentRecorder[] = [],
    memoryConfig?: MemoryConfig,
    pattern: AgentPattern = AgentPattern.Regular,
    customPromptProvider?: PromptProvider,
    customToolProvider?: ToolProvider,
    instructionOverrides?: ReadonlyMap<string, InstructionOverride>,
    streaming = false,
  ) {
    this.provider = provider;
    this.name = name;
    this.systemPromptText = systemPromptText;
    this.registry = registry;
    this.maxIter = maxIter;
    this.recorders = recorders;
    this.memoryConfig = memoryConfig;
    this.agentPattern = pattern;
    this.customPromptProvider = customPromptProvider;
    this.customToolProvider = customToolProvider;
    this.instructionOverrides = instructionOverrides;
    this.streamingEnabled = streaming;
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

    const executorOpts: any = { enrichSnapshots: true };
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

    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const messages = (state.messages as Message[]) ?? [];
    const lastAsst = lastAssistantMessage(messages);
    const result = (state.result as string) ?? (lastAsst ? getTextContent(lastAsst.content) : '');
    const iterations = (state.loopCount as number) ?? 0;

    if (bridge) {
      const response = state.adapterRawResponse as LLMResponse | undefined;
      if (response) bridge.dispatchLLMCall(response, Date.now() - startMs);
      bridge.dispatchTurnComplete(result, messages.length, iterations);
    }

    this.conversationHistory = messages;

    const strictFU = getStrictFollowUp();
    if (strictFU) {
      this.pendingFollowUps.setPending({
        followUp: strictFU.followUp,
        sourceToolId: strictFU.sourceToolId,
      });
    }

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
