/**
 * Loop assembler — builds the full agent ReAct loop flowchart.
 *
 * Mounts the three API slots as subflows, then wires CallLLM → ParseResponse →
 * RouteResponse (decider) with branches for tool execution and finalization.
 *
 * Supports two loop patterns (AgentPattern enum):
 *
 * Regular ReAct (default): loopTo('call-llm')
 *   Seed → [sf-system-prompt] → [sf-messages] → [sf-tools]
 *     → AssemblePrompt → CallLLM → ParseResponse
 *     → RouteResponse(decider) → [CommitMemory?] → loopTo('call-llm')
 *   Slots resolve ONCE before the loop.
 *
 * Dynamic ReAct: loopTo('sf-instructions-to-llm' or 'sf-system-prompt')
 *   Same flowchart, but loop jumps back to InstructionsToLLM (when configured)
 *   or SystemPrompt. All slots re-evaluate each iteration.
 *   Uses arrayMerge: ArrayMergeMode.Replace on Messages/Tools outputMappers
 *   so arrays are overwritten (not concatenated) on each iteration.
 *
 * Design choices:
 *   - Seed stage initializes loopCount + maxIterations + messages
 *   - Slot subflows use arrayMerge: Replace to avoid stale array accumulation
 *   - Each slot is ALWAYS a subflow — zero overhead, free drill-down + narrative
 *   - RouteResponse is a proper decider — visible in flowchart as diamond with branches
 *   - Tool execution is a subflow — enables drill-down in BTS
 *   - Chart is self-contained — no wrapping needed
 */

import { flowChart, decide } from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';
import type { FlowChart } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import type { RoutingBranch } from './types';
import type { Message } from '../../types/messages';
import { systemMessage, userMessage } from '../../types/messages';
import { buildSystemPromptSubflow } from '../slots/system-prompt';
import { buildMessagesSubflow } from '../slots/messages';
import { buildToolsSubflow } from '../slots/tools';
import type { TypedScope } from 'footprintjs';
import { createCallLLMStage } from '../call/callLLMStage';
import { createStreamingCallLLMStage } from '../call/streamingCallLLMStage';
import { parseResponseStage } from '../call/parseResponseStage';
import { buildToolExecutionSubflow } from '../call/toolExecutionSubflow';
import { getTextContent } from '../../types/content';
import { lastAssistantMessage } from '../../memory';
import { mountMemoryRead, mountMemoryWrite } from '../../memory/wire/mountMemoryPipeline';
import { AgentPattern } from './types';
import type { AgentLoopConfig, AgentLoopSeedOptions, RoutingConfig } from './types';
import { applyInstructionOverrides, buildInstructionsToLLMSubflow } from '../instructions';
import type { LLMInstruction, InstructedToolDefinition } from '../instructions';
import type { RunnerLike } from '../../types/multiAgent';
import { assistantMessage } from '../../types/messages';

// ── Default Agent Routing ─────────────────────────────────────────────────────

/**
 * Default routing for the Agent loop: tool-calls | final.
 *
 * Expressed as a RoutingConfig so buildAgentLoop has ONE code path
 * for both Agent and Swarm routing.
 *
 * The `final` branch is a SUBFLOW that owns its own post-work:
 * Finalize → (optional commit / memory-write) → Break. This keeps
 * branch-specific work inside the branch — no post-decider trailing
 * stages gated on flags. Tool-calls is a separate branch with its own
 * subflow.
 */
