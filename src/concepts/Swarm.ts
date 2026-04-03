/**
 * Swarm — multi-agent delegation with specialist subflows.
 *
 * An orchestrator LLM selects which specialist to invoke. Each specialist
 * is mounted as a **lazy subflow** — visible in BTS with drill-down.
 *
 * Flowchart:
 *   Seed → CallLLM → ParseResponse → RouteSpecialist(decider)
 *       ├── 'coding'  → lazy subflow (coding agent's flowchart)
 *       ├── 'writing' → lazy subflow (writing agent's flowchart)
 *       └── 'final'   → Finalize (direct response)
 *     → loopTo('call-llm')
 *
 * After a specialist runs, its result appears as a tool result message.
 * The loop continues — the orchestrator sees the specialist's result and
 * can call another specialist or generate a final answer.
 *
 * Usage:
 *   const swarm = Swarm.create({ provider })
 *     .system('Route to the best specialist.')
 *     .specialist('coding', 'Code specialist', codingAgent)
 *     .specialist('writing', 'Writing specialist', writingAgent)
 *     .build();
 *   const result = await swarm.run('Write a haiku');
 */

import type { LLMProvider } from '../types/llm';
import type { ToolDefinition } from '../types/tools';
import type { RunnerLike, AgentResultEntry, TraversalResult } from '../types/multiAgent';
import type { AgentRecorder } from '../core';
import { FlowChartExecutor, MetricRecorder } from 'footprintjs';
import { buildSwarmLoop } from '../lib/swarm';
import type { SwarmSpecialist } from '../lib/swarm';
import { createAgentRenderer } from '../lib/narrative';

// ── Types ────────────────────────────────────────────────────

export interface SwarmOptions {
  readonly provider: LLMProvider;
  readonly name?: string;
}

// ── Builder ──────────────────────────────────────────────────

export class Swarm {
  private readonly provider: LLMProvider;
  private readonly swarmName: string;
  private systemPrompt?: string;
  private readonly specialists: SwarmSpecialist[] = [];
  private readonly extraTools: ToolDefinition[] = [];
  private readonly recorders: AgentRecorder[] = [];
  private maxIter = 10;

  private constructor(options: SwarmOptions) {
    this.provider = options.provider;
    this.swarmName = options.name ?? 'swarm';
  }

  static create(options: SwarmOptions): Swarm {
    return new Swarm(options);
  }

  system(prompt: string): this {
    this.systemPrompt = prompt;
    return this;
  }

  /**
   * Register a specialist agent.
   *
   * Each specialist is mounted as a **lazy subflow** — only built when the
   * orchestrator LLM selects it. Visible in BTS with drill-down into the
   * specialist's internal flowchart.
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
      this.systemPrompt,
      [...this.specialists],
      [...this.extraTools],
      this.maxIter,
      [...this.recorders],
    );
  }
}

// ── Runner ───────────────────────────────────────────────────

export class SwarmRunner {
  private readonly provider: LLMProvider;
  readonly name: string;
  private readonly systemPrompt?: string;
  private readonly specialists: readonly SwarmSpecialist[];
  private readonly extraTools: readonly ToolDefinition[];
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  private readonly narrativeRenderer = createAgentRenderer();

  constructor(
    provider: LLMProvider,
    name: string,
    systemPrompt: string | undefined,
    specialists: readonly SwarmSpecialist[],
    extraTools: readonly ToolDefinition[],
    maxIter: number,
    recorders: AgentRecorder[] = [],
  ) {
    this.provider = provider;
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.specialists = specialists;
    this.extraTools = extraTools;
    this.maxIter = maxIter;
    this.recorders = recorders;
    void this.recorders; // Reserved for future: recorder attachment on executor
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<TraversalResult> {
    const startTime = Date.now();

    const { chart, spec } = buildSwarmLoop(
      {
        provider: this.provider,
        systemPrompt: this.systemPrompt,
        specialists: this.specialists,
        extraTools: this.extraTools.length > 0 ? this.extraTools : undefined,
        maxIterations: this.maxIter,
      },
      { message },
      { captureSpec: true },
    );
    this.lastSpec = spec;

    const executor = new FlowChartExecutor(chart, { enrichSnapshots: true });
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

    // Determine which specialists were called from narrative
    const narrative = this.getNarrative();
    const agents: AgentResultEntry[] = this.specialists
      .filter((s) => narrative.some((line) => line.includes(s.id)))
      .map((s) => ({ id: s.id, name: s.id, content: '', latencyMs: 0 }));

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

  /**
   * Get the flowchart spec for BTS visualization.
   *
   * Shows the Swarm's own flowchart: Seed → CallLLM → ParseResponse →
   * RouteSpecialist(decider) with specialist lazy subflow branches.
   * Works before run() — builds a dummy chart to capture spec.
   */
  getSpec(): unknown {
    if (!this.lastSpec) {
      const { spec } = buildSwarmLoop(
        {
          provider: this.provider,
          systemPrompt: this.systemPrompt,
          specialists: this.specialists,
          maxIterations: this.maxIter,
        },
        { message: '' },
        { captureSpec: true },
      );
      this.lastSpec = spec;
    }
    return this.lastSpec;
  }
}
