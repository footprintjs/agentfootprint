/**
 * Swarm — multi-agent handoff pattern.
 *
 * An orchestrator agent that can delegate to specialist agents as tools.
 * Each specialist is registered as a tool via `agentAsTool`. The orchestrator's
 * LLM decides which specialist to invoke based on the conversation.
 *
 * Unlike FlowChart (sequential), Swarm lets the LLM decide routing dynamically.
 *
 * Usage:
 *   const swarm = Swarm.create({ provider: orchestratorLLM })
 *     .system('You are a router. Delegate to specialists.')
 *     .specialist('research', 'Research a topic.', researchAgent)
 *     .specialist('write', 'Write content.', writerAgent)
 *     .build();
 *   const result = await swarm.run('Write about AI');
 */

import type { LLMProvider } from '../types/llm';
import type { ToolDefinition } from '../types/tools';
import type { RunnerLike, AgentResultEntry, TraversalResult } from '../types/multiAgent';
import type { AgentResult } from '../types/agent';
import type { AgentRecorder } from '../core';
import { Agent, AgentRunner } from './Agent';
import { agentAsTool } from '../providers/tools/agentAsTool';
import type { AgentAsToolConfig } from '../providers/tools/agentAsTool';

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

  /** Register a specialist agent that the orchestrator can delegate to. */
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
  private readonly name: string;
  private readonly systemPrompt?: string;
  private readonly specialists: readonly SpecialistConfig[];
  private readonly extraTools: readonly ToolDefinition[];
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private lastAgentRunner?: AgentRunner;
  private lastSpecialistResults: AgentResultEntry[] = [];
  private lastSpec?: unknown;

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

    // Convert specialists to tools
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

    // Build orchestrator agent
    const builder = Agent.create({
      provider: this.provider,
      name: this.name,
    });

    if (this.systemPrompt) builder.system(this.systemPrompt);
    builder.tools([...specialistTools, ...this.extraTools]);
    builder.maxIterations(this.maxIter);
    for (const rec of this.recorders) builder.recorder(rec);

    const orchestrator = builder.build();
    const result: AgentResult = await orchestrator.run(message, options);

    this.lastAgentRunner = orchestrator;
    this.lastSpec = orchestrator.getSpec();

    // Build specialist results from tool calls
    const narrative = orchestrator.getNarrative();
    for (const spec of this.specialists) {
      // Check if this specialist was called by looking at narrative
      const wasCalled = narrative.some((line) => line.includes(spec.id));
      if (wasCalled) {
        this.lastSpecialistResults.push({
          id: spec.id,
          name: spec.id,
          content: '', // Content is embedded in the tool result
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

  /** Get the flowchart spec (stage graph metadata). */
  getSpec(): unknown {
    if (!this.lastSpec) {
      // Build orchestrator to capture spec without executing
      const builder = Agent.create({
        provider: this.provider,
        name: this.name,
      });
      if (this.systemPrompt) builder.system(this.systemPrompt);
      // Register specialist tools (with dummy signal/timeout since we only need the spec)
      const specialistTools = this.specialists.map((spec) =>
        agentAsTool({
          id: spec.id,
          description: spec.description,
          runner: spec.runner,
          inputMapper: spec.inputMapper,
        }),
      );
      builder.tools([...specialistTools, ...this.extraTools]);
      builder.maxIterations(this.maxIter);
      const orchestrator = builder.build();
      this.lastSpec = orchestrator.getSpec();
    }
    return this.lastSpec;
  }

  /** Get the narrative from the last run. */
  getNarrative(): string[] {
    return this.lastAgentRunner?.getNarrative() ?? [];
  }

  /** Get the full execution snapshot from the last run. */
  getSnapshot() {
    return this.lastAgentRunner?.getSnapshot();
  }
}