function defaultAgentRouting(
  toolExecutionSubflow: FlowChart,
  finalBranchSubflow: FlowChart,
): RoutingConfig {
  return {
    deciderName: 'RouteResponse',
    deciderId: 'route-response',
    deciderDescription: 'Route to tool execution or finalization based on LLM response',
    // Filter-form decide() — captures structured evidence
    // `{ key: 'hasToolCalls', op: 'eq', threshold: true, actual: ..., result: ... }`
    // on FlowRecorder.onDecision (and the commit log's decision record),
    // which is what explainability consumers query post-hoc.
    //
    // ParseResponse lifts `parsedResponse.hasToolCalls` to the flat
    // `scope.hasToolCalls` field so we can use filter form — v1 filter
    // DSL is flat-keys-only, no nested access.
    //
    // Returns the full DecisionResult (NOT `.branch`): DeciderHandler
    // recognizes the DECISION_RESULT symbol brand and extracts evidence.
    // Returning a bare string would drop the evidence entirely.
    decider: (scope: any) =>
      decide(
        scope,
        [
          {
            when: { hasToolCalls: { eq: true } },
            then: 'tool-calls',
            label: 'LLM requested tool calls — execute them',
          },
        ],
        'final',
      ),
    branches: [
      {
        id: 'tool-calls',
        kind: 'subflow',
        chart: toolExecutionSubflow,
        name: 'ExecuteTools',
        mount: {
          inputMapper: (parent: Record<string, unknown>) => ({
            parsedResponse: parent.parsedResponse,
            currentMessages: parent.messages,
            currentLoopCount: parent.loopCount,
            maxIterations: parent.maxIterations,
            ...(parent.decision ? { currentDecision: parent.decision } : {}),
          }),
          outputMapper: (sfOutput: Record<string, unknown>) => ({
            messages: sfOutput.toolResultMessages,
            loopCount: sfOutput.updatedLoopCount,
            ...(sfOutput.updatedDecision ? { decision: sfOutput.updatedDecision } : {}),
          }),
        },
      },
      {
        id: 'final',
        kind: 'subflow',
        chart: finalBranchSubflow,
        name: 'Finalize',
        mount: {
          inputMapper: (parent: Record<string, unknown>) => ({
            messages: parent.messages,
            maxIterations: parent.maxIterations,
            maxIterationsReached: parent.maxIterationsReached,
            identity: parent.identity,
            turnNumber: parent.turnNumber,
            contextTokensRemaining: parent.contextTokensRemaining,
          }),
          outputMapper: (sf: Record<string, unknown>) => ({
            result: sf.result,
          }),
          // Inner Break at end of subflow → parent $break, ending the loop.
          propagateBreak: true,
        },
      },
    ],
    defaultBranch: 'final',
  };
}

/**
 * Build the `final` branch subflow. This subflow runs exclusively on
 * the final branch — tool-calls iterations never enter it — so its
 * stages run only once per `.run()` and are unconditional. Structure:
 *
 *   Finalize → [PackageForWrite + sf-memory-write]? → Break
 *
 * Finalize writes `result`. The optional middle stages persist the turn
 * when `memoryPipeline.write` is configured. Break terminates the loop;
 * the subflow mount's `propagateBreak: true` lifts it into the parent.
 */
function buildFinalBranchSubflow(config: AgentLoopConfig): FlowChart {
  let b = flowChart<AgentLoopState>(
    'Finalize',
    finalizeStage,
    'finalize',
    undefined,
    'Extract final answer from last assistant message',
  );

  if (config.memoryPipeline?.write) {
    b = b.addFunction(
      'PackageForWrite',
      (scope: TypedScope<AgentLoopState>) => {
        const msgs = scope.messages ?? [];
        scope.newMessages = msgs.filter((m) => m.role !== 'system');
      },
      'package-for-write',
      'Package messages for the memory write subflow',
    );
    // Delegates to the `mountMemoryWrite` wire helper — defaults match
    // the scope field names used above (identity/turnNumber/contextTokensRemaining/newMessages).
    b = mountMemoryWrite(b, { pipeline: config.memoryPipeline });
  }

  b = b.addFunction(
    'Break',
    (scope: TypedScope<AgentLoopState>) => scope.$break(),
    'break',
    'Terminate the agent loop',
  );

  return b.build();
}

/**
 * Finalize stage — write the final answer into scope.result.
 *
 * Pure data work: extracts text from the last assistant message and
 * writes `result`. No loop control — the final-branch subflow's Break
 * stage owns termination.
 *
 * Also emits `agentfootprint.agent.turn_complete` on the emit channel,
 * mirroring the existing `agentfootprint.llm.request/response` events
 * emitted by CallLLM. Gives external consumers a structured turn-end
 * signal with the reason (natural vs forced) and iteration count.
 */
