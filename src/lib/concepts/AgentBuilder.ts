/**
 * Agent builder — fluent API for configuring an agent.
 *
 * Usage:
 *   const agent = Agent.create({ provider })
 *     .system('You are helpful.')
 *     .tool(searchTool)
 *     .build();
 */

import type { ToolDefinition, LLMProvider, ResponseFormat } from '../../types';
import type { ModelConfig } from '../../models';
import type { MemoryConfig } from '../../adapters/memory/types';
import type { AgentRecorder, PromptProvider, ToolProvider } from '../../core';
import type { RunnerLike } from '../../types/multiAgent';
import type { InstructionOverride, AgentInstruction } from '../instructions';
import { resolveProvider } from '../../adapters/createProvider';
import { zodToJsonSchema, isZodSchema } from '../../tools/zodToJsonSchema';
import { ToolRegistry } from '../../tools';
import { AgentPattern } from '../loop';
import { AgentRunner } from './AgentRunner';

/**
 * A single user-defined branch in `Agent.route({...})`.
 *
 * The `when` predicate runs BEFORE the default tool-calls/final routing. First match wins.
 * If no user branch matches, the Agent routes as normal (tool-calls if the LLM requested
 * tools, final otherwise).
 *
 * `runner` must be a RunnerLike — any concept (Agent, LLMCall, RAG, Swarm, etc.) or a
 * custom object with `.run(input)`. When the branch fires, the runner executes as a
 * subflow and the returned content replaces the agent's current response.
 */
export interface CustomRouteBranch<TScope = any> {
  /** Predicate evaluated on the agent scope after ParseResponse. First matching branch wins. */
  readonly when: (scope: TScope) => boolean;
  /** Runner to execute when the branch fires. */
  readonly runner: RunnerLike;
  /** Stable id for narrative + recorder dispatch. Auto-generated if omitted. */
  readonly id?: string;
}

export interface CustomRouteConfig<TScope = any> {
  /** User-defined branches, evaluated in order before default tool-calls/final. */
  readonly branches: readonly CustomRouteBranch<TScope>[];
}

export interface AgentOptions {
  /** LLMProvider instance or ModelConfig from anthropic()/openai()/bedrock()/ollama(). */
  readonly provider: LLMProvider | ModelConfig;
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
  private outputResponseFormat?: ResponseFormat;
  private parallelToolsEnabled = false;
  private customRoute?: CustomRouteConfig;

  private constructor(options: AgentOptions) {
    this.provider = resolveProvider(options.provider);
    this.agentName = options.name ?? 'agent';
  }

  /**
   * Create an agent builder.
   *
   * Accepts either an LLMProvider or a ModelConfig from factory functions:
   * ```ts
   * // With ModelConfig (auto-resolved)
   * Agent.create({ provider: anthropic('claude-sonnet-4-20250514') })
   *
   * // With LLMProvider (direct)
   * Agent.create({ provider: new AnthropicAdapter({ model: '...' }) })
   * ```
   */
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
   * Run multiple tool calls within a single turn concurrently via Promise.all.
   *
   * Only beneficial when the LLM requests 2+ independent tool calls in one turn
   * (e.g., "look up customer, orders, and product in parallel"). Results are
   * appended to the conversation in the order the LLM requested them.
   *
   * **Caveat:** decide() functions on tool-level instructions mutate a shared
   * Decision Scope — in parallel mode those mutations are not serialized.
   * If your instructions rely on strict ordering, keep sequential (default).
   *
   * @example
   * ```ts
   * Agent.create({ provider })
   *   .tools([getCustomer, getOrders, getProduct])
   *   .parallelTools(true)
   *   .build();
   * ```
   */
  parallelTools(enabled = true): this {
    this.parallelToolsEnabled = enabled;
    return this;
  }

  /**
   * Register user-defined routing branches evaluated BEFORE the default
   * `tool-calls | final` routing. First matching `when` predicate wins.
   *
   * Useful for injecting escalation paths, safety gates, or bespoke handlers
   * without touching the Agent loop internals. The default tool-calls and
   * final branches still apply when no user branch matches.
   *
   * @example
   * ```ts
   * Agent.create({ provider })
   *   .tool(searchTool)
   *   .route({
   *     branches: [
   *       { id: 'escalate', when: (s) => s.parsedResponse.content.includes('[ESCALATE]'), runner: humanReviewAgent },
   *     ],
   *   })
   *   .build();
   * ```
   */
  route(config: CustomRouteConfig): this {
    this.customRoute = config;
    return this;
  }

  /**
   * Enable verbose narrative — full values, no truncation.
   * Shows complete system prompts, tool results, and LLM outputs in the narrative.
   * Enables grounding analysis via ExplainRecorder.
   */
  verbose(enabled = true): this {
    this.enableVerboseNarrative = enabled;
    return this;
  }

  /**
   * Request structured JSON output matching a schema.
   * Accepts JSON Schema or Zod schema (auto-converted).
   *
   * @param schema - JSON Schema object or Zod schema
   * @param options - Optional: name for the schema, injection position for non-native providers
   *
   * @example
   * ```ts
   * // JSON Schema
   * agent.outputSchema({ type: 'object', properties: { city: { type: 'string' } } })
   *
   * // Zod schema
   * agent.outputSchema(z.object({ city: z.string() }))
   *
   * // Inject in user message (recency window) instead of system prompt
   * agent.outputSchema(z.object({ city: z.string() }), { injection: 'user' })
   * ```
   */
  outputSchema(
    schema: Record<string, unknown>,
    options?: { name?: string; injection?: 'system' | 'user' },
  ): this {
    if (isZodSchema(schema)) {
      schema = zodToJsonSchema(schema as any);
    }
    this.outputResponseFormat = {
      type: 'json_schema',
      schema,
      name: options?.name,
      injection: options?.injection,
    };
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
      agentInstructions:
        this.agentInstructions.length > 0 ? [...this.agentInstructions] : undefined,
      initialDecision: this.agentInstructions.length > 0 ? this.initialDecisionScope : undefined,
      streaming: this.enableStreaming,
      verboseNarrative: this.enableVerboseNarrative,
      responseFormat: this.outputResponseFormat,
      parallelTools: this.parallelToolsEnabled,
      customRoute: this.customRoute,
    });
  }
}
