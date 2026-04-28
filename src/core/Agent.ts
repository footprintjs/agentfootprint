/**
 * Agent — v2 ReAct primitive (LLM + tools + iteration loop).
 *
 * Pattern: Builder (GoF) → produces a Runner backed by a footprintjs FlowChart.
 * Role:    Layer-5 primitive (core/). Assembles the 3-slot context
 *          pipeline + callLLM + route decider + tool-calls subflow +
 *          loopTo. Composition nestable anywhere that accepts a Runner.
 * Emits:   Via internal recorders:
 *            agentfootprint.agent.turn_start / turn_end
 *            agentfootprint.agent.iteration_start / iteration_end
 *            agentfootprint.agent.route_decided
 *            agentfootprint.stream.llm_start / llm_end
 *            agentfootprint.stream.tool_start / tool_end
 *            agentfootprint.context.* (via ContextRecorder)
 */

import {
  FlowChartExecutor,
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type PausableHandler,
  type RunOptions,
  type TypedScope,
} from 'footprintjs';
import { isPauseRequest, type RunnerPauseOutcome } from './pause.js';
import { emitCostTick } from './cost.js';
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  PermissionChecker,
  PricingTable,
} from '../adapters/types.js';
import type { ContextRole } from '../events/types.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../conventions.js';
import { defaultCommentaryTemplates } from '../recorders/observability/commentary/commentaryTemplates.js';
import { defaultThinkingTemplates } from '../recorders/observability/thinking/thinkingTemplates.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { costRecorder } from '../recorders/core/CostRecorder.js';
import { permissionRecorder } from '../recorders/core/PermissionRecorder.js';
import { evalRecorder } from '../recorders/core/EvalRecorder.js';
import { memoryRecorder } from '../recorders/core/MemoryRecorder.js';
import { skillRecorder } from '../recorders/core/SkillRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';
import type { InjectionRecord } from '../recorders/core/types.js';
import { buildSystemPromptSlot } from './slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from './slots/buildMessagesSlot.js';
import { buildToolsSlot } from './slots/buildToolsSlot.js';
import { RunnerBase, makeRunId } from './RunnerBase.js';
import type { Tool, ToolRegistryEntry } from './tools.js';

export interface AgentOptions {
  readonly provider: LLMProvider;
  /** Human-friendly name shown in events/metrics. Default: 'Agent'. */
  readonly name?: string;
  /** Stable id used for topology + events. Default: 'agent'. */
  readonly id?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Hard budget on ReAct iterations. Default: 10. Hard cap: 50. */
  readonly maxIterations?: number;
  /**
   * Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
   * after every LLM response (once per ReAct iteration) with per-call
   * and cumulative USD. Run-scoped — the cumulative resets each `.run()`.
   */
  readonly pricingTable?: PricingTable;
  /**
   * Cumulative USD budget per run. With `pricingTable`, Agent emits a
   * one-shot `agentfootprint.cost.limit_hit` (`action: 'warn'`) when
   * cumulative USD crosses this budget. Execution continues — consumers
   * choose whether to abort by listening to the event.
   */
  readonly costBudget?: number;
  /**
   * Permission adapter. When set, the Agent calls
   * `permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
   * `tool.execute()`. Emits `agentfootprint.permission.check` with the
   * decision. On `deny`, the tool is skipped and its result is a
   * synthetic denial string; on `allow` / `gate_open`, execution proceeds
   * normally.
   */
  readonly permissionChecker?: PermissionChecker;
}

export interface AgentInput {
  readonly message: string;
}

export type AgentOutput = string;

/**
 * Internal scope state. Recorders never read this directly — they read
 * the InjectionRecord convention keys + emit events.
 */