const finalizeStage = (scope: TypedScope<AgentLoopState>) => {
  const messages = scope.messages ?? [];
  const lastAsst = lastAssistantMessage(messages);
  const lastAsstText = lastAsst ? getTextContent(lastAsst.content) : '';

  const exhausted = scope.maxIterationsReached === true;
  if (exhausted) {
    const maxIter = scope.maxIterations ?? 10;
    scope.result =
      lastAsstText ||
      `Agent stopped after ${maxIter} iterations without a final answer. The LLM may be stuck in a tool-error retry loop — check the execution trace.`;
  } else {
    scope.result = lastAsstText;
  }

  scope.$emit('agentfootprint.agent.turn_complete', {
    iterations: scope.loopCount ?? 0,
    reason: exhausted ? 'max_iterations' : 'final',
    resultLength: (scope.result ?? '').length,
  });
};

/**
 * Well-known scope key for the user message in subflow mode.
 * Parent charts must set this key in their inputMapper:
 * `inputMapper: (p) => ({ message: p.userMessage })`
 */
export const SUBFLOW_MESSAGE_KEY = 'message';

/**
 * Build the full agent loop flowchart from config.
 *
 * Returns a self-contained FlowChart ready for FlowChartExecutor.
 * Includes a Seed stage that initializes scope with the provided messages.
 *
 * Usage:
 * ```typescript
 * const chart = buildAgentLoop(config, { messages: [userMessage('hello')] });
 * const executor = new FlowChartExecutor(chart);
 * await executor.run();
 * ```
 */
export interface AgentLoopBuild {
  chart: FlowChart;
}

export interface AgentLoopResult extends AgentLoopBuild {
  spec: unknown;
}

