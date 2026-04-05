/**
 * Agent builder — fluent API for configuring an agent.
 *
 * Usage:
 *   const agent = Agent.create({ provider })
 *     .system('You are helpful.')
 *     .tool(searchTool)
 *     .build();
 */

import type { ToolDefinition, LLMProvider } from '../../types';
import type { MemoryConfig } from '../../adapters/memory/types';
import type { AgentRecorder, PromptProvider, ToolProvider } from '../../core';
import type { InstructionOverride, AgentInstruction } from '../instructions';
import { ToolRegistry } from '../../tools';
import { AgentPattern } from '../loop';
import { AgentRunner } from './AgentRunner';

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
  private agentPattern: AgentPattern = AgentPattern.Regular;
  private readonly overrides = new Map<string, InstructionOverride>();
  private readonly agentInstructions: AgentInstruction[] = [];
  private initialDecisionScope?: Readonly<Record<string, unknown>>;
  private enableStreaming = false;
  private enableVerboseNarrative = false;

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
   * Overrides `.system()`.
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
   * Overrides `.tool()` / `.tools()`.
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

  /** Enable streaming — tokens emitted incrementally via onToken callback. */
  streaming(enabled = true): this {
    this.enableStreaming = enabled;
    return this;
  }

  /**
   * Enable verbose narrative — full values, no truncation.
   * Shows complete system prompts, tool results, and LLM outputs in the narrative.
   * Enables grounding analysis via getGroundingSources() / getLLMClaims().
   */
  verbose(enabled = true): this {
    this.enableVerboseNarrative = enabled;
    return this;
  }

  /**
   * Set the agent loop pattern.
   * - `AgentPattern.Regular` (default): slots resolve once
   * - `AgentPattern.Dynamic`: all slots re-evaluate each iteration
   */
  pattern(p: AgentPattern): this {
    this.agentPattern = p;
    return this;
  }

  /**
   * Override instructions on a shared tool without modifying the tool definition.
   */
  instructionOverride(toolId: string, override: InstructionOverride): this {
    this.overrides.set(toolId, override);
    return this;
  }

  /**
   * Register an agent-level instruction.
   * Instructions inject into system prompt, tools, and tool-result processing
   * based on the Decision Scope state.
   *
   * @example
   * ```typescript
   * Agent.create({ provider })
   *   .instruction(defineInstruction({
   *     id: 'refund',
   *     activeWhen: (d) => d.orderStatus === 'denied',
   *     prompt: 'Be empathetic.',
   *   }))
   *   .build();
   * ```
   */
  instruction(instr: AgentInstruction<any>): this {
    this.agentInstructions.push(instr);
    return this;
  }

  /** Register multiple agent-level instructions. */
  instructions(instrs: AgentInstruction<any>[]): this {
    for (const i of instrs) this.agentInstructions.push(i);
    return this;
  }

  /**
   * Set the initial Decision Scope values.
   * Tool handlers update these values; InstructionsToLLM reads them
   * to evaluate `activeWhen` predicates.
   *
   * @example
   * ```typescript
   * Agent.create({ provider })
   *   .decision<MyDecision>({ orderStatus: null, riskLevel: 'unknown' })
   *   .instruction(refundInstruction)
   *   .build();
   * ```
   */
  decision<T extends Record<string, unknown> = Record<string, unknown>>(scope: T): this {
    this.initialDecisionScope = scope;
    return this;
  }

  /** Enable persistent conversation memory. */
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
    return new AgentRunner({
      provider: this.provider,
      name: this.agentName,
      systemPromptText: this.systemPromptText,
      registry: this.registry,
      maxIterations: this.maxIter,
      recorders: [...this.recorders],
      memoryConfig: this.memoryConfig,
      pattern: this.agentPattern,
      promptProvider: this.customPromptProvider,
      toolProvider: this.customToolProvider,
      instructionOverrides: this.overrides.size > 0 ? new Map(this.overrides) : undefined,
      agentInstructions: this.agentInstructions.length > 0 ? [...this.agentInstructions] : undefined,
      initialDecision: this.agentInstructions.length > 0 ? this.initialDecisionScope : undefined,
      streaming: this.enableStreaming,
      verboseNarrative: this.enableVerboseNarrative,
    });
  }
}