interface AgentState {
  userMessage: string;
  history: readonly LLMMessage[];
  iteration: number;
  maxIterations: number;
  finalContent: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnStartMs: number;
  // Populated by slot subflow outputMappers:
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  toolsInjections: readonly InjectionRecord[];
  // Latest LLM response state:
  llmLatestContent: string;
  llmLatestToolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }[];
  // Pause checkpoint — set when a tool calls `pauseHere()`, consumed on resume.
  pausedToolCallId: string;
  pausedToolName: string;
  pausedToolStartMs: number;
  // Cost accounting (only used when pricingTable is set).
  cumTokensInput: number;
  cumTokensOutput: number;
  cumEstimatedUsd: number;
  costBudgetHit: boolean;
}

export class Agent extends RunnerBase<AgentInput, AgentOutput> {
  readonly name: string;
  readonly id: string;
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly maxIterations: number;
  private readonly systemPromptValue: string;
  private readonly registry: readonly ToolRegistryEntry[];
  private readonly pricingTable?: PricingTable;
  private readonly costBudget?: number;
  private readonly permissionChecker?: PermissionChecker;

  /**
   * Voice config — shared by viewers (Lens, ChatThinkKit, CLI tail).
   * `appName` is the active actor in narration ("Chatbot called…").
   * `commentaryTemplates` drives Lens's third-person panel.
   * `thinkingTemplates` drives chat-bubble first-person status.
   * Defaults to bundled English; consumer overrides via builder.
   */
  readonly appName: string;
  readonly commentaryTemplates: Readonly<Record<string, string>>;
  readonly thinkingTemplates: Readonly<Record<string, string>>;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(
    opts: AgentOptions,
    systemPromptValue: string,
    registry: readonly ToolRegistryEntry[],
    voice: {
      readonly appName: string;
      readonly commentaryTemplates: Readonly<Record<string, string>>;
      readonly thinkingTemplates: Readonly<Record<string, string>>;
    },
  ) {
    super();
    this.provider = opts.provider;
    this.name = opts.name ?? 'Agent';
    this.id = opts.id ?? 'agent';
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
    this.maxIterations = clampIterations(opts.maxIterations ?? 10);
    this.systemPromptValue = systemPromptValue;
    this.registry = registry;
    if (opts.pricingTable) this.pricingTable = opts.pricingTable;
    if (opts.costBudget !== undefined) this.costBudget = opts.costBudget;
    if (opts.permissionChecker) this.permissionChecker = opts.permissionChecker;
    this.appName = voice.appName;
    this.commentaryTemplates = voice.commentaryTemplates;
    this.thinkingTemplates = voice.thinkingTemplates;
  }

  static create(opts: AgentOptions): AgentBuilder {
    return new AgentBuilder(opts);
  }

  toFlowChart(): FlowChart {
    return this.buildChart();
  }

