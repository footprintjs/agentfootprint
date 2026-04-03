/**
 * Agent — the full ReAct agent, rebuilt on top of buildAgentLoop.
 *
 * Fluent builder API that converts to AgentLoopConfig internally.
 * Same public API as the old Agent, but uses the new library-of-libraries
 * architecture (slots → call → loop).
 *
 * Usage:
 *   const agent = Agent.create({ provider: llm })
 *     .system('You are helpful.')
 *     .tool(searchTool)
 *     .build();
 *
 *   const result = await agent.run('hello');
 */

import { FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartType } from 'footprintjs';
import { buildAgentLoop, AgentPattern } from '../loop';
import { PendingFollowUpManager } from '../instructions';
import type { AgentLoopConfig } from '../loop';
import { createAgentRenderer } from '../narrative';
import { annotateSpecIcons } from '../../concepts/specIcons';
import { staticPrompt } from '../../providers/prompt/static';
import { slidingWindow } from '../../providers/messages/slidingWindow';
import { noTools } from '../../providers/tools/noTools';
import { staticTools } from '../../providers/tools/staticTools';
import { ToolRegistry } from '../../tools';
import { lastAssistantMessage } from '../../memory';
import { getTextContent } from '../../types/content';
import { userMessage, toolResultMessage } from '../../types';
import type {
  LLMProvider,
  LLMResponse,
  ToolDefinition,
  AgentResult,
  Message,
} from '../../types';
import type { MemoryConfig } from '../../adapters/memory/types';
import type { AgentRecorder } from '../../core';
import { RecorderBridge } from '../../recorders/v2/RecorderBridge';

export interface AgentOptions {
  readonly provider: LLMProvider;
  readonly name?: string;
}

export class Agent {
  private readonly provider: LLMProvider;
  private readonly agentName: string;
  private systemPromptText?: string;
  private readonly registry = new ToolRegistry();
  private maxIter = 10;
  private readonly recorders: AgentRecorder[] = [];
  private memoryConfig?: MemoryConfig;
  private agentPattern: AgentPattern = AgentPattern.Regular;

  private constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.agentName = options.name ?? 'agent';
  }

  static create(options: AgentOptions): Agent {
    return new Agent(options);
  }

  /** Set system prompt. */
  system(prompt: string): this {
    this.systemPromptText = prompt;
    return this;
  }

  /** Register a tool. */
  tool(toolDef: ToolDefinition): this {
    this.registry.register(toolDef);
    return this;
  }

  /** Register multiple tools. */
  tools(toolDefs: ToolDefinition[]): this {
    for (const t of toolDefs) this.registry.register(t);
    return this;
  }

  /** Set max ReAct loop iterations. */
  maxIterations(n: number): this {
    this.maxIter = n;
    return this;
  }

  /**
   * Set the agent loop pattern.
   *
   * - `AgentPattern.Regular` (default): loops to CallLLM — system prompt, tools,
   *   and memory resolve once before the loop starts.
   * - `AgentPattern.Dynamic`: loops to SystemPrompt — all three API slots
   *   re-evaluate each iteration based on tool results. Use for progressive
   *   authorization, adaptive prompts, or context-dependent tool sets.
   *
   * @example
   * ```typescript
   * // Standard agent — fixed prompt and tools
   * Agent.create({ provider }).pattern(AgentPattern.Regular).build();
   *
   * // Dynamic agent — tools/prompt/memory adapt between iterations
   * Agent.create({ provider })
   *   .pattern(AgentPattern.Dynamic)
   *   .tool(verifyIdentityTool)   // always available
   *   .tool(adminTool)            // only resolves after identity verified
   *   .build();
   * ```
   */
  pattern(p: AgentPattern): this {
    this.agentPattern = p;
    return this;
  }

  /**
   * Enable persistent conversation memory.
   *
   * Adds LoadHistory + CommitMemory to the agent chart:
   *   Seed → Messages(LoadHistory → ApplyStrategy) → ... → HandleResponse → CommitMemory → loopTo
   *
   * LoadHistory loads stored history from `config.store` before each turn.
   * CommitMemory saves the full conversation after each turn (fire-and-forget).
   *
   * @param config.store — Storage adapter (e.g., InMemoryStore, RedisStore).
   * @param config.conversationId — Unique ID to key conversation history.
   * @param config.strategy — Optional. Replaces the default `slidingWindow({ maxMessages: 100 })`
   *   with a custom MemoryStrategy for how history is prepared before each LLM call.
   */
  memory(config: MemoryConfig): this {
    this.memoryConfig = config;
    return this;
  }

  /** Attach an AgentRecorder to observe execution events. */
  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  /** Build the agent and return a runner. */
  build(): AgentRunner {
    return new AgentRunner(
      this.provider,
      this.agentName,
      this.systemPromptText,
      this.registry,
      this.maxIter,
      [...this.recorders],
      this.memoryConfig,
      this.agentPattern,
    );
  }
}