export function buildAgentLoop(
  config: AgentLoopConfig,
  seed?: AgentLoopSeedOptions,
): AgentLoopBuild;
export function buildAgentLoop(
  config: AgentLoopConfig,
  seed: AgentLoopSeedOptions | undefined,
  options: { captureSpec: true },
): AgentLoopResult;
export function buildAgentLoop(
  config: AgentLoopConfig,
  seed?: AgentLoopSeedOptions,
  options?: { captureSpec: boolean },
): AgentLoopBuild | AgentLoopResult {
  validateConfig(config);

  const maxIterations = config.maxIterations ?? 10;
  const seedMessages = seed?.messages ?? [];
  const existingMessages = seed?.existingMessages ?? [];
  const subflowMode = seed?.subflowMode ?? false;

  // Build slot subflows
  const systemPromptSubflow = buildSystemPromptSubflow(config.systemPrompt);
  const messagesSubflow = buildMessagesSubflow(config.messages);
  const toolsSubflow = buildToolsSubflow(config.tools);

  // Build instruction config from registry — collect tools that have instructions
  // Apply agent-level overrides if provided
  const instructionsByToolId = new Map<string, readonly LLMInstruction[]>();
  for (const tool of config.registry.all()) {
    const instructed = tool as InstructedToolDefinition;
    if (instructed.instructions?.length) {
      const override = config.instructionOverrides?.get(tool.id);
      if (override) {
        instructionsByToolId.set(
          tool.id,
          applyInstructionOverrides(instructed.instructions, override),
        );
      } else {
        instructionsByToolId.set(tool.id, instructed.instructions);
      }
    }
  }

  // Instruction tool registration is done by AgentRunner constructor (not here).
  // decideFunctions are pre-computed and passed via config.decideFunctions.
  const hasAgentInstructions = config.agentInstructions && config.agentInstructions.length > 0;

  // Build a fresh local map: start from pre-computed agent-level functions, add per-tool ones.
  // Uses a local copy — never mutates the cached config.decideFunctions.
  const decideFunctions = new Map<string, import('../call/helpers').DecideFn>(
    config.decideFunctions ?? [],
  );
  for (const [, instructions] of instructionsByToolId) {
    for (const instr of instructions) {
      if (instr.decide && !decideFunctions.has(instr.id)) {
        decideFunctions.set(instr.id, instr.decide);
      }
    }
  }

  // Strict follow-up tracking is now OWNED BY THE CALLER. buildAgentLoop
  // doesn't buffer state between runs — consumers (AgentRunner) implement
  // `config.onInstructionsFired` to track strict firings in their own
  // per-run state. This lets the chart be built ONCE and reused across
  // many `.run()` calls without state leaking between turns.
  const onInstructionsFired = config.onInstructionsFired;

  // Build call stages. Stream lifecycle events flow through the emit
  // channel (see callLLMStage / streamingCallLLMStage) — no closure
  // capture of per-run stream handlers. AgentRunner attaches a
  // StreamEventRecorder per-run to forward emits to the user callback.
  const callLLM = config.streaming
    ? createStreamingCallLLMStage(config.provider, {
        responseFormat: config.responseFormat,
      })
    : createCallLLMStage(config.provider, {
        responseFormat: config.responseFormat,
      });
  const toolExecutionSubflow = buildToolExecutionSubflow({
    registry: config.registry,
    toolProvider: config.toolProvider,
    parallel: config.parallelTools === true,
    ...(config.maxIdenticalFailures !== undefined && {
      maxIdenticalFailures: config.maxIdenticalFailures,
    }),
    // Always pass instruction config — even without build-time instructions,
    // tool handlers can return runtime instructions/followUps. The
    // `onStreamEvent` inside is populated by toolExecutionSubflow's own
    // stage wrapper as a scope-emit adapter.
    instructionConfig: {
      instructionsByToolId,
      onInstructionsFired,
      decideFunctions: decideFunctions.size > 0 ? decideFunctions : undefined,
      agentResponseRules: hasAgentInstructions
        ? config.agentInstructions!.flatMap((i) => i.onToolResult ?? [])
        : undefined,
    },
  });

  // Two distinct Seed stage implementations — no runtime boolean.
  // The flowchart is built differently for standalone vs subflow composition.
  //
  // Per-run data (the user's message, accumulated conversation history)
  // flows in through `scope.$getArgs()` — NOT through closure captures of
  // `seedMessages` / `existingMessages`. This lets AgentRunner build the
  // chart ONCE at construction and pass new inputs via `run({ input })`
  // every turn, instead of rebuilding the whole chart per call.
  //
  // Back-compat: if `seed.messages` / `seed.existingMessages` are
  // provided AND args don't override, the closure values are still used
  // so existing single-shot tests keep working.
  const initialDecision = config.initialDecision ?? {};

  const seedStandalone = (scope: TypedScope<AgentLoopState>) => {
    const args = scope.$getArgs<Record<string, unknown>>() ?? {};
    const argUserMessage = args['seed:userMessage'] as string | undefined;
    const argExisting = args['seed:existingMessages'] as Message[] | undefined;
    const argMessages = args['seed:messages'] as Message[] | undefined;
    // Carry-over decision scope from the caller's previous run. When the
    // agent is reused across multiple `.run()` calls (multi-turn chat),
    // decision fields written by tools on turn N should still be visible
    // on turn N+1 — otherwise skill-gated tool visibility (autoActivate)
    // resets between turns and the LLM silently loses its active skill.
    // See AgentRunner.lastDecision for the capture side.
    const argSeedDecision = args['seed:initialDecision'] as Record<string, unknown> | undefined;

    const effectiveExisting = argExisting ?? existingMessages;
    const effectiveIncoming =
      argMessages !== undefined
        ? argMessages
        : argUserMessage !== undefined
        ? argUserMessage
          ? [userMessage(argUserMessage)]
          : []
        : seedMessages;

    scope.messages = [...effectiveExisting, ...effectiveIncoming];
    scope.loopCount = 0;
    scope.maxIterations = maxIterations;
    if (hasAgentInstructions) {
      scope.decision = { ...(argSeedDecision ?? initialDecision) };
    }
  };

  const seedSubflow = (scope: TypedScope<AgentLoopState>) => {
    // In subflow mode the parent's inputMapper pipes the user turn
    // through `scope.message` — that's the contract for mounting agent
    // loops inside other flowcharts (FlowChart/Conditional/Swarm specs).
    const msg = scope.message ?? '';
    scope.messages = msg ? [userMessage(msg)] : [];
    scope.loopCount = 0;
    scope.maxIterations = maxIterations;
    if (hasAgentInstructions) {
      scope.decision = { ...initialDecision };
    }
  };

  const seedStage = subflowMode ? seedSubflow : seedStandalone;

  let builder = flowChart<AgentLoopState>(
    'Seed',
    seedStage,
    'seed',
    undefined,
    'Initialize agent loop state',
  );

  // ── Memory pipeline: read-side mount ────────────────────────
  //
  // Mounted BEFORE the loop body so both Regular (`call-llm`) and
  // Dynamic (`sf-system-prompt` / `sf-instructions-to-llm`) loop targets
  // skip over it on re-entry. Memory context is a per-TURN concern —
  // the store doesn't change mid-turn, so re-reading on every iteration
  // is pure waste. Runs exactly once per `.run()`.
  //
  // A small MemorySeed stage runs first to copy identity / turnNumber /
  // contextTokensRemaining from `scope.$getArgs()` into scope state.
  // The subflow itself reads from parent scope via inputMapper, loads
  // relevant entries from the store, picks what fits the budget, and
  // writes `memoryInjection` (system messages) back for AssemblePrompt
  // to prepend.
  if (config.memoryPipeline) {
    const memoryPipeline = config.memoryPipeline;

    builder = builder.addFunction(
      'MemorySeed',
      (scope: TypedScope<AgentLoopState>) => {
        const args = scope.$getArgs<Record<string, unknown>>() ?? {};
        const identity = args['memory:identity'] as AgentLoopState['identity'] | undefined;
        const turnNumber = args['memory:turnNumber'] as number | undefined;
        const budget = args['memory:contextTokensRemaining'] as number | undefined;

        if (!identity && isDevMode()) {
          console.warn(
            '[agentfootprint] .memoryPipeline() used without identity — falling back to ' +
              '{ conversationId: "default" }. Pass `run(msg, { identity: { conversationId, ... } })` ' +
              'to scope memory per user / session.',
          );
        }
        scope.identity = identity ?? { conversationId: 'default' };
        scope.turnNumber = turnNumber ?? 1;
        scope.contextTokensRemaining = budget ?? 4000;
      },
      'memory-seed',
      'Seed memory identity / turn / budget from run() args',
    );

    // Delegates to the `mountMemoryRead` wire helper — defaults match
    // what we'd inline (identity/turnNumber/contextTokensRemaining/newMessages →
    // sf-memory-read, outputs `memoryInjection`). Keeps the helper and
    // the agent loop in lockstep and avoids maintaining two copies.
    builder = mountMemoryRead(builder, { pipeline: memoryPipeline });
  }

  // Mount InstructionsToLLM subflow BEFORE the 3 API slots (only when instructions registered).
  //
  // arrayMerge: Replace is REQUIRED here — without it, Dynamic ReAct loops
  // concatenate promptInjections/toolInjections across iterations. That
  // both (a) inflates the system prompt on every turn and (b) sends the
  // same tool names twice to Anthropic on iteration 2+, which rejects with
  // "tools: Tool names must be unique." sf-messages and sf-tools below
  // already have this flag for the same reason.
  if (hasAgentInstructions) {
    const instructionsSubflow = buildInstructionsToLLMSubflow(config.agentInstructions!);
    builder = builder.addSubFlowChartNext(
      'sf-instructions-to-llm',
      instructionsSubflow,
      'InstructionsToLLM',
      {
        inputMapper: (parent: Record<string, unknown>) => ({
          decision: parent.decision,
        }),
        outputMapper: (sf: Record<string, unknown>) => ({
          promptInjections: sf.promptInjections,
          toolInjections: sf.toolInjections,
          responseRules: sf.responseRules,
          matchedInstructions: sf.matchedInstructions,
        }),
        arrayMerge: ArrayMergeMode.Replace,
      },
    );
  }

  // Mount SystemPrompt subflow
  builder = builder.addSubFlowChartNext('sf-system-prompt', systemPromptSubflow, 'SystemPrompt', {
    inputMapper: (parent: Record<string, unknown>) => ({
      messages: parent.messages,
      loopCount: parent.loopCount,
      ...(parent.promptInjections ? { promptInjections: parent.promptInjections } : {}),
    }),
    outputMapper: (sfOutput: Record<string, unknown>) => ({
      systemPrompt: sfOutput.systemPrompt,
    }),
  });

  // Mount Messages subflow
  // Mount Messages subflow — arrayMerge: 'replace' so messages are overwritten
  // (not concatenated) on each Dynamic ReAct iteration.
  builder = builder.addSubFlowChartNext('sf-messages', messagesSubflow, 'Messages', {
    inputMapper: (parent: Record<string, unknown>) => ({
      currentMessages: parent.messages ?? [],
      loopCount: parent.loopCount ?? 0,
    }),
    outputMapper: (sfOutput: Record<string, unknown>) => ({
      messages: sfOutput.memory_preparedMessages,
      memory_preparedMessages: sfOutput.memory_preparedMessages,
    }),
    arrayMerge: ArrayMergeMode.Replace,
  });

  // Mount Tools subflow — arrayMerge: 'replace' so toolDescriptions is overwritten
  // each iteration (not concatenated). Essential for Dynamic mode where tools change.
  builder = builder.addSubFlowChartNext('sf-tools', toolsSubflow, 'Tools', {
    inputMapper: (parent: Record<string, unknown>) => ({
      messages: parent.messages,
      loopCount: parent.loopCount,
      ...(parent.toolInjections ? { toolInjections: parent.toolInjections } : {}),
    }),
    outputMapper: (sfOutput: Record<string, unknown>) => ({
      toolDescriptions: sfOutput.toolDescriptions,
    }),
    arrayMerge: ArrayMergeMode.Replace,
  });

  const assemblePromptStage = (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const sysPrompt = scope.systemPrompt;
    const injection = scope.memoryInjection ?? [];

    // Build the final prompt: system prompt → memory injection → user
    // messages. Memory comes AFTER the system prompt (role instructions)
    // but BEFORE the ongoing dialogue, matching the conceptual ordering
    // "your role, what you know from before, what the user just said."
    const nonSystem = messages.filter((m) => m.role !== 'system');
    const prefix: Message[] = [];
    if (sysPrompt) prefix.push(systemMessage(sysPrompt));
    prefix.push(...injection);
    scope.messages = [...prefix, ...nonSystem];
  };

  // AssemblePrompt: prepend system message + memory injection
  builder = builder.addFunction(
    'AssemblePrompt',
    assemblePromptStage,
    'assemble-prompt',
    'Prepend system prompt + memory injection to messages before LLM call',
  );

  // CallLLM → ParseResponse → Routing(decider)
  //   Routing is pluggable via config.routing (RoutingConfig).
  //   Default: RouteResponse → {tool-calls | final}
  //   Swarm:   RouteSpecialist → {specialist-A | ... | swarm-tools | final}
  //
  // Add CallLLM — streaming or non-streaming
  if (config.streaming) {
    builder = builder.addStreamingFunction(
      'CallLLM',
      callLLM,
      'call-llm',
      'llm-stream',
      'Send messages + tools to LLM provider (streaming)',
    );
  } else {
    builder = builder.addFunction(
      'CallLLM',
      callLLM,
      'call-llm',
      'Send messages + tools to LLM provider',
    );
  }
  builder = builder.addFunction(
    'ParseResponse',
    parseResponseStage,
    'parse-response',
    'Parse LLM response into structured result',
  );

  // ── Routing — one code path for both Agent and Swarm ──
  // Priority: explicit config.routing (Swarm) > routeExtensions (user .route()) > default
  const finalBranchSubflow = buildFinalBranchSubflow(config);
  const routing: RoutingConfig = config.routing
    ? config.routing
    : config.routeExtensions && config.routeExtensions.length > 0
    ? extendDefaultRouting(
        defaultAgentRouting(toolExecutionSubflow, finalBranchSubflow),
        config.routeExtensions,
      )
    : defaultAgentRouting(toolExecutionSubflow, finalBranchSubflow);

  // Validate branches
  if (routing.branches.length === 0) {
    throw new Error('RoutingConfig must have at least one branch.');
  }
  const branchIds = new Set(routing.branches.map((b) => b.id));
  if (branchIds.size !== routing.branches.length) {
    throw new Error('RoutingConfig has duplicate branch IDs.');
  }
  if (!branchIds.has(routing.defaultBranch)) {
    throw new Error(
      `RoutingConfig.defaultBranch '${routing.defaultBranch}' does not match any branch ID: [${[
        ...branchIds,
      ].join(', ')}]`,
    );
  }

  // Wrap decider with structural maxIterations guard — no custom routing
  // can bypass this. If loopCount >= maxIterations, force-route to the
  // defaultBranch and set `maxIterationsReached` so the default branch
  // (Finalize, Swarm's fallback, user-supplied terminal, etc.) can
  // surface the fact that this was a forced termination.
  const safeDecider: RoutingConfig['decider'] = (scope: any, breakFn, streamCb) => {
    const loopCount = scope.loopCount ?? 0;
    const maxIter = scope.maxIterations ?? 10;
    if (loopCount >= maxIter) {
      scope.maxIterationsReached = true;
      return routing.defaultBranch;
    }
    return routing.decider(scope, breakFn, streamCb);
  };

  let decider = builder.addDeciderFunction(
    routing.deciderName,
    safeDecider,
    routing.deciderId,
    routing.deciderDescription,
  );

  for (const branch of routing.branches) {
    switch (branch.kind) {
      case 'subflow':
        decider = decider.addSubFlowChartBranch(
          branch.id,
          branch.chart,
          branch.name ?? branch.id,
          branch.mount,
        );
        break;
      case 'lazy-subflow':
        decider = decider.addLazySubFlowChartBranch(
          branch.id,
          branch.factory,
          branch.name ?? branch.id,
          branch.mount,
        );
        break;
      case 'fn':
        decider = decider.addFunctionBranch(
          branch.id,
          branch.name ?? branch.id,
          branch.fn,
          branch.description,
        );
        break;
    }
  }

  builder = decider.setDefault(routing.defaultBranch).end();

  // No post-decider memory stages: the final branch subflow owns
  // finalize + commit/memory-write + break. Tool-calls branch falls
  // through to loopTo below and iterates cleanly.

  // Loop target depends on pattern:
  //   Regular (default): loop to CallLLM — slots resolve once
  //   Dynamic: loop to InstructionsToLLM (if mounted) or SystemPrompt
  //     — instructions + all slots re-evaluate each iteration
  const dynamicTarget = hasAgentInstructions ? 'sf-instructions-to-llm' : 'sf-system-prompt';
  const loopTarget = config.pattern === AgentPattern.Dynamic ? dynamicTarget : 'call-llm';
  builder = builder.loopTo(loopTarget);

  if (options?.captureSpec) {
    const spec = builder.toSpec();
    return { chart: builder.build(), spec };
  }
  return { chart: builder.build() };
}

