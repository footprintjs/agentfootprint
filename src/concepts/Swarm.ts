/**
 * Swarm — multi-agent delegation via buildAgentLoop + buildSwarmRouting.
 *
 * An orchestrator LLM selects which specialist to invoke. Each specialist
 * is mounted as a **lazy subflow** — visible in BTS with drill-down.
 *
 * Swarm IS an Agent with a different routing strategy:
 *   Agent:  ... → RouteResponse{tool-calls | final}
 *   Swarm:  ... → RouteSpecialist{specialist-A | specialist-B | swarm-tools | final}
 *
 * Everything upstream (SystemPrompt, Messages, Tools, AssemblePrompt,
 * CallLLM, ParseResponse) is the same Agent loop infrastructure.
 *
 * > "Every feature you add to Agent automatically works in Swarm."
 */

import type { LLMProvider, LLMToolDescription } from '../types/llm';
import type { ModelConfig } from '../models';
import type { ToolDefinition } from '../types/tools';
import type { RunnerLike, AgentResultEntry, TraversalResult } from '../types/multiAgent';
import type { AgentRecorder } from '../core';
import { FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartType, FlowChartExecutorOptions } from 'footprintjs';
import { buildAgentLoop } from '../lib/loop';
import type { AgentLoopConfig } from '../lib/loop';
import { buildSwarmRouting } from '../lib/swarm/buildSwarmRouting';
import type { SwarmSpecialist } from '../lib/swarm/buildSwarmRouting';
import type { RoutingConfig } from '../lib/loop/types';
import { staticPrompt } from '../providers/prompt/static';
import { slidingWindow } from '../providers/messages/slidingWindow';
import { ToolRegistry } from '../tools';
import type { Message } from '../types/messages';
import { createAgentRenderer } from '../lib/narrative';
import { RecorderBridge } from '../recorders/v2/RecorderBridge';
import { annotateSpecIcons } from './specIcons';
import type { SpecLike } from './specIcons';
import { userMessage } from '../types';
import { resolveProvider } from '../adapters/createProvider';

// Specialist ID validation — alphanumeric + hyphens, max 64 chars
const VALID_SPECIALIST_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

// ── Types ────────────────────────────────────────────────────

export interface SwarmOptions {
  /** LLMProvider instance or ModelConfig from anthropic()/openai()/bedrock()/ollama(). */
  readonly provider: LLMProvider | ModelConfig;
  readonly name?: string;
}

// ── Builder ──────────────────────────────────────────────────

export class Swarm {
  private readonly provider: LLMProvider;
  private readonly swarmName: string;
  private systemPromptText?: string;
  private readonly specialists: SwarmSpecialist[] = [];
  private readonly extraTools: ToolDefinition[] = [];
  private readonly recorders: AgentRecorder[] = [];
  private maxIter = 10;
  private streamingEnabled = false;

  private constructor(options: SwarmOptions) {
    this.provider = resolveProvider(options.provider);
    this.swarmName = options.name ?? 'swarm';
  }

  static create(options: SwarmOptions): Swarm {
    return new Swarm(options);
  }

  system(prompt: string): this {
    this.systemPromptText = prompt;
    return this;
  }

  /**
   * Register a specialist agent.
   *
   * Each specialist is mounted as a **lazy subflow** — only built when the
   * orchestrator LLM selects it. Visible in BTS with drill-down.
   */
  specialist(id: string, description: string, runner: RunnerLike): this {
    if (!VALID_SPECIALIST_ID.test(id)) {
      throw new Error(`Invalid specialist ID '${id}'. Must match ${VALID_SPECIALIST_ID}.`);
    }
    this.specialists.push({ id, description, runner });
    return this;
  }

  /** Register a non-specialist tool (calculator, search, etc.) available to the orchestrator. */
  tool(toolDef: ToolDefinition): this {
    this.extraTools.push(toolDef);
    return this;
  }

  maxIterations(n: number): this {
    this.maxIter = n;
    return this;
  }

  streaming(enabled: boolean): this {
    this.streamingEnabled = enabled;
    return this;
  }

  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  build(): SwarmRunner {
    if (this.specialists.length === 0) {
      throw new Error('Swarm requires at least one specialist');
    }
    return new SwarmRunner(
      this.provider,
      this.swarmName,
      this.systemPromptText,
      [...this.specialists],
      [...this.extraTools],
      this.maxIter,
      this.streamingEnabled,
      [...this.recorders],
    );
  }
}

// ── Runner ───────────────────────────────────────────────────

export class SwarmRunner {
  private readonly provider: LLMProvider;
  readonly name: string;
  private readonly systemPromptText?: string;
  private readonly specialists: readonly SwarmSpecialist[];
  private readonly extraTools: readonly ToolDefinition[];
  private readonly maxIter: number;
  private readonly streamingEnabled: boolean;
  readonly recorders: AgentRecorder[];
  private conversationHistory: Message[] = [];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  private readonly narrativeRenderer = createAgentRenderer();

  /** Cached routing config — constructed once, reused across runs. */
  private readonly routingConfig: RoutingConfig;
  /** Cached tool descriptions — constructed once, reused across runs. */
  private readonly toolDescs: LLMToolDescription[];
  /** Cached system prompt — constructed once, reused across runs. */
  private readonly fullSystemPrompt: string;