export class AgentRunner {
  private static _autoExecCounter = 0;
  private readonly provider: LLMProvider;
  /** Agent name — used for spec annotations and narrative labeling. */
  readonly name: string;
  private readonly systemPromptText?: string;
  private readonly registry: ToolRegistry;
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private readonly memoryConfig?: MemoryConfig;
  private readonly agentPattern: AgentPattern;
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
  ) {
    this.provider = provider;
    this.name = name;
    this.systemPromptText = systemPromptText;
    this.registry = registry;
    this.maxIter = maxIter;
    this.recorders = recorders;
    this.memoryConfig = memoryConfig;
    this.agentPattern = pattern;
  }

  /**
   * Expose the agent's internal flowChart for subflow composition.
   *
   * Returns a chart where the Seed stage reads `message` from scope
   * (set by parent's inputMapper) instead of baked-in messages.
   *
   * Mount with:
   * ```typescript
   * parent.addSubFlowChartNext('sf-agent', agent.toFlowChart(), 'Agent', {
   *   inputMapper: (p) => ({ message: p.userMessage }),
   *   outputMapper: (sf) => ({ result: sf.result }),
   * });
   * ```
   */
  toFlowChart(): FlowChartType {
    const { chart, spec } = buildAgentLoop(this.buildConfig(), {
      messages: [],
      subflowMode: true,
    }, { captureSpec: true });
    this.lastSpec = annotateSpecIcons(spec as any);
    return chart;
  }

  /** Run the agent with a user message. Returns the agent's response. */
  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<AgentResult> {
    // Check for pending strict follow-up from previous turn
    const pendingMatch = this.pendingFollowUps.checkAndConsume(message);
    if (pendingMatch) {
      // Auto-execute: call the tool with pre-resolved params, then run LLM to interpret result
      const tool = this.registry.get(pendingMatch.followUp.toolId);
      if (tool) {
        const toolResult = await tool.handler(pendingMatch.followUp.params);
        // Prepend the auto-executed tool result to conversation as if the LLM called it
        const autoMessages: Message[] = [
          ...this.conversationHistory,
          userMessage(message),
          { role: 'assistant' as const, content: `Using ${pendingMatch.followUp.description}.`, toolCalls: [{ id: `auto-strict-${++AgentRunner._autoExecCounter}`, name: pendingMatch.followUp.toolId, arguments: pendingMatch.followUp.params }] } as any,
          toolResultMessage(toolResult.content, `auto-strict-${AgentRunner._autoExecCounter}`),
        ];
        this.conversationHistory = autoMessages;
        // Fall through to run the LLM to interpret the auto-executed result
      }
    }

    // When memory store is configured, don't pass existingMessages —
    // the Messages slot's LoadHistory stage loads from store directly.
    const existingMessages = this.memoryConfig?.store ? [] : this.conversationHistory;

    const { chart, spec, getStrictFollowUp } = buildAgentLoop(this.buildConfig(), {
      messages: message ? [userMessage(message)] : [],
      existingMessages,
    }, { captureSpec: true });
    this.lastSpec = annotateSpecIcons(spec as any);
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;

    bridge?.dispatchTurnStart(message);

    const executor = new FlowChartExecutor(chart, { enrichSnapshots: true });
    executor.enableNarrative({ renderer: this.narrativeRenderer });
    executor.attachRecorder(new MetricRecorder('metrics'));
    const startMs = Date.now();

    try {
      await executor.run({
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      // Preserve executor for partial narrative inspection after errors
      this.lastExecutor = executor;
      bridge?.dispatchError('llm', err);
      throw err;
    }

    this.lastExecutor = executor;

    // Extract result from snapshot
    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const messages = (state.messages as Message[]) ?? [];
    const lastAsst = lastAssistantMessage(messages);
    const result = (state.result as string) ?? (lastAsst ? getTextContent(lastAsst.content) : '');
    const iterations = (state.loopCount as number) ?? 0;

    // Dispatch recorder events
    if (bridge) {
      const response = state.adapterRawResponse as LLMResponse | undefined;
      if (response) {
        bridge.dispatchLLMCall(response, Date.now() - startMs);
      }
      bridge.dispatchTurnComplete(result, messages.length, iterations);
    }

    // Persist conversation history for multi-turn
    this.conversationHistory = messages;

    // Check for strict follow-ups that fired during this turn
    const strictFU = getStrictFollowUp();
    if (strictFU) {
      this.pendingFollowUps.setPending({
        followUp: strictFU.followUp,
        sourceToolId: strictFU.sourceToolId,
      });
    }

    return { content: result, messages, iterations };
  }

  /** Get the narrative from the last run. */
  getNarrative(): string[] {
    return this.lastExecutor?.getNarrative() ?? [];
  }

  /** Get structured narrative entries from the last run. */
  getNarrativeEntries() {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  /** Get the full execution snapshot from the last run. */
  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }

  /** Get the flowchart spec (stage graph metadata). */
  getSpec(): unknown {
    if (!this.lastSpec) {
      // Build a dummy chart to capture spec
      const { spec } = buildAgentLoop(this.buildConfig(), {
        messages: [],
        subflowMode: true,
      }, { captureSpec: true });
      this.lastSpec = annotateSpecIcons(spec as any);
    }
    return this.lastSpec;
  }

  /** Get conversation history. */
  getMessages(): Message[] {
    return [...this.conversationHistory];
  }

  /** Reset conversation history. */
  resetConversation(): void {
    this.conversationHistory = [];
  }

  /**
   * Build the AgentLoopConfig from runner state.
   * Shared by run() and toFlowChart().
   */
  private buildConfig(): AgentLoopConfig {
    const hasTools = this.registry.size > 0;

    return {
      provider: this.provider,
      systemPrompt: {
        provider: staticPrompt(this.systemPromptText ?? ''),
      },
      messages: {
        strategy: this.memoryConfig?.strategy ?? slidingWindow({ maxMessages: 100 }),
        store: this.memoryConfig?.store,
        conversationId: this.memoryConfig?.conversationId,
      },
      tools: {
        provider: hasTools ? staticTools(this.registry.all()) : noTools(),
      },
      registry: this.registry,
      maxIterations: this.maxIter,
      commitMemory: this.memoryConfig ? {
        store: this.memoryConfig.store,
        conversationId: this.memoryConfig.conversationId,
      } : undefined,
      pattern: this.agentPattern,
    };
  }
}
