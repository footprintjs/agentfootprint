/**
 * Agent — the full ReAct agent flowchart.
 *
 * Flowchart:
 *   SeedScope → PromptAssembly → CallLLM → ParseResponse
 *     → HandleResponse (execute tools or finalize + breakPipeline)
 *     → loopTo('call-llm')
 *
 * Usage:
 *   const agent = Agent.create({ provider: mock([...]) })
 *     .system('You are helpful.')
 *     .tool(searchTool)
 *     .build();
 */

import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { FlowChart as FlowChartType } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import { agentScopeFactory } from '../executor/scopeFactory';
import { annotateSpecIcons } from './specIcons';

import type {
  LLMProvider,
  LLMResponse,
  ToolDefinition,
  AgentConfig,
  AgentResult,
  Message,
  LLMToolDescription,
} from '../types';
import { getTextContent } from '../types/content';
import { userMessage, ADAPTER_PATHS } from '../types';
import type { AgentRecorder } from '../core';
import { RecorderBridge } from '../recorders/v2/RecorderBridge';
import { ToolRegistry } from '../tools';
import { AgentScope } from '../scope';
import { createSeedScopeStage } from '../stages/seedScope';
import { promptAssemblyStage } from '../stages/promptAssembly';
import { createCallLLMStage } from '../stages/callLLM';
import { parseResponseStage } from '../stages/parseResponse';
import { createHandleResponseStage } from '../stages/handleResponse';
import { lastAssistantMessage } from '../memory';

/**
 * Seed stage for subflow-mounted agents.
 * Reads the `message` key from scope (set by parent's inputMapper via SubflowInputMapper).
 */
function createSubflowSeedStage(agentConfig: AgentConfig, registry: ToolRegistry) {
  return (scope: ScopeFacade) => {
    // Read message from scope — set by parent's inputMapper
    const msg = (scope.getValue('message') as string) ?? '';

    if (agentConfig.systemPrompt) {
      AgentScope.setSystemPrompt(scope, agentConfig.systemPrompt);
    }

    const toolDescs: LLMToolDescription[] = registry.formatForLLM(
      agentConfig.toolIds.length > 0 ? agentConfig.toolIds : undefined,
    );
    AgentScope.setToolDescriptions(scope, toolDescs);
    AgentScope.setMessages(scope, [userMessage(msg)]);
    AgentScope.setLoopCount(scope, 0);
    AgentScope.setMaxIterations(scope, agentConfig.maxIterations);
  };
}

export interface AgentOptions {
  readonly provider: LLMProvider;
  readonly name?: string;
}

export class Agent {
  private readonly provider: LLMProvider;
  private readonly agentName: string;
  private systemPrompt?: string;
  private readonly registry = new ToolRegistry();
  private maxIter = 10;
  private readonly recorders: AgentRecorder[] = [];

  private constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.agentName = options.name ?? 'agent';
  }

  static create(options: AgentOptions): Agent {
    return new Agent(options);
  }

  /** Set system prompt. */
  system(prompt: string): this {
    this.systemPrompt = prompt;
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
      this.systemPrompt,
      this.registry,
      this.maxIter,
      [...this.recorders],
    );
  }
}

export class AgentRunner {
  private readonly provider: LLMProvider;
  private readonly name: string;
  private readonly systemPrompt?: string;
  private readonly registry: ToolRegistry;
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private conversationHistory: Message[] = [];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;

  constructor(
    provider: LLMProvider,
    name: string,
    systemPrompt: string | undefined,
    registry: ToolRegistry,
    maxIter: number,
    recorders: AgentRecorder[] = [],
  ) {
    this.provider = provider;
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.registry = registry;
    this.maxIter = maxIter;
    this.recorders = recorders;
  }

  /**
   * Expose the agent's internal flowChart for subflow composition.
   *
   * Returns a chart with the ReAct loop structure:
   *   SeedScope → PromptAssembly → CallLLM → ParseResponse → HandleResponse → loopTo('call-llm')
   *
   * The seed stage reads from `scope.getArgs<{ message: string }>()`.
   * When mounted as a subflow, pass the message via the inputMapper:
   *   .addSubFlowChartNext('sf-agent', runner.toFlowChart(), 'Agent', {
   *     inputMapper: (parentScope) => ({ message: parentScope.getValue('input') }),
   *   })
   */
  toFlowChart(): FlowChartType {
    return this.buildChart('', []);
  }

  /** Run the agent with a user message. Returns the agent's response. */
  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<AgentResult> {
    const chart = this.buildChart(message, this.conversationHistory);
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;

    bridge?.dispatchTurnStart(message);

    const executor = new FlowChartExecutor(chart, { scopeFactory: agentScopeFactory });
    executor.enableNarrative();
    const startMs = Date.now();

    try {
      await executor.run({
        input: { message },
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
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

  /**
   * Build the ReAct loop flowChart.
   * When message is empty (toFlowChart), the seed stage reads from scope.getValue('message')
   * which is set by the parent's inputMapper when mounted as a subflow.
   */
  private buildChart(message: string, existingMessages: Message[]): FlowChartType {
    const agentConfig = {
      name: this.name,
      systemPrompt: this.systemPrompt,
      maxIterations: this.maxIter,
      toolIds: this.registry.ids(),
    };
    const registry = this.registry;

    // When used as subflow, the inputMapper writes { message } to scope.
    // The seed stage reads it from scope if no explicit message was provided.
    const seedStage = message
      ? createSeedScopeStage({
          agentConfig,
          toolRegistry: registry,
          userMsg: message,
          existingMessages,
        })
      : createSubflowSeedStage(agentConfig, registry);

    const callLLM = createCallLLMStage(this.provider);
    const handleResponse = createHandleResponseStage(this.registry);

    const builder = flowChart('SeedScope', seedStage, 'seed-scope')
      .addFunction('PromptAssembly', promptAssemblyStage, 'prompt-assembly')
      .addFunction('CallLLM', callLLM, 'call-llm')
      .addFunction('ParseResponse', parseResponseStage, 'parse-response')
      .addFunction('HandleResponse', handleResponse, 'handle-response')
      .loopTo('call-llm');

    this.lastSpec = annotateSpecIcons(builder.toSpec());
    return builder.build();
  }

  /** Get the flowchart spec (stage graph metadata). */
  getSpec(): unknown {
    if (!this.lastSpec) {
      this.buildChart('', []);
    }
    return this.lastSpec;
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

  /** Get conversation history. */
  getMessages(): Message[] {
    return [...this.conversationHistory];
  }

  /** Reset conversation history. */
  resetConversation(): void {
    this.conversationHistory = [];
  }
}
