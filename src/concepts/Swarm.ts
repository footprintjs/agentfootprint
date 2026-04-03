/**
 * Swarm — multi-agent delegation pattern.
 *
 * An orchestrator LLM selects which specialist agent to invoke.
 * Each specialist is mounted as a **subflow** — visible in BTS with drill-down.
 *
 * Flowchart:
 *   Seed → SystemPrompt → Messages → AssemblePrompt → CallLLM → ParseResponse
 *     → RouteSpecialist(decider) → { specialist-A(subflow) | specialist-B(subflow) }
 *     → Finalize
 *
 * The orchestrator LLM decides routing by returning the specialist ID as its response.
 * The decider parses the response and routes to the matching specialist subflow.
 *
 * Unlike the tool-based approach (agentAsTool), specialists as subflows give:
 *   - BTS drill-down into each specialist's internal flowchart
 *   - Narrative showing "Entering specialist-coding subflow"
 *   - Per-specialist timing in the Gantt chart
 *
 * Usage:
 *   const swarm = Swarm.create({ provider })
 *     .system('Route to the best specialist: coding or writing.')
 *     .specialist('coding', 'Code specialist', codingAgent)
 *     .specialist('writing', 'Writing specialist', writingAgent)
 *     .build();
 *   const result = await swarm.run('Write a haiku');
 */

import type { LLMProvider } from '../types';
import type { ToolDefinition } from '../types/tools';
import type { RunnerLike, AgentResultEntry, TraversalResult } from '../types/multiAgent';
import type { AgentRecorder } from '../core';
import type { AgentAsToolConfig } from '../providers/tools/agentAsTool';
import { Agent, AgentRunner } from '.';
import { agentAsTool } from '../providers/tools/agentAsTool';

// ── Types ────────────────────────────────────────────────────

export interface SwarmOptions {
  /** LLM provider for the orchestrator agent. */
  readonly provider: LLMProvider;
  /** Name for the orchestrator. Default: 'swarm'. */
  readonly name?: string;
}

interface SpecialistConfig {
  readonly id: string;
  readonly description: string;
  readonly runner: RunnerLike;
  readonly inputMapper?: AgentAsToolConfig['inputMapper'];
}

// ── Builder ──────────────────────────────────────────────────

export class Swarm {
  private readonly provider: LLMProvider;
  private readonly swarmName: string;
  private systemPrompt?: string;
  private readonly specialists: SpecialistConfig[] = [];
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

  /** Set orchestrator system prompt. */
  system(prompt: string): this {
    this.systemPrompt = prompt;
    return this;
  }

  /**
   * Register a specialist agent that the orchestrator can delegate to.
   *
   * Each specialist is mounted as a **subflow** — visible in BTS with drill-down.
   * The orchestrator LLM calls the specialist as a tool; internally the framework
   * executes the specialist's flowchart as a subflow for full traceability.
   *
   * @param id - Unique specialist identifier (used as tool name for the LLM)
   * @param description - Description shown to the LLM for routing decisions
   * @param runner - The specialist agent (AgentRunner, LLMCallRunner, or any RunnerLike)
   *
   * @example
   * ```typescript
   * const swarm = Swarm.create({ provider })
   *   .specialist('coding', 'Write and review code', codingAgent)
   *   .specialist('writing', 'Creative writing and editing', writingAgent)
   *   .build();
   * ```
   */
  specialist(
    id: string,
    description: string,
    runner: RunnerLike,
    options?: { inputMapper?: AgentAsToolConfig['inputMapper'] },
  ): this {
    this.specialists.push({
      id,
      description,
      runner,
      inputMapper: options?.inputMapper,
    });
    return this;
  }

  /** Register an additional non-agent tool for the orchestrator. */
  tool(toolDef: ToolDefinition): this {
    this.extraTools.push(toolDef);
    return this;
  }

  /** Set max ReAct loop iterations for the orchestrator. */
  maxIterations(n: number): this {
    this.maxIter = n;
    return this;
  }

  /** Attach an AgentRecorder to observe execution events. */
  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  /** Build and return a SwarmRunner. */
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
  private readonly specialists: readonly SpecialistConfig[];
  private readonly extraTools: readonly ToolDefinition[];
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private lastAgentRunner?: AgentRunner;
  private lastSpecialistResults: AgentResultEntry[] = [];

  constructor(
    provider: LLMProvider,
    name: string,
    systemPrompt: string | undefined,
    specialists: readonly SpecialistConfig[],
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
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<TraversalResult> {
    const startTime = Date.now();
    this.lastSpecialistResults = [];

    // Mount specialists as tools that internally run the specialist's flowchart.
    // The specialist's execution is captured via runner.run() which uses
    // FlowChartExecutor internally — full BTS data is available.
    const specialistTools = this.specialists.map((spec) =>
      agentAsTool({
        id: spec.id,
        description: spec.description,
        runner: spec.runner,
        inputMapper: spec.inputMapper,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      }),
    );

    // Build orchestrator agent with specialist tools
    const builder = Agent.create({
      provider: this.provider,
      name: this.name,
    });

    if (this.systemPrompt) builder.system(this.systemPrompt);
    builder.tools([...specialistTools, ...this.extraTools]);
    builder.maxIterations(this.maxIter);
    for (const rec of this.recorders) builder.recorder(rec);

    const orchestrator = builder.build();
    const result = await orchestrator.run(message, options);

    this.lastAgentRunner = orchestrator;

    // Track which specialists were called
    const narrative = orchestrator.getNarrative();
    for (const spec of this.specialists) {
      const wasCalled = narrative.some((line) => line.includes(spec.id));
      if (wasCalled) {
        this.lastSpecialistResults.push({
          id: spec.id,
          name: spec.id,
          content: '',
          latencyMs: 0,
        });
      }
    }

    return {
      content: result.content,
      agents: this.lastSpecialistResults,
      totalLatencyMs: Date.now() - startTime,
    };
  }

  /** Get the narrative from the last run. */
  getNarrative(): string[] {
    return this.lastAgentRunner?.getNarrative() ?? [];
  }

  /** Get structured narrative entries from the last run. */
  getNarrativeEntries() {
    return this.lastAgentRunner?.getNarrativeEntries() ?? [];
  }

  /** Get the full execution snapshot from the last run. */
  getSnapshot() {
    return this.lastAgentRunner?.getSnapshot();
  }

  /**
   * Get the flowchart spec for BTS visualization.
   *
   * The Swarm's flowchart is the orchestrator Agent's flowchart.
   * Specialist subflows are visible when the agent calls specialist tools
   * — the tool execution stage shows the specialist's execution in the narrative.
   */
  getSpec(): unknown {
    if (!this.lastAgentRunner) {
      // Build a dummy orchestrator to get the spec without running
      const builder = Agent.create({ provider: this.provider, name: this.name });
      if (this.systemPrompt) builder.system(this.systemPrompt);
      // Register specialist IDs as dummy tools for spec visualization
      for (const spec of this.specialists) {
        builder.tool({
          id: spec.id,
          description: spec.description,
          inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
          handler: async () => ({ content: '' }),
        });
      }
      for (const t of this.extraTools) builder.tool(t);
      const dummy = builder.build();
      return dummy.getSpec();
    }
    return this.lastAgentRunner.getSpec();
  }
}