/**
 * Wrap a base RoutingConfig with user-defined extensions.
 *
 * User extensions run BEFORE the base decider. First matching `when` predicate wins.
 * If no extension matches, base routing applies. Runners are mounted as subflows
 * when they expose `.toFlowChart()`; otherwise they are wrapped with runnerAsStage.
 */
function extendDefaultRouting(
  base: RoutingConfig,
  extensions: readonly {
    readonly id?: string;
    readonly when: (scope: any) => boolean;
    readonly runner: RunnerLike;
  }[],
): RoutingConfig {
  // Each user branch is a TERMINAL fn stage: run the runner, write the content as the
  // agent's final result, and break the loop. We don't mount as a subflow because we
  // need terminate semantics in the parent loop — a subflow would return control to
  // the decider and keep looping. Drill-down via runner.toFlowChart() is a future
  // enhancement; for Phase 1 we optimize for correctness and simplicity.
  const userBranches: RoutingBranch[] = extensions.map((ext, idx) => {
    const id = ext.id ?? `route-${idx}`;
    return {
      id,
      kind: 'fn' as const,
      fn: createRouteExtensionStage(ext.runner),
      name: id,
      description: `User routing branch '${id}'`,
    };
  });

  const extendedBranches: readonly RoutingBranch[] = [...userBranches, ...base.branches];

  return {
    deciderName: base.deciderName,
    deciderId: base.deciderId,
    deciderDescription: base.deciderDescription,
    decider: (scope: any, breakFn, streamCb) => {
      // User predicates evaluated first — first match wins.
      for (let i = 0; i < extensions.length; i++) {
        try {
          if (extensions[i].when(scope)) {
            return userBranches[i].id;
          }
        } catch (err) {
          // Predicate errors fall through to base routing (fail-open).
          // Warn in dev so the silent skip is visible — matches the
          // library-wide "silent skips must surface in dev" rule.
          if (isDevMode()) {
            console.warn(
              `[agentfootprint] .route() branch '${userBranches[i].id}' predicate threw — ` +
                `falling through to default routing.`,
              err,
            );
          }
        }
      }
      return base.decider(scope, breakFn, streamCb);
    },
    branches: extendedBranches,
    defaultBranch: base.defaultBranch,
  };
}

