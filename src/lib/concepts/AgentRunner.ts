/**
 * AgentRunner — executes the agent loop, manages conversation state.
 *
 * Created by Agent.build(). Not instantiated directly.
 */

import { FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type {
  FlowChart as FlowChartType,
  FlowChartExecutorOptions,
  Recorder,
  WriteEvent,
} from 'footprintjs';
import { buildAgentLoop, AgentPattern } from '../loop';
import { PendingFollowUpManager, InstructionRecorder } from '../instructions';
import type { InstructionOverride, AgentInstruction, ResolvedFollowUp } from '../instructions';
import type { DecideFn } from '../call/helpers';
import type { AgentStreamEvent, AgentStreamEventHandler } from '../../streaming';
import { createStreamEventRecorder, EventDispatcher } from '../../streaming';
import type { AgentLoopConfig } from '../loop';
import type { CustomRouteConfig } from './AgentBuilder';
import { createAgentRenderer } from '../narrative';
import { annotateSpecIcons } from '../../concepts/specIcons';
import type { SpecLike } from '../../concepts/specIcons';
import { staticPrompt } from '../../providers/prompt/static';
import { slidingWindow } from '../../providers/messages/slidingWindow';
import { noTools } from '../../providers/tools/noTools';
import { staticTools } from '../../providers/tools/staticTools';
import { ToolRegistry } from '../../tools';
import { lastAssistantMessage } from '../../memory';
import { getTextContent } from '../../types/content';
import { userMessage, toolResultMessage, assistantMessage } from '../../types';
import type { LLMProvider, LLMResponse, AgentResult, Message, ResponseFormat } from '../../types';
import type { MemoryPipeline } from '../../memory/pipeline';
import type { AgentRecorder, PromptProvider, ToolProvider } from '../../core';
import { RecorderBridge } from '../../recorders/RecorderBridge';
import { forwardEmitRecorders } from '../../recorders/forwardEmitRecorders';

/** Captured LLM call with response, runtimeStageId, and evaluation context. */
interface LLMCallCapture {
  response: LLMResponse;
  runtimeStageId: string;
  context: {
    systemPrompt?: string;
    toolDescriptions?: Array<{ name: string; description: string }>;
    messages?: Array<{ role: string; content: unknown }>;
  };
}

/** Options for constructing an AgentRunner. Created by Agent.build(). */
export interface AgentRunnerOptions {
  readonly provider: LLMProvider;
  readonly name: string;
  readonly systemPromptText?: string;
  readonly registry: ToolRegistry;
  readonly maxIterations?: number;
  readonly recorders?: AgentRecorder[];
  readonly memoryPipeline?: MemoryPipeline;
  readonly pattern?: AgentPattern;
  readonly promptProvider?: PromptProvider;
  readonly toolProvider?: ToolProvider;
  readonly instructionOverrides?: ReadonlyMap<string, InstructionOverride>;
  readonly agentInstructions?: readonly AgentInstruction[];
  readonly initialDecision?: Readonly<Record<string, unknown>>;
  readonly streaming?: boolean;
  /** When true, narrative shows full values (no truncation). */
  readonly verboseNarrative?: boolean;
  /** Structured output format — passed through to LLM provider. */
  readonly responseFormat?: ResponseFormat;
  /** Run tool calls within a single turn concurrently. Default: false. */
  readonly parallelTools?: boolean;
  /** User-defined routing branches evaluated before default tool-calls/final. */
  readonly customRoute?: CustomRouteConfig;
  /**
   * Consecutive-identical-failure threshold for escalation. `0` disables.
   * Defaults to `REPEATED_FAILURE_ESCALATION_THRESHOLD` (3) when omitted.
   */
  readonly maxIdenticalFailures?: number;
}

export class AgentRunner {
  private static _autoExecCounter = 0;
  private readonly provider: LLMProvider;
  readonly name: string;
  private readonly systemPromptText?: string;
  private readonly registry: ToolRegistry;
  private readonly maxIter: number;
  private readonly recorders: AgentRecorder[];
  private readonly memoryPipeline?: MemoryPipeline;
  private readonly agentPattern: AgentPattern;
  private readonly customPromptProvider?: PromptProvider;
  private readonly customToolProvider?: ToolProvider;
  private readonly instructionOverrides?: ReadonlyMap<string, InstructionOverride>;
  private readonly agentInstructions?: readonly AgentInstruction[];
  private readonly initialDecision?: Readonly<Record<string, unknown>>;
  private readonly streamingEnabled: boolean;
  private readonly responseFormat?: ResponseFormat;
  private readonly parallelToolsEnabled: boolean;
  private readonly customRoute?: CustomRouteConfig;
  private readonly maxIdenticalFailures?: number;
  private readonly cachedDecideFunctions?: ReadonlyMap<string, DecideFn>;
  private conversationHistory: Message[] = [];
  /**
   * Decision scope carried forward between `.run()` calls. Tool handlers
   * write into `scope.decision` via `decisionUpdate`; without this carry-
   * over, every new turn would see an empty decision and skill-gated
   * tools (autoActivate) would disappear on follow-up messages.
   * `resetConversation()` clears this alongside `conversationHistory` so
   * a fresh conversation really starts fresh. Undefined before the first
   * run — falls back to `initialDecision` from build config.
   */
  private lastDecision?: Readonly<Record<string, unknown>>;
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  private readonly verboseNarrative: boolean;
  private narrativeRenderer = createAgentRenderer();
  /**
   * Persistent observer list for `runner.observe(handler)`. One dispatcher
   * per runner instance — every `.run()` call funnels events through here
   * in addition to any per-run `options.onEvent` callback. Used by Lens,
   * telemetry, and anyone else who wants to watch what the agent does.
   */
  private readonly dispatcher = new EventDispatcher();
  private readonly pendingFollowUps = new PendingFollowUpManager();

  /**
   * Cached charts — built lazily on first use, reused across every
   * `.run()` / `.toFlowChart()` call. Stream events flow through the
   * emit channel (via a per-run `StreamEventRecorder` attached to the
   * executor), so no per-run closure ever lands in chart stages. This
   * lets both standalone and subflow-mode charts be pure static
   * structures.
   */
  private cachedStandaloneChart?: FlowChartType;
  private cachedSubflowChart?: FlowChartType;

  /**
   * Per-run strict follow-up that fired during tool execution. Reset at
   * the start of each `.run()` call so state doesn't leak between turns.
   * Populated by the `onInstructionsFired` callback wired through
   * `buildConfig()`.
   */
  private runStrictFollowUp?: { followUp: ResolvedFollowUp; sourceToolId: string };

  constructor(options: AgentRunnerOptions) {
    this.provider = options.provider;
    this.name = options.name;
    this.systemPromptText = options.systemPromptText;
    this.registry = options.registry;
    this.maxIter = options.maxIterations ?? 10;
    this.recorders = [...(options.recorders ?? [])];
    this.memoryPipeline = options.memoryPipeline;
    this.agentPattern = options.pattern ?? AgentPattern.Regular;
    this.customPromptProvider = options.promptProvider;
    this.customToolProvider = options.toolProvider;
    this.instructionOverrides = options.instructionOverrides;
    this.agentInstructions = options.agentInstructions;
    this.initialDecision = options.initialDecision;
    this.streamingEnabled = options.streaming ?? false;
    this.responseFormat = options.responseFormat;
    this.parallelToolsEnabled = options.parallelTools ?? false;
    this.customRoute = options.customRoute;
    this.maxIdenticalFailures = options.maxIdenticalFailures;
    this.verboseNarrative = options.verboseNarrative ?? false;
    if (this.verboseNarrative) {
      this.narrativeRenderer = createAgentRenderer({ verbose: true });
    }

    // Register instruction tools in the registry ONCE at construction time.
    // Previously done inside buildAgentLoop on every run() — now runs exactly once.
    if (this.agentInstructions?.length) {
      for (const instr of this.agentInstructions) {
        if (instr.tools) {
          for (const tool of instr.tools) {
            if (!this.registry.get(tool.id)) {
              this.registry.register(tool);
            }
          }
        }
      }
    }

    // Pre-compute decideFunctions map from agent-level instruction rules.
    // Functions can't travel through scope (stripped on write), so captured here.
    // Per-tool decide() functions are still collected by buildAgentLoop (they're on the registry).
    if (this.agentInstructions?.length) {
      const decideFns = new Map<string, DecideFn>();
      for (const instr of this.agentInstructions) {
        if (instr.onToolResult) {
          for (const rule of instr.onToolResult) {
            if (rule.decide) decideFns.set(rule.id, rule.decide);
          }
        }
      }
      if (decideFns.size > 0) {
        this.cachedDecideFunctions = decideFns;
      }
    }
  }

  /**
   * Expose the agent's internal flowChart for subflow composition.
   * Cached — built once, reused across all mount sites.
   */
  toFlowChart(): FlowChartType {
    if (!this.cachedSubflowChart) {
      const { chart, spec } = buildAgentLoop(
        this.buildConfig(),
        { messages: [], subflowMode: true },
        { captureSpec: true },
      );
      this.cachedSubflowChart = chart;
      this.lastSpec = annotateSpecIcons(spec as SpecLike);
    }
    return this.cachedSubflowChart;
  }

  /**
   * Lazy-build the standalone chart on first `.run()`. Stream handler
   * flows via a per-run emit recorder attached in `run()` — the chart
   * itself is a pure static structure and is reused forever.
   */
  private getStandaloneChart(): FlowChartType {
    if (!this.cachedStandaloneChart) {
      const { chart, spec } = buildAgentLoop(this.buildConfig(), undefined, {
        captureSpec: true,
      });
      this.cachedStandaloneChart = chart;
      this.lastSpec = annotateSpecIcons(spec as SpecLike);
    }
    return this.cachedStandaloneChart;
  }

  /** Run the agent with a user message. */
  async run(
    message: string,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      /** Full event stream — tool lifecycle, LLM lifecycle, tokens. */
      onEvent?: AgentStreamEventHandler;
      /** @deprecated Use onEvent instead. Ignored if onEvent is also provided. */
      onToken?: (token: string) => void;
      /**
       * Memory identity for this turn. Forwarded to the memory pipeline
       * (if configured via `.memoryPipeline()`). Same agent instance can
       * serve many users by passing different identities per-run.
       * Ignored when the agent has no memory pipeline attached.
       */
      identity?: { tenant?: string; principal?: string; conversationId: string };
      /**
       * Run-local turn counter. Written into `MemoryEntry.source.turn` by
       * the write subflow for cross-turn provenance. Defaults to 1.
       */
      turnNumber?: number;
      /**
       * Context-window token budget hint. Picker stage uses this to bound
       * how much memory it injects. Defaults to 4000.
       */
      contextTokensRemaining?: number;
    },
  ): Promise<AgentResult> {
    // Resolve stream event handler: onEvent takes precedence over onToken.
    const isDevMode = typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production';
    if (options?.onEvent && options?.onToken && isDevMode) {
      console.warn(
        '[agentfootprint] Both onEvent and onToken provided. onToken is ignored when onEvent is set.',
      );
    }
    // Merge persistent observers (from `runner.observe(...)`) with the
    // optional per-run callback. Both see every event. Per-run `onToken`
    // is translated into a `token` event observer for backward compat.
    const perRunHandler: AgentStreamEventHandler | undefined =
      options?.onEvent ??
      (options?.onToken
        ? (e: AgentStreamEvent) => {
            if (e.type === 'token') options.onToken!(e.content);
          }
        : undefined);
    const dispatcher = this.dispatcher;
    const onStreamEvent: AgentStreamEventHandler | undefined =
      dispatcher.size > 0 || perRunHandler
        ? (event: AgentStreamEvent) => {
            dispatcher.dispatch(event);
            if (perRunHandler) {
              try {
                perRunHandler(event);
              } catch {
                /* swallow */
              }
            }
          }
        : undefined;

    onStreamEvent?.({ type: 'turn_start', userMessage: message });

    // Check for pending strict follow-up from previous turn
    const pendingMatch = this.pendingFollowUps.checkAndConsume(message);
    if (pendingMatch) {
      const tool = this.registry.get(pendingMatch.followUp.toolId);
      if (tool) {
        const toolResult = await tool.handler(pendingMatch.followUp.params);
        const autoMessages: Message[] = [
          ...this.conversationHistory,
          userMessage(message),
          assistantMessage(`Using ${pendingMatch.followUp.description}.`, [
            {
              id: `auto-strict-${++AgentRunner._autoExecCounter}`,
              name: pendingMatch.followUp.toolId,
              arguments: pendingMatch.followUp.params,
            },
          ]),
          toolResultMessage(toolResult.content, `auto-strict-${AgentRunner._autoExecCounter}`),
        ];
        this.conversationHistory = autoMessages;
      }
    }

    // With a memory pipeline attached, prior-turn messages come from
    // the pipeline's read subflow. Without memory, fall back to the
    // in-runner conversation history.
    const existingMessages = this.memoryPipeline ? [] : this.conversationHistory;

    // Create bridge for recorder dispatch (before buildAgentLoop so mergedStreamEvent is available)
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;
    const bridgeHandler = bridge?.createStreamEventBridge();
    const mergedStreamEvent: AgentStreamEventHandler | undefined =
      bridgeHandler && onStreamEvent
        ? (event) => {
            bridgeHandler(event);
            onStreamEvent(event);
          }
        : bridgeHandler ?? onStreamEvent;

    // Reset per-run state — must happen BEFORE the cached chart runs,
    // since its onInstructionsFired callback writes into this field.
    this.runStrictFollowUp = undefined;

    // Cached standalone chart — built once on first run(), reused
    // forever. Per-run stream handler flows via a dedicated emit
    // recorder attached below (NOT through the chart's closure).
    const chart = this.getStandaloneChart();

    bridge?.dispatchTurnStart(message);

    const executorOpts: FlowChartExecutorOptions = { enrichSnapshots: true };
    if (mergedStreamEvent && this.streamingEnabled) {
      executorOpts.streamHandlers = {
        onToken: (_streamId: string, token: string) =>
          mergedStreamEvent({ type: 'token', content: token }),
        onStart: () => {},
        onEnd: () => {},
      };
    }
    const executor = new FlowChartExecutor(chart, executorOpts);
    executor.enableNarrative({ renderer: this.narrativeRenderer });
    executor.attachRecorder(new MetricRecorder('metrics'));
    forwardEmitRecorders(executor, this.recorders);

    // Attach the per-run stream event recorder — translates
    // `agentfootprint.stream.*` emits (from CallLLM / Streaming / tool
    // execution stages) back into the user's `{ onEvent }` callback.
    // Bypassing closure capture in the chart is what lets the chart be
    // cached across runs.
    if (mergedStreamEvent) {
      executor.attachEmitRecorder(createStreamEventRecorder(mergedStreamEvent));
    }

    // Capture LLM responses + per-call context during traversal
    const { recorder: llmCaptureRecorder, captures: llmCaptures } =
      this.createLLMCaptureRecorder(bridge);
    if (bridge) {
      executor.attachRecorder(llmCaptureRecorder);
    }

    const startMs = Date.now();

    try {
      // Per-run memory namespace args — user-supplied identity, turn,
      // and context-budget flow to the memory pipeline. Seed args
      // (`seed:*`) ARE threaded through even though closure still
      // carries messages — future-proof for when the cached-chart
      // architecture lands alongside an extensible footprintjs env.
      const runInput: Record<string, unknown> = {
        'seed:userMessage': message,
        'seed:existingMessages': existingMessages,
      };
      // Carry decision scope across turns — if a previous run wrote
      // fields (e.g. `currentSkill` via a tool's `decisionUpdate`),
      // re-seed them so follow-up turns start from the same vantage.
      // `resetConversation()` clears this back to undefined.
      if (this.lastDecision) {
        runInput['seed:initialDecision'] = this.lastDecision;
      }
      if (options?.identity) runInput['memory:identity'] = options.identity;
      if (options?.turnNumber !== undefined) runInput['memory:turnNumber'] = options.turnNumber;
      if (options?.contextTokensRemaining !== undefined) {
        runInput['memory:contextTokensRemaining'] = options.contextTokensRemaining;
      }

      await executor.run({
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        input: runInput,
      });
    } catch (err) {
      this.lastExecutor = executor;
      bridge?.dispatchError('llm', err);
      throw err;
    }

    this.lastExecutor = executor;

    // Check for pause (ask_human tool) — emit turn_end with paused flag, return early
    if (executor.isPaused()) {
      const pauseResult = this.buildResult(executor);
      onStreamEvent?.({
        type: 'turn_end',
        content: '',
        iterations: pauseResult.iterations,
        paused: true,
        reason: 'paused' as const,
      });
      return pauseResult;
    }

    const agentResult = this.buildResult(executor);

    onStreamEvent?.({
      type: 'turn_end',
      content: agentResult.content,
      iterations: agentResult.iterations,
      ...(agentResult.maxIterationsReached && { reason: 'maxIterations' as const }),
    });

    if (bridge) {
      // Dispatch per-iteration LLM calls — each with its own context snapshot
      const perCallMs =
        llmCaptures.length > 0 ? Math.round((Date.now() - startMs) / llmCaptures.length) : 0;
      for (const capture of llmCaptures) {
        bridge.dispatchLLMCall(capture.response, perCallMs, {
          ...capture.context,
          runtimeStageId: capture.runtimeStageId,
        });
      }
      bridge.dispatchTurnComplete(
        agentResult.content,
        agentResult.messages.length,
        agentResult.iterations,
      );
    }

    // Surface strict follow-ups captured by buildConfig's onInstructionsFired.
    this.flushStrictFollowUp();

    return agentResult;
  }

  /**
   * Resume a paused agent (after ask_human tool).
   *
   * Provides the human's response, which becomes the tool result for ask_human.
   * The agent loop continues from where it paused.
   *
   * @example
   * ```typescript
   * const result = await agent.run('Process my refund');
   * if (result.paused) {
   *   const final = await agent.resume('Yes, order ORD-123');
   * }
   * ```
   *
   * Note: `onEvent` streaming is not yet supported on `resume()`.
   * The resumed turn completes without emitting AgentStreamEvents.
   * Use `result.content` and `agent.getNarrative()` for post-resume data.
   */
  // TODO: Add onEvent parameter to resume() for streaming event support
  async resume(humanResponse: string): Promise<AgentResult> {
    const executor = this.lastExecutor;
    if (!executor || !executor.isPaused()) {
      throw new Error('Cannot resume: agent is not paused. Call run() first.');
    }

    const checkpoint = executor.getCheckpoint();
    if (!checkpoint) {
      throw new Error('Cannot resume: no checkpoint available.');
    }

    // Capture LLM calls + context during resume (same factory as run())
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;
    const { recorder: llmCaptureRecorder, captures: llmCaptures } =
      this.createLLMCaptureRecorder(bridge);
    if (bridge) {
      executor.attachRecorder(llmCaptureRecorder);
    }

    const startMs = Date.now();
    await executor.resume(checkpoint, humanResponse);

    if (bridge) {
      const perCallMs =
        llmCaptures.length > 0 ? Math.round((Date.now() - startMs) / llmCaptures.length) : 0;
      for (const capture of llmCaptures) {
        bridge.dispatchLLMCall(capture.response, perCallMs, {
          ...capture.context,
          runtimeStageId: capture.runtimeStageId,
        });
      }
    }

    return this.buildResult(executor);
  }

  /**
   * Create a scope recorder that captures LLM responses + context during traversal.
   * Shared by run() and resume() — eliminates duplication and ensures both paths
   * track runtimeStageId for stream bridge tool events.
   */
  private createLLMCaptureRecorder(bridge: RecorderBridge | null): {
    recorder: Recorder;
    captures: LLMCallCapture[];
  } {
    const captures: LLMCallCapture[] = [];
    let lastSystemPrompt: string | undefined;
    let lastToolDescriptions: Array<{ name: string; description: string }> | undefined;
    let lastMessages: Array<{ role: string; content: unknown }> | undefined;

    const recorder: Recorder = {
      id: '__llm-capture',
      onStageStart(event: { runtimeStageId: string }) {
        // Track current stage runtimeStageId — bridge reads it for stream tool events
        if (bridge) bridge.setToolRuntimeStageId(event.runtimeStageId);
      },
      onWrite(event: WriteEvent) {
        if (event.key === 'systemPrompt' && typeof event.value === 'string') {
          lastSystemPrompt = event.value;
        }
        if (event.key === 'toolDescriptions' && Array.isArray(event.value)) {
          lastToolDescriptions = event.value as Array<{ name: string; description: string }>;
        }
        if (event.key === 'messages' && Array.isArray(event.value)) {
          lastMessages = event.value as Array<{ role: string; content: unknown }>;
        }
        // adapterRawResponse fires AFTER context writes — snapshot context per call
        if (event.key === 'adapterRawResponse' && event.value) {
          captures.push({
            response: event.value as LLMResponse,
            runtimeStageId: event.runtimeStageId,
            context: {
              systemPrompt: lastSystemPrompt,
              toolDescriptions: lastToolDescriptions ? [...lastToolDescriptions] : undefined,
              messages: lastMessages ? [...lastMessages] : undefined,
            },
          });
        }
      },
    };

    return { recorder, captures };
  }

  /** Extract AgentResult from executor state — shared by run() and resume(). */
  private buildResult(executor: FlowChartExecutor): AgentResult {
    if (executor.isPaused()) {
      const cp = executor.getCheckpoint();
      const pausedSnapshot = executor.getSnapshot();
      const pausedMessages = (pausedSnapshot?.sharedState?.messages as Message[]) ?? [];
      this.conversationHistory = pausedMessages;
      // Also persist decision scope on pause so `resume()` picks up where
      // we stopped. Without this, a human-in-the-loop `ask_human` mid-
      // turn would drop any skill context written before the pause.
      const pausedDecision = pausedSnapshot?.sharedState?.decision;
      if (pausedDecision && typeof pausedDecision === 'object') {
        this.lastDecision = { ...(pausedDecision as Record<string, unknown>) };
      }
      return {
        content: '',
        messages: pausedMessages,
        iterations: (executor.getSnapshot()?.sharedState?.loopCount as number) ?? 0,
        paused: true,
        pauseData: cp?.pauseData as { question: string; toolCallId: string } | undefined,
      };
    }

    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const messages = (state.messages as Message[]) ?? [];
    const lastAsst = lastAssistantMessage(messages);
    const result = (state.result as string) ?? (lastAsst ? getTextContent(lastAsst.content) : '');
    const iterations = (state.loopCount as number) ?? 0;
    const maxIterationsReached = state.maxIterationsReached === true;

    this.conversationHistory = messages;
    // Capture the final decision scope so the NEXT `.run()` call re-seeds
    // from here. Tool handlers that wrote `decisionUpdate` (e.g. the
    // auto-generated `read_skill` writing `currentSkill`) stay in scope
    // across turns. Cleared by `resetConversation()`.
    const finalDecision = state.decision;
    if (finalDecision && typeof finalDecision === 'object') {
      this.lastDecision = { ...(finalDecision as Record<string, unknown>) };
    }

    return {
      content: result,
      messages,
      iterations,
      ...(maxIterationsReached && { maxIterationsReached: true }),
    };
  }

  getNarrativeEntries() {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }
  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }

  /**
   * Subscribe to the agent's live stream of events — `turn_start`,
   * `llm_start`/`llm_end`, `tool_start`/`tool_end`, `token` (when
   * streaming), `turn_end`. The returned function unsubscribes.
   *
   * Multiple observers are supported; each gets every event. A throwing
   * observer never propagates — the library error-isolates each call.
   *
   * @example
   * ```ts
   * const stop = agent.observe((e) => {
   *   if (e.type === 'llm_end') metrics.record(e.usage);
   * });
   * // later:
   * stop();
   * ```
   */
  observe(handler: AgentStreamEventHandler): () => void {
    return this.dispatcher.observe(handler);
  }

  getSpec(): unknown {
    if (!this.lastSpec) {
      const { spec } = buildAgentLoop(
        this.buildConfig(),
        { messages: [], subflowMode: true },
        { captureSpec: true },
      );
      this.lastSpec = annotateSpecIcons(spec as SpecLike);
    }
    return this.lastSpec;
  }

  getMessages(): Message[] {
    return [...this.conversationHistory];
  }
  resetConversation(): void {
    this.conversationHistory = [];
    // Clear decision scope too — a new conversation should start with a
    // clean slate, not with a stale `currentSkill` or other decision
    // fields carried from the prior dialogue.
    this.lastDecision = undefined;
  }

  /**
   * Forward a strict follow-up captured during the run to the pending
   * queue. Isolated into a method so TypeScript doesn't narrow the
   * field type to `never` via control-flow from the earlier reset.
   */
  private flushStrictFollowUp(): void {
    const pending = this.runStrictFollowUp;
    if (!pending) return;
    this.pendingFollowUps.setPending({
      followUp: pending.followUp,
      sourceToolId: pending.sourceToolId,
    });
  }

  /**
   * Build the static AgentLoopConfig. Called ONCE by the cached-chart
   * builder (`getStandaloneChart` / `toFlowChart`). Contains no per-run
   * inputs — `onStreamEvent` flows through args per turn, and the
   * `onInstructionsFired` callback writes into `this.runStrictFollowUp`
   * which `run()` resets at each turn's start.
   */
  private buildConfig(): AgentLoopConfig {
    const hasTools = this.registry.size > 0;
    const promptProvider = this.customPromptProvider ?? staticPrompt(this.systemPromptText ?? '');
    const toolsProvider =
      this.customToolProvider ?? (hasTools ? staticTools(this.registry.all()) : noTools());

    return {
      provider: this.provider,
      systemPrompt: { provider: promptProvider },
      messages: {
        // Default windowing — slide to the last 100 messages so long
        // conversations don't blow past the context budget. Consumers
        // can swap this via future API surface if finer control is
        // needed; memoryPipeline handles durable persistence separately.
        strategy: slidingWindow({ maxMessages: 100 }),
      },
      tools: { provider: toolsProvider },
      toolProvider: this.customToolProvider,
      registry: this.registry,
      maxIterations: this.maxIter,
      memoryPipeline: this.memoryPipeline,
      pattern: this.agentPattern,
      instructionOverrides: this.instructionOverrides,
      agentInstructions: this.agentInstructions,
      initialDecision: this.initialDecision,
      decideFunctions: this.cachedDecideFunctions,
      streaming: this.streamingEnabled,
      responseFormat: this.responseFormat,
      parallelTools: this.parallelToolsEnabled,
      ...(this.maxIdenticalFailures !== undefined && {
        maxIdenticalFailures: this.maxIdenticalFailures,
      }),
      routeExtensions: this.customRoute?.branches,
      // No `onStreamEvent` at build time — routed through args per run.
      onInstructionsFired: (toolId, fired) => {
        // Track strict follow-up for this run. `run()` resets
        // `runStrictFollowUp` before each call, so state can't leak
        // across turns even though the callback closure is shared
        // (captured at build time and lives as long as the agent).
        if (!this.runStrictFollowUp) {
          for (const instr of fired) {
            if (instr.resolvedFollowUp?.strict) {
              this.runStrictFollowUp = {
                followUp: instr.resolvedFollowUp,
                sourceToolId: toolId,
              };
              break;
            }
          }
        }
        // Forward to external observers (InstructionRecorder).
        for (const rec of this.recorders) {
          if (rec instanceof InstructionRecorder) rec.recordFirings(toolId, fired);
        }
      },
    };
  }
}