  async run(
    input: AgentInput,
    options?: RunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    const executor = this.createExecutor();
    const result = await executor.run({
      input: { message: input.message },
      ...(options ?? {}),
    });
    return this.finalizeResult(executor, result);
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    // Fresh executor — footprintjs 4.17.0+ seeds the runtime from
    // `checkpoint.sharedState` (and nested subflow states) automatically
    // on a fresh executor's `resume()`. No need to retain a paused
    // executor between run/resume.
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Agent:${this.id}`],
    };

    const chart = this.buildChart();
    const executor = new FlowChartExecutor(chart);

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(
      new ContextRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      streamRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      agentRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    if (this.pricingTable) {
      executor.attachCombinedRecorder(
        costRecorder({ dispatcher, getRunContext: getRunCtx }),
      );
    }
    if (this.permissionChecker) {
      executor.attachCombinedRecorder(
        permissionRecorder({ dispatcher, getRunContext: getRunCtx }),
      );
    }
    // Always-on bridges for consumer-emitted domain events.
    executor.attachCombinedRecorder(evalRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(memoryRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(skillRecorder({ dispatcher, getRunContext: getRunCtx }));
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): AgentOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Agent: unexpected result shape — expected final-answer string');
  }

  // ─── Chart assembly ────────────────────────────────────────────

  private buildChart(): FlowChart {
    const provider = this.provider;
    const model = this.model;
    const temperature = this.temperature;
    const maxTokens = this.maxTokens;
    const systemPromptValue = this.systemPromptValue;
    const registry = this.registry;
    const registryByName = new Map(registry.map((e) => [e.name, e.tool] as const));
    const toolSchemas = registry.map((e) => e.tool.schema);
    const maxIterations = this.maxIterations;
    const pricingTable = this.pricingTable;
    const costBudget = this.costBudget;
    const permissionChecker = this.permissionChecker;

    const seed = (scope: TypedScope<AgentState>) => {
      const args = scope.$getArgs<AgentInput>();
      scope.userMessage = args.message;
      scope.history = [{ role: 'user', content: args.message }];
      scope.iteration = 1;
      scope.maxIterations = maxIterations;
      scope.finalContent = '';
      scope.totalInputTokens = 0;
      scope.totalOutputTokens = 0;
      scope.turnStartMs = Date.now();
      scope.systemPromptInjections = [];
      scope.messagesInjections = [];
      scope.toolsInjections = [];
      scope.llmLatestContent = '';
      scope.llmLatestToolCalls = [];
      scope.pausedToolCallId = '';
      scope.pausedToolName = '';
      scope.pausedToolStartMs = 0;
      scope.cumTokensInput = 0;
      scope.cumTokensOutput = 0;
      scope.cumEstimatedUsd = 0;
      scope.costBudgetHit = false;

      typedEmit(scope, 'agentfootprint.agent.turn_start', {
        turnIndex: 0,
        userPrompt: args.message,
      });
    };

    const systemPromptSubflow = buildSystemPromptSlot({
      prompt: systemPromptValue,
      reason: 'Agent.system()',
    });
    const messagesSubflow = buildMessagesSlot();
    const toolsSubflow = buildToolsSlot({ tools: toolSchemas });

    const iterationStart = (scope: TypedScope<AgentState>) => {
      typedEmit(scope, 'agentfootprint.agent.iteration_start', {
        turnIndex: 0,
        iterIndex: scope.iteration,
      });
    };

    const callLLM = async (scope: TypedScope<AgentState>) => {
      const systemPromptInjections =
        (scope.systemPromptInjections as readonly InjectionRecord[]) ?? [];
      const messagesInjections =
        (scope.messagesInjections as readonly InjectionRecord[]) ?? [];
      const iteration = scope.iteration as number;

      const systemPrompt = systemPromptInjections
        .map((r) => r.rawContent ?? '')
        .filter((s) => s.length > 0)
        .join('\n\n');

      const messages = messagesInjections
        .map((r): LLMMessage => ({
          role: r.asRole ?? 'user',
          content: r.rawContent ?? r.contentSummary,
          ...(r.sourceId !== undefined && { toolCallId: r.sourceId }),
        }))
        .filter((m) => m.content.length > 0);

      typedEmit(scope, 'agentfootprint.stream.llm_start', {
        iteration,
        provider: provider.name,
        model,
        systemPromptChars: systemPrompt.length,
        messagesCount: messages.length,
        toolsCount: toolSchemas.length,
        ...(temperature !== undefined && { temperature }),
      });

      const startMs = Date.now();
      const llmRequest = {
        ...(systemPrompt.length > 0 && { systemPrompt }),
        messages,
        ...(toolSchemas.length > 0 && { tools: toolSchemas }),
        model,
        ...(temperature !== undefined && { temperature }),
        ...(maxTokens !== undefined && { maxTokens }),
      };

      // Streaming-first: when the provider implements `stream()` we
      // consume chunk-by-chunk so consumers (Lens commentary, chat
      // UIs) see tokens as they arrive instead of waiting for the
      // full LLM call to finish. Each non-terminal chunk fires
      // `agentfootprint.stream.token` with the token text + index.
      //
      // The terminal chunk SHOULD carry the authoritative
      // `LLMResponse` (toolCalls + usage + stopReason); when it does
      // we use it directly. When it doesn't (older providers, partial
      // implementations) we fall back to `complete()` for the
      // authoritative payload — keeping the ReAct loop deterministic.
      let response: LLMResponse | undefined;
      if (provider.stream) {
        for await (const chunk of provider.stream(llmRequest)) {
          if (chunk.done) {
            if (chunk.response) response = chunk.response;
            break;
          }
          if (chunk.content.length > 0) {
            typedEmit(scope, 'agentfootprint.stream.token', {
              iteration,
              tokenIndex: chunk.tokenIndex,
              content: chunk.content,
            });
          }
        }
      }
      if (!response) {
        // No `stream()` OR stream finished without a response payload.
        response = await provider.complete(llmRequest);
      }
      const durationMs = Date.now() - startMs;

      scope.totalInputTokens = scope.totalInputTokens + response.usage.input;
      scope.totalOutputTokens = scope.totalOutputTokens + response.usage.output;
      scope.llmLatestContent = response.content;
      scope.llmLatestToolCalls = response.toolCalls;

      typedEmit(scope, 'agentfootprint.stream.llm_end', {
        iteration,
        content: response.content,
        toolCallCount: response.toolCalls.length,
        usage: response.usage,
        stopReason: response.stopReason,
        durationMs,
      });

      emitCostTick(scope, pricingTable, costBudget, model, response.usage);
    };

    /** Decides the next branch: 'tool-calls' or 'final'. */
    const routeDecider = (scope: TypedScope<AgentState>): 'tool-calls' | 'final' => {
      const toolCalls = scope.llmLatestToolCalls as readonly { name: string }[];
      const iteration = scope.iteration as number;
      const chosen: 'tool-calls' | 'final' =
        toolCalls.length > 0 && iteration < scope.maxIterations ? 'tool-calls' : 'final';

      typedEmit(scope, 'agentfootprint.agent.route_decided', {
        turnIndex: 0,
        iterIndex: iteration,
        chosen,
        rationale:
          chosen === 'tool-calls'
            ? `LLM requested ${toolCalls.length} tool call(s)`
            : iteration >= scope.maxIterations
              ? 'maxIterations reached — forcing final'
              : 'LLM produced no tool calls — final answer',
      });

      return chosen;
    };

    /**
     * Pausable tool-call handler.
     *
     * `execute` iterates the LLM-requested tool calls. If a tool throws
     * `PauseRequest` via `pauseHere()`, we save the remaining work into
     * scope and return the pause data — footprintjs captures a checkpoint
     * and bubbles it up. The outer `Agent.run()` surfaces it as a
     * `RunnerPauseOutcome`.
     *
     * `resume` is called when the consumer provides the human's answer.
     * We treat that answer as the paused tool's result and append it to
     * history, then continue the ReAct iteration loop.
     */
    const toolCallsHandler: PausableHandler<TypedScope<AgentState>> = {
      execute: async (scope) => {
        const toolCalls = scope.llmLatestToolCalls as readonly {
          readonly id: string;
          readonly name: string;
          readonly args: Readonly<Record<string, unknown>>;
        }[];
        const iteration = scope.iteration as number;
        const newHistory: LLMMessage[] = [...(scope.history as readonly LLMMessage[])];
        // ALWAYS push the assistant turn when there are tool calls — even
        // if the content was empty — so providers (Anthropic, OpenAI) can
        // round-trip the tool_use blocks via `LLMMessage.toolCalls`.
        // Without this, the next iteration's request lacks the assistant
        // turn that initiated the tool call, and the API rejects the
        // following tool_result with "preceding tool_use missing".
        if (scope.llmLatestContent || toolCalls.length > 0) {
          newHistory.push({
            role: 'assistant' as ContextRole,
            content: scope.llmLatestContent ?? '',
            ...(toolCalls.length > 0 && { toolCalls }),
          });
        }
        for (const tc of toolCalls) {
          const tool = registryByName.get(tc.name) as Tool | undefined;
          typedEmit(scope, 'agentfootprint.stream.tool_start', {
            toolName: tc.name,
            toolCallId: tc.id,
            args: tc.args,
            ...(toolCalls.length > 1 && { parallelCount: toolCalls.length }),
          });
          const startMs = Date.now();
          let result: unknown;
          let error: boolean | undefined;
          // Permission gate — when a checker is configured, evaluate BEFORE
          // executing the tool. Emits `permission.check` with the decision.
          // On 'deny', the tool is not executed and its result is a
          // synthetic denial string; on 'allow'/'gate_open', execution
          // proceeds normally (the gate is informational — the consumer's
          // checker is responsible for any gate-open side effects).
          let denied = false;
          if (permissionChecker) {
            try {
              const decision = await permissionChecker.check({
                capability: 'tool_call',
                actor: 'agent',
                target: tc.name,
                context: tc.args,
              });
              typedEmit(scope, 'agentfootprint.permission.check', {
                capability: 'tool_call',
                actor: 'agent',
                target: tc.name,
                result: decision.result,
                ...(decision.policyRuleId !== undefined && { policyRuleId: decision.policyRuleId }),
                ...(decision.rationale !== undefined && { rationale: decision.rationale }),
              });
              if (decision.result === 'deny') {
                denied = true;
                result = `[permission denied: ${decision.rationale ?? 'policy'}]`;
              }
            } catch (permErr) {
              // A checker that throws is treated as deny-by-default. The
              // denial message records the thrown error so consumers can
              // debug policy-adapter failures without losing the run.
              denied = true;
              const msg = permErr instanceof Error ? permErr.message : String(permErr);
              typedEmit(scope, 'agentfootprint.permission.check', {
                capability: 'tool_call',
                actor: 'agent',
                target: tc.name,
                result: 'deny',
                rationale: `permission-checker threw: ${msg}`,
              });
              result = `[permission denied: checker error: ${msg}]`;
            }
          }
          if (!denied) {
            try {
              if (!tool) throw new Error(`Unknown tool: ${tc.name}`);
              result = await tool.execute(tc.args, {
                toolCallId: tc.id,
                iteration,
              });
            } catch (err) {
              if (isPauseRequest(err)) {
                // Commit partial state so resume() can find history intact.
                scope.history = newHistory;
                scope.pausedToolCallId = tc.id;
                scope.pausedToolName = tc.name;
                scope.pausedToolStartMs = startMs;
                // Returning a defined value triggers footprintjs pause —
                // the returned object becomes the checkpoint's pauseData.
                return {
                  toolCallId: tc.id,
                  toolName: tc.name,
                  ...(typeof err.data === 'object' && err.data !== null
                    ? (err.data as Record<string, unknown>)
                    : { data: err.data }),
                };
              }
              error = true;
              result = err instanceof Error ? err.message : String(err);
            }
          }
          const durationMs = Date.now() - startMs;
          typedEmit(scope, 'agentfootprint.stream.tool_end', {
            toolCallId: tc.id,
            result,
            durationMs,
            ...(error === true && { error: true }),
          });
          newHistory.push({
            role: 'tool',
            content: typeof result === 'string' ? result : safeStringify(result),
            toolCallId: tc.id,
            toolName: tc.name,
          });
        }
        scope.history = newHistory;

        typedEmit(scope, 'agentfootprint.agent.iteration_end', {
          turnIndex: 0,
          iterIndex: iteration,
          toolCallCount: toolCalls.length,
        });
        scope.iteration = iteration + 1;
        return undefined; // explicit: no pause, flow continues to loopTo
      },
      resume: (scope, input) => {
        // Consumer-supplied resume input becomes the paused tool's result.
        // The subflow's pre-pause scope is restored automatically by
        // footprintjs 4.17.0 via `checkpoint.subflowStates`, so
        // `scope.history` and `scope.pausedToolCallId` read back cleanly
        // across same-executor AND cross-executor resume.
        const toolCallId = scope.pausedToolCallId as string;
        const toolName = scope.pausedToolName as string;
        const startMs = scope.pausedToolStartMs as number;
        const resultStr =
          typeof input === 'string' ? input : safeStringify(input);
        const newHistory: LLMMessage[] = [
          ...(scope.history as readonly LLMMessage[]),
          {
            role: 'tool',
            content: resultStr,
            toolCallId,
            toolName,
          },
        ];
        scope.history = newHistory;

        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId,
          result: input,
          durationMs: Date.now() - startMs,
        });
        const iteration = scope.iteration as number;
        typedEmit(scope, 'agentfootprint.agent.iteration_end', {
          turnIndex: 0,
          iterIndex: iteration,
          toolCallCount: 1,
        });
        scope.iteration = iteration + 1;
        // Clear pause checkpoint fields.
        scope.pausedToolCallId = '';
        scope.pausedToolName = '';
        scope.pausedToolStartMs = 0;
      },
    };

    const finalStage = (scope: TypedScope<AgentState>) => {
      const iteration = scope.iteration as number;
      scope.finalContent = scope.llmLatestContent as string;

      typedEmit(scope, 'agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: iteration,
        toolCallCount: 0,
      });
      typedEmit(scope, 'agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: scope.finalContent,
        totalInputTokens: scope.totalInputTokens as number,
        totalOutputTokens: scope.totalOutputTokens as number,
        iterationCount: iteration,
        durationMs: Date.now() - (scope.turnStartMs as number),
      });
      // $break terminates the flow BEFORE loopTo fires below, ending
      // the ReAct iteration. Pattern inherited from v1 buildAgentLoop.
      scope.$break();
      return scope.finalContent;
    };

    // Description prefix `Agent:` is a taxonomy marker — consumers
    // (Lens + FlowchartRecorder) detect Agent-primitive subflows via
    // this prefix and flag them as true agent boundaries (separate
    // from LLMCall subflows which use `LLMCall:` prefix).
    return flowChart<AgentState>('Seed', seed, STAGE_IDS.SEED, undefined, 'Agent: ReAct loop')
      .addSubFlowChartNext(SUBFLOW_IDS.SYSTEM_PROMPT, systemPromptSubflow, 'System Prompt', {
        inputMapper: (parent) => ({
          userMessage: parent.userMessage as string | undefined,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sf) => ({ systemPromptInjections: sf.systemPromptInjections }),
      })
      .addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, messagesSubflow, 'Messages', {
        inputMapper: (parent) => ({
          messages: parent.history as readonly LLMMessage[] | undefined,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sf) => ({ messagesInjections: sf.messagesInjections }),
      })
      .addSubFlowChartNext(SUBFLOW_IDS.TOOLS, toolsSubflow, 'Tools', {
        inputMapper: (parent) => ({ iteration: parent.iteration as number | undefined }),
        outputMapper: (sf) => ({ toolsInjections: sf.toolsInjections }),
      })
      .addFunction('IterationStart', iterationStart, 'iteration-start', 'Iteration begin marker')
      .addFunction('CallLLM', callLLM, STAGE_IDS.CALL_LLM, 'LLM invocation')
      .addDeciderFunction('Route', routeDecider, SUBFLOW_IDS.ROUTE, 'ReAct routing')
        .addPausableFunctionBranch('tool-calls', 'ToolCalls', toolCallsHandler, 'Tool execution (pausable via pauseHere)')
        .addFunctionBranch('final', 'Final', finalStage)
        .setDefault('final')
        .end()
      .loopTo(SUBFLOW_IDS.MESSAGES)
      .build();
  }
}

/**
 * Fluent builder. `tool()` accepts any Tool<TArgs, TResult> and registers
 * it by its schema.name. Duplicate names throw at build time.
 */
export class AgentBuilder {
  private readonly opts: AgentOptions;
  private systemPromptValue = '';
  private readonly registry: ToolRegistryEntry[] = [];
  // Voice config — defaults until the consumer calls .appName() /
  // .commentaryTemplates() / .thinkingTemplates(). Stored as plain
  // dicts (Record<string, string>) so the builder doesn't depend on
  // the template-engine modules at compile time; the runtime types
  // come from the agentfootprint barrel exports.
  private appNameValue = 'Chatbot';
  private commentaryOverrides: Readonly<Record<string, string>> = {};
  private thinkingOverrides: Readonly<Record<string, string>> = {};

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  system(prompt: string): this {
    this.systemPromptValue = prompt;
    return this;
  }

  tool<TArgs, TResult>(tool: Tool<TArgs, TResult>): this {
    const name = tool.schema.name;
    if (this.registry.some((e) => e.name === name)) {
      throw new Error(`Agent.tool(): duplicate tool name '${name}'`);
    }
    this.registry.push({ name, tool: tool as unknown as Tool });
    return this;
  }

  /**
   * Set the agent's display name — substituted as `{{appName}}` in
   * commentary + thinking templates. Same place to brand a tenant
   * ("Acme Bot"), distinguish multi-agent roles ("Triage" vs
   * "Reviewer"), or localize ("Asistente"). Default: `'Chatbot'`.
   */
  appName(name: string): this {
    this.appNameValue = name;
    return this;
  }

  /**
   * Override agentfootprint's bundled commentary templates. Spread on
   * top of `defaultCommentaryTemplates`; missing keys fall back. Same
   * `Record<string, string>` shape with `{{vars}}` substitution as
   * the bundled defaults — see `defaultCommentaryTemplates` for the
   * full key list.
   *
   * Use cases: i18n (`'agent.turn_start': 'El usuario...'`), brand
   * voice ("You: {{userPrompt}}"), per-tenant customization.
   */
  commentaryTemplates(templates: Readonly<Record<string, string>>): this {
    this.commentaryOverrides = { ...this.commentaryOverrides, ...templates };
    return this;
  }

  /**
   * Override agentfootprint's bundled thinking templates. Same
   * contract shape as commentary; different vocabulary — first-person
   * status the chat bubble shows mid-call. Per-tool overrides go via
   * `tool.<toolName>` keys (e.g., `'tool.weather': 'Looking up the
   * weather…'`). See `defaultThinkingTemplates` for the full key list.
   */
  thinkingTemplates(templates: Readonly<Record<string, string>>): this {
    this.thinkingOverrides = { ...this.thinkingOverrides, ...templates };
    return this;
  }

  build(): Agent {
    // Resolve the voice config: bundled defaults + consumer overrides.
    // Templates flow through the same barrel exports the rest of the
    // library uses, so a future locale-pack swap is a single import.
    const voice = {
      appName: this.appNameValue,
      commentaryTemplates: { ...defaultCommentaryTemplates, ...this.commentaryOverrides },
      thinkingTemplates: { ...defaultThinkingTemplates, ...this.thinkingOverrides },
    };
    return new Agent(this.opts, this.systemPromptValue, this.registry, voice);
  }
}

function clampIterations(n: number): number {
  if (!Number.isInteger(n) || n < 1) return 1;
  if (n > 50) return 50;
  return n;
}

/**
 * JSON.stringify with circular-ref protection. Tool results are untrusted —
 * a hostile/buggy tool returning a cyclic object must not crash the run.
 * Falls back to '[unstringifiable: <reason>]' so the LLM still sees that
 * the tool ran and produced something unusable.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `[unstringifiable: ${reason}]`;
  }
}
