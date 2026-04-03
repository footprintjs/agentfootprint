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
import { PendingFollowUpManager, InstructionRecorder } from '../instructions';
import type { InstructionOverride } from '../instructions';
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
import type { AgentRecorder, PromptProvider, ToolProvider } from '../../core';
import { RecorderBridge } from '../../recorders/v2/RecorderBridge';

export interface AgentOptions {
  readonly provider: LLMProvider;
  readonly name?: string;
}

export class Agent {
  private readonly provider: LLMProvider;
  private readonly agentName: string;
  private systemPromptText?: string;
  private customPromptProvider?: PromptProvider;
  private readonly registry = new ToolRegistry();
  private customToolProvider?: ToolProvider;
  private maxIter = 10;
  private readonly recorders: AgentRecorder[] = [];
  private memoryConfig?: MemoryConfig;
  private enableStreaming = false;
  private agentPattern: AgentPattern = AgentPattern.Regular;
  private readonly overrides = new Map<string, InstructionOverride>();

  private constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.agentName = options.name ?? 'agent';
  }

  static create(options: AgentOptions): Agent {
    return new Agent(options);
  }

  /** Set system prompt (static — same every iteration). */
  system(prompt: string): this {
    this.systemPromptText = prompt;
    return this;
  }

  /**
   * Set a custom prompt provider (dynamic — can change each iteration).
   *
   * Overrides `.system()`. Use with `AgentPattern.Dynamic` to change the
   * system prompt based on conversation state.
   *
   * @example
   * ```typescript
   * Agent.create({ provider })
   *   .pattern(AgentPattern.Dynamic)
   *   .promptProvider({
   *     resolve: (ctx) => {
   *       const flagged = ctx.history.some(m => m.content?.includes('flagged'));
   *       if (flagged) return { value: escalationPrompt, chosen: 'escalation', rationale: 'flagged order' };
   *       return { value: basicPrompt, chosen: 'standard' };
   *     },
   *   })
   *   .build();
   * ```
   */
  promptProvider(provider: PromptProvider): this {
    this.customPromptProvider = provider;
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

  /**
   * Set a custom tool provider (dynamic — can change each iteration).
   *
   * Overrides `.tool()` / `.tools()`. Use with `AgentPattern.Dynamic` to
   * change available tools based on conversation state.
   *
   * @example
   * ```typescript
   * Agent.create({ provider })
   *   .pattern(AgentPattern.Dynamic)
   *   .toolProvider({
   *     resolve: (ctx) => {
   *       const verified = ctx.messages.some(m => m.content?.includes('verified'));
   *       if (verified) return { value: [...basic, ...admin], chosen: 'elevated', rationale: 'identity verified' };
   *       return { value: basic, chosen: 'basic' };
   *     },
   *     execute: async (call) => { /* ... *\/ },
   *   })
   *   .build();
   * ```
   */
  toolProvider(provider: ToolProvider): this {
    this.customToolProvider = provider;
    return this;
  }

  /** Set max ReAct loop iterations. */
  maxIterations(n: number): this {
    this.maxIter = n;
    return this;
  }

  /**
   * Enable streaming — tokens are emitted incrementally during LLM calls.
   *
   * When enabled, the CallLLM stage uses `provider.chatStream()` and emits
   * tokens via footprintjs StreamCallback. Consumers receive tokens through
   * StreamHandlers on the executor's run() options.
   *
   * @example
   * ```typescript
   * const agent = Agent.create({ provider })
   *   .streaming(true)
   *   .build();
   *
   * const result = await agent.run('hello', {
   *   onToken: (token) => process.stdout.write(token),
   * });
   * ```
   */
  streaming(enabled = true): this {
    this.enableStreaming = enabled;
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
   * Override instructions on a shared tool without modifying the tool definition.
   *
   * @param toolId - The tool whose instructions to override
   * @param override - Suppress, add, or replace instructions
   *
   * @example
   * ```typescript
   * import { sharedInventoryTool } from '@company/tools';
   *
   * Agent.create({ provider })
   *   .tool(sharedInventoryTool)
   *   .instructionOverride('check_inventory', {
   *     suppress: ['low-stock'],
   *     add: [{ id: 'premium-oos', when: ctx => ctx.content.isPremium, inject: 'Premium item.' }],
   *     replace: { 'out-of-stock': { inject: 'Suggest B2B channel.' } },
   *   })
   *   .build();
   * ```
   */
  instructionOverride(toolId: string, override: InstructionOverride): this {
    this.overrides.set(toolId, override);
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
      this.customPromptProvider,
      this.customToolProvider,
      this.overrides.size > 0 ? new Map(this.overrides) : undefined,
      this.enableStreaming,
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
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      /** Callback for streaming tokens — only called when .streaming(true) is enabled. */
      onToken?: (token: string) => void;
    },
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

    // Prompt: custom provider > static text
    const promptProvider = this.customPromptProvider
      ?? staticPrompt(this.systemPromptText ?? '');

    // Tools: custom provider > static registry > no tools
    const toolsProvider = this.customToolProvider
      ?? (hasTools ? staticTools(this.registry.all()) : noTools());

    return {
      provider: this.provider,
      systemPrompt: {
        provider: promptProvider,
      },
      messages: {
        strategy: this.memoryConfig?.strategy ?? slidingWindow({ maxMessages: 100 }),
        store: this.memoryConfig?.store,
        conversationId: this.memoryConfig?.conversationId,
      },
      tools: {
        provider: toolsProvider,
      },
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
        // Forward to any InstructionRecorder in the recorders list
        for (const rec of this.recorders) {
          if (rec instanceof InstructionRecorder) {
            rec.recordFirings(toolId, fired);
          }
        }
      },
    };
  }
}