  constructor(
    provider: LLMProvider,
    name: string,
    systemPromptText: string | undefined,
    specialists: readonly SwarmSpecialist[],
    extraTools: readonly ToolDefinition[],
    maxIter: number,
    streaming: boolean,
    recorders: AgentRecorder[] = [],
  ) {
    this.provider = provider;
    this.name = name;
    this.systemPromptText = systemPromptText;
    this.specialists = specialists;
    this.extraTools = extraTools;
    this.maxIter = maxIter;
    this.streamingEnabled = streaming;
    this.recorders = recorders;

    // Cache at construction time — these don't change between runs
    this.fullSystemPrompt = this.buildSystemPrompt();
    this.toolDescs = this.buildToolDescriptions();
    this.routingConfig = buildSwarmRouting({
      specialists: this.specialists,
      extraTools: this.extraTools.length > 0 ? this.extraTools : undefined,
    });
  }

  /** Build the system prompt with specialist descriptions appended. */
  private buildSystemPrompt(): string {
    const base = this.systemPromptText ?? 'You are an orchestrator. Route to the best specialist.';
    const specialistList = this.specialists
      .map((s) => `- ${s.id}: ${s.description}`)
      .join('\n');
    return `${base}\n\nYou have access to these specialist agents:\n${specialistList}\n\nCall the most appropriate specialist to handle the user's request. When done, respond directly without calling any specialist.`;
  }

  /** Build tool descriptions for specialist + extra tools. */
  private buildToolDescriptions(): LLMToolDescription[] {
    return [
      ...this.specialists.map((s) => ({
        name: s.id,
        description: s.description,
        inputSchema: {
          type: 'object' as const,
          properties: { message: { type: 'string', description: 'The task or question to delegate.' } },
          required: ['message'],
        },
      })),
      ...this.extraTools.map((t) => ({
        name: t.id,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    ];
  }

  /** Build AgentLoopConfig — Swarm uses the same loop as Agent with custom routing. */
  private buildConfig(): AgentLoopConfig {
    const toolDescs = this.toolDescs;
    return {
      provider: this.provider,
      systemPrompt: { provider: staticPrompt(this.fullSystemPrompt) },
      messages: { strategy: slidingWindow({ maxMessages: 50 }) },
      tools: {
        provider: {
          resolve: (_context: unknown) => ({ value: toolDescs, chosen: 'swarm-specialists' }),
        },
      },
      registry: new ToolRegistry(),
      maxIterations: this.maxIter,
      streaming: this.streamingEnabled,
      routing: this.routingConfig,
    };
  }

  /** Expose the swarm's internal flowChart for subflow composition. */
  toFlowChart(): FlowChartType {
    const { chart, spec } = this.buildLoop('');
    this.lastSpec = annotateSpecIcons(spec as SpecLike);
    return chart;
  }

  private buildLoop(message: string) {
    const config = this.buildConfig();
    return buildAgentLoop(
      config,
      {
        messages: message ? [userMessage(message)] : [],
        existingMessages: this.conversationHistory,
      },
      { captureSpec: true },
    );
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number; onToken?: (token: string) => void },
  ): Promise<TraversalResult> {
    const startTime = Date.now();

    const { chart, spec } = this.buildLoop(message);
    this.lastSpec = annotateSpecIcons(spec as SpecLike);

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

    // Wire AgentRecorders via RecorderBridge
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;
    bridge?.dispatchTurnStart(message);

    try {
      await executor.run({
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      this.lastExecutor = executor;
      // Update conversation history with whatever partial state exists
      const partialState = executor.getSnapshot()?.sharedState ?? {};
      const partialMessages = partialState.messages as Message[] | undefined;
      if (partialMessages) this.conversationHistory = partialMessages;
      bridge?.dispatchError('llm', err);
      throw err;
    }

    this.lastExecutor = executor;

    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const result = (state.result as string) ?? '';
    const messages = (state.messages as Message[]) ?? [];

    // Structural specialist tracking — read from scope with runtime validation
    const rawInvoked = state.invokedSpecialists;
    const invokedIds = Array.isArray(rawInvoked) ? rawInvoked.filter((x): x is string => typeof x === 'string') : [];
    const agents: AgentResultEntry[] = invokedIds.map((id) => ({
      id,
      name: id,
      content: '',
      latencyMs: 0,
    }));

    // Update conversation history for multi-turn
    this.conversationHistory = messages;

    // Dispatch recorder events
    bridge?.dispatchTurnComplete(result, messages.length, (state.loopCount as number) ?? 0);

    return {
      content: result,
      agents,
      totalLatencyMs: Date.now() - startTime,
    };
  }

  /** Get conversation history (for multi-turn). */
  getMessages(): Message[] {
    return [...this.conversationHistory];
  }

  /** Reset conversation state for a fresh conversation. */
  resetConversation(): void {
    this.conversationHistory = [];
  }

  getNarrative(): string[] {
    return this.lastExecutor?.getNarrative() ?? [];
  }

  getNarrativeEntries() {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }

  getSpec(): unknown {
    if (!this.lastSpec) {
      const { spec } = this.buildLoop('');
      this.lastSpec = annotateSpecIcons(spec as SpecLike);
    }
    return this.lastSpec;
  }
}
