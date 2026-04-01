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

import { FlowChartExecutor } from 'footprintjs';
import type { FlowChart as FlowChartType } from 'footprintjs';
import { agentScopeFactory } from '../../executor/scopeFactory';
import { buildAgentLoop } from '../loop';
import type { AgentLoopConfig } from '../loop';
import { annotateSpecIcons } from '../../concepts/specIcons';
import { staticPrompt } from '../../providers/prompt/static';
import { slidingWindow } from '../../providers/messages/slidingWindow';
import { noTools } from '../../providers/tools/noTools';
import { staticTools } from '../../providers/tools/staticTools';
import { ToolRegistry } from '../../tools';
import { AGENT_PATHS } from '../../scope/AgentScope';
import { lastAssistantMessage } from '../../memory';
import { getTextContent } from '../../types/content';
import { userMessage, ADAPTER_PATHS } from '../../types';
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
    );
  }
}

export class AgentRunner {
  private readonly provider: LLMProvider;
  /** Agent name — used for spec annotations and narrative labeling. */
  readonly name: string;
  private readonly systemPromptText?: string;
  private readonly registry: ToolRegistry;
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private readonly memoryConfig?: MemoryConfig;
  private conversationHistory: Message[] = [];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;

  constructor(
    provider: LLMProvider,
    name: string,
    systemPromptText: string | undefined,
    registry: ToolRegistry,
    maxIter: number,
    recorders: AgentRecorder[] = [],
    memoryConfig?: MemoryConfig,
  ) {
    this.provider = provider;
    this.name = name;
    this.systemPromptText = systemPromptText;
    this.registry = registry;
    this.maxIter = maxIter;
    this.recorders = recorders;
    this.memoryConfig = memoryConfig;
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
    // When memory store is configured, don't pass existingMessages —
    // the Messages slot's LoadHistory stage loads from store directly.
    const existingMessages = this.memoryConfig?.store ? [] : this.conversationHistory;

    const { chart, spec } = buildAgentLoop(this.buildConfig(), {
      messages: message ? [userMessage(message)] : [],
      existingMessages,
    }, { captureSpec: true });
    this.lastSpec = annotateSpecIcons(spec as any);
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;

    bridge?.dispatchTurnStart(message);

    const executor = new FlowChartExecutor(chart, { scopeFactory: agentScopeFactory });
    executor.enableNarrative();
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
    const messages = (state[AGENT_PATHS.MESSAGES] as Message[]) ?? [];
    const lastAsst = lastAssistantMessage(messages);
    const result = (state[AGENT_PATHS.RESULT] as string) ?? (lastAsst ? getTextContent(lastAsst.content) : '');
    const iterations = (state[AGENT_PATHS.LOOP_COUNT] as number) ?? 0;

    // Dispatch recorder events
    if (bridge) {
      const response = state[ADAPTER_PATHS.RESPONSE] as LLMResponse | undefined;
      if (response) {
        bridge.dispatchLLMCall(response, Date.now() - startMs);
      }
      bridge.dispatchTurnComplete(result, messages.length, iterations);
    }

    // Persist conversation history for multi-turn
    this.conversationHistory = messages;

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
    };
  }
}
