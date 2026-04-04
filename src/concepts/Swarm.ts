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
 *
 * Usage:
 *   const swarm = Swarm.create({ provider })
 *     .system('Route to the best specialist.')
 *     .specialist('coding', 'Code specialist', codingAgent)
 *     .specialist('writing', 'Writing specialist', writingAgent)
 *     .build();
 *   const result = await swarm.run('Write a haiku');
 */

import type { LLMProvider, LLMToolDescription } from '../types/llm';
import type { ToolDefinition } from '../types/tools';
import type { RunnerLike, AgentResultEntry, TraversalResult } from '../types/multiAgent';
import type { AgentRecorder } from '../core';
import { FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartType } from 'footprintjs';
import { buildAgentLoop } from '../lib/loop';
import type { AgentLoopConfig } from '../lib/loop';
import { buildSwarmRouting } from '../lib/swarm/buildSwarmRouting';
import type { SwarmSpecialist } from '../lib/swarm/buildSwarmRouting';
import { staticPrompt } from '../providers/prompt/static';
import { slidingWindow } from '../providers/messages/slidingWindow';
import { ToolRegistry } from '../tools';
import { createAgentRenderer } from '../lib/narrative';
import { annotateSpecIcons } from './specIcons';
import type { SpecLike } from './specIcons';
import { userMessage } from '../types';

// ── Types ────────────────────────────────────────────────────

export interface SwarmOptions {
  readonly provider: LLMProvider;
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
    this.provider = options.provider;
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
    this.specialists.push({ id, description, runner });
    return this;
  }

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
  readonly recorders: AgentRecorder[]; // Task 4: wire to executor
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  private readonly narrativeRenderer = createAgentRenderer();

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
    const routing = buildSwarmRouting({
      specialists: this.specialists,
      extraTools: this.extraTools.length > 0 ? this.extraTools : undefined,
    });

    // Tools slot: the tool descriptions go to the LLM so it knows about specialists.
    // We use a custom ToolProvider that returns SlotDecision with the descriptions.
    const toolDescs = this.buildToolDescriptions();
    const toolProvider = {
      resolve: () => ({ value: toolDescs, chosen: 'swarm-specialists' }),
    };

    return {
      provider: this.provider,
      systemPrompt: { provider: staticPrompt(this.buildSystemPrompt()) },
      messages: { strategy: slidingWindow({ maxMessages: 50 }) },
      tools: { provider: toolProvider },
      registry: new ToolRegistry(), // No local tools — specialists are subflows via routing
      maxIterations: this.maxIter,
      streaming: this.streamingEnabled,
      routing,
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
      { messages: message ? [userMessage(message)] : [] },
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

    const executorOpts: Record<string, unknown> = { enrichSnapshots: true };
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

    await executor.run({
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });

    this.lastExecutor = executor;

    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const result = (state.result as string) ?? '';

    // Track which specialists were invoked via scope state
    const invokedSpecialists = (state.specialistResult as string) ? this.specialists.filter((s) => {
      const narrative = this.getNarrative();
      return narrative.some((line) => line.includes(s.id));
    }) : [];

    const agents: AgentResultEntry[] = invokedSpecialists.map((s) => ({
      id: s.id,
      name: s.id,
      content: '',
      latencyMs: 0,
    }));

    return {
      content: result,
      agents,
      totalLatencyMs: Date.now() - startTime,
    };
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