/**
 * Build a terminal stage fn that invokes a user-provided runner, writes its content
 * as the agent's final answer, and breaks the loop.
 *
 * Called when a user `.route()` branch predicate fires. The runner receives the last
 * user message as input; its output content becomes the agent's assistant response.
 */
function createRouteExtensionStage(runner: RunnerLike) {
  return async (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const input =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : Array.isArray(lastUser?.content)
        ? lastUser.content
            .map((b: any) => (typeof b?.text === 'string' ? b.text : ''))
            .filter(Boolean)
            .join('\n')
        : '';

    const env = scope.$getEnv();
    const signal = env?.signal;
    const timeoutMs = env?.timeoutMs;

    const output = await runner.run(input, { signal, timeoutMs });
    const content = typeof output?.content === 'string' ? output.content : '';

    // Append the runner's answer as an assistant message so downstream
    // observers (narrative, recorders) see a coherent conversation.
    scope.messages = [...messages, assistantMessage(content)];
    scope.result = content;
    scope.$break();
  };
}

/**
 * Validate the AgentLoopConfig at build time.
 */
const isDevMode = () =>
  typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production';

function validateConfig(config: AgentLoopConfig): void {
  if (!config.provider) {
    throw new Error('AgentLoopConfig: provider is required');
  }
  if (!config.systemPrompt) {
    throw new Error('AgentLoopConfig: systemPrompt config is required');
  }
  if (!config.messages) {
    throw new Error('AgentLoopConfig: messages config is required');
  }
  if (!config.tools) {
    throw new Error('AgentLoopConfig: tools config is required');
  }
  if (!config.registry) {
    throw new Error('AgentLoopConfig: registry is required');
  }
  if (config.maxIterations !== undefined && config.maxIterations < 0) {
    throw new Error('AgentLoopConfig: maxIterations must be non-negative');
  }
  // Dev-mode warning: agentInstructions with activeWhen predicates but no initialDecision
  if (isDevMode() && config.agentInstructions?.length && !config.initialDecision) {
    const hasConditional = config.agentInstructions.some((i) => i.activeWhen);
    if (hasConditional) {
      console.warn(
        '[agentfootprint] agentInstructions with activeWhen predicates provided but no initialDecision. ' +
          'Decision scope will be {}, so conditional instructions may never fire.',
      );
    }
  }
}
