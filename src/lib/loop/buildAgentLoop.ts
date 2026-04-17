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

import { flowChart } from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';
import type { FlowChart } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import type { RoutingBranch } from './types';
import { systemMessage, userMessage } from '../../types/messages';
import { buildSystemPromptSubflow } from '../slots/system-prompt';
import { buildMessagesSubflow } from '../slots/messages';
import { buildToolsSubflow } from '../slots/tools';
import type { TypedScope } from 'footprintjs';
import { createCallLLMStage } from '../call/callLLMStage';
import { createStreamingCallLLMStage } from '../call/streamingCallLLMStage';
import { parseResponseStage } from '../call/parseResponseStage';
import { buildToolExecutionSubflow } from '../call/toolExecutionSubflow';
import { createCommitMemoryStage } from '../../stages/commitMemory';
import { getTextContent } from '../../types/content';
import { lastAssistantMessage } from '../../memory';
import { AgentPattern } from './types';
import type { AgentLoopConfig, AgentLoopSeedOptions, RoutingConfig } from './types';
import { applyInstructionOverrides, buildInstructionsToLLMSubflow } from '../instructions';
import type {
  ResolvedFollowUp,
  ResolvedInstruction,
  LLMInstruction,
  InstructedToolDefinition,
} from '../instructions';
import type { RunnerLike } from '../../types/multiAgent';
import { assistantMessage } from '../../types/messages';

// ── Default Agent Routing ─────────────────────────────────────────────────────

/**
 * Default routing for the Agent loop: tool-calls | final.
 *
 * Expressed as a RoutingConfig so buildAgentLoop has ONE code path
 * for both Agent and Swarm routing.
 */
function defaultAgentRouting(
  toolExecutionSubflow: FlowChart,
  useCommitFlag: boolean,
): RoutingConfig {
  return {
    deciderName: 'RouteResponse',
    deciderId: 'route-response',
    deciderDescription: 'Route to tool execution or finalization based on LLM response',
    decider: (scope: any) => {
      const parsed = scope.parsedResponse;
      if (parsed?.hasToolCalls) return 'tool-calls';
      return 'final';
    },
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
        kind: 'fn',
        fn: createFinalizeStage({ useCommitFlag }),
        description: 'Extract final answer and stop the loop',
        name: 'Finalize',
      },
    ],
    defaultBranch: 'final',
  };
}

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
export interface StrictFollowUpResult {
  followUp: ResolvedFollowUp;
  sourceToolId: string;
}

export interface AgentLoopBuild {
  chart: FlowChart;
  /** Get strict follow-up that fired during the last execution (if any). */
  getStrictFollowUp: () => StrictFollowUpResult | undefined;
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

  // Auto-enable useCommitFlag when commitMemory is provided
  const useCommitFlag = config.useCommitFlag || !!config.commitMemory;

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

  // Capture strict follow-ups that fire during tool execution.
  // Stored in a closure variable — AgentRunner reads it after run() completes.
  let lastStrictFollowUp: ResolvedFollowUp | undefined;
  let lastStrictSourceToolId: string | undefined;

  const onInstructionsFired = (toolId: string, fired: ResolvedInstruction[]) => {
    // Find the first strict follow-up that fired (highest priority wins)
    if (!lastStrictFollowUp) {
      for (const instr of fired) {
        if (instr.resolvedFollowUp?.strict) {
          lastStrictFollowUp = instr.resolvedFollowUp;
          lastStrictSourceToolId = toolId;
          break;
        }
      }
    }
    // Forward to external callback (InstructionRecorder)
    config.onInstructionsFired?.(toolId, fired);
  };

  // Build call stages — pass onStreamEvent + responseFormat for llm_start/llm_end events
  const callLLM = config.streaming
    ? createStreamingCallLLMStage(config.provider, {
        onStreamEvent: config.onStreamEvent,
        responseFormat: config.responseFormat,
      })
    : createCallLLMStage(config.provider, {
        onStreamEvent: config.onStreamEvent,
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
    // tool handlers can return runtime instructions/followUps.
    instructionConfig: {
      instructionsByToolId,
      onInstructionsFired,
      decideFunctions: decideFunctions.size > 0 ? decideFunctions : undefined,
      agentResponseRules: hasAgentInstructions
        ? config.agentInstructions!.flatMap((i) => i.onToolResult ?? [])
        : undefined,
      onStreamEvent: config.onStreamEvent,
    },
  });

  // Two distinct Seed stage implementations — no runtime boolean.
  // The flowchart is built differently for standalone vs subflow composition.
  const initialDecision = config.initialDecision ?? {};

  const seedStandalone = (scope: TypedScope<AgentLoopState>) => {
    scope.messages = [...existingMessages, ...seedMessages];
    scope.loopCount = 0;
    scope.maxIterations = maxIterations;
    if (hasAgentInstructions) {
      scope.decision = { ...initialDecision };
    }
  };

  const seedSubflow = (scope: TypedScope<AgentLoopState>) => {
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

  // Mount InstructionsToLLM subflow BEFORE the 3 API slots (only when instructions registered)
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
      memory_storedHistory: sfOutput.memory_storedHistory,
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
    if (sysPrompt) {
      // Replace existing system message (if any) with current system prompt.
      // In Dynamic mode, the system prompt changes each iteration (instruction injections).
      const nonSystem = messages.filter((m) => m.role !== 'system');
      scope.messages = [systemMessage(sysPrompt), ...nonSystem];
    }
  };

  // AssemblePrompt: prepend system message if not already present
  builder = builder.addFunction(
    'AssemblePrompt',
    assemblePromptStage,
    'assemble-prompt',
    'Prepend system prompt to messages before LLM call',
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
  const routing: RoutingConfig = config.routing
    ? config.routing
    : config.routeExtensions && config.routeExtensions.length > 0
    ? extendDefaultRouting(
        defaultAgentRouting(toolExecutionSubflow, useCommitFlag),
        config.routeExtensions,
      )
    : defaultAgentRouting(toolExecutionSubflow, useCommitFlag);

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

  // Wrap decider with structural maxIterations guard — no custom routing can bypass this.
  // If loopCount >= maxIterations, force-route to defaultBranch and set the
  // `maxIterationsReached` flag on scope so ANY default-branch stage (Finalize,
  // Swarm's RouteSpecialist fallback, user-supplied terminal stage, …) can
  // surface the fact that this was a forced termination rather than a chosen
  // one. Setting the flag here — rather than inside a specific Finalize stage —
  // makes the signal available for every routing topology built on top of
  // buildAgentLoop.
  //
  // The defaultBranch MUST call $break() or breakFn() — validated below.
  const safeDecider: RoutingConfig['decider'] = (scope: any, breakFn, streamCb) => {
    const loopCount = scope.loopCount ?? 0;
    const maxIter = scope.maxIterations ?? 10;
    if (loopCount >= maxIter) {
      // Deciders can write to scope — the write is committed with the decider
      // stage's transaction. For TypedScope, property assignment goes through
      // the Proxy set trap; for raw ScopeFacade, fall back to setValue if the
      // property assignment is rejected.
      try {
        scope.maxIterationsReached = true;
      } catch {
        if (typeof scope.setValue === 'function') {
          try {
            scope.setValue('maxIterationsReached', true);
          } catch {
            /* unable to record — consumers must read loopCount vs maxIterations */
          }
        }
      }
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

  // Mount CommitMemory when persistent memory is configured.
  // CommitMemory saves full history to store (fire-and-forget) and calls $break().
  if (config.commitMemory) {
    const commitMemory = createCommitMemoryStage(config.commitMemory);
    builder = builder.addFunction(
      'CommitMemory',
      commitMemory,
      'commit-memory',
      'Persist conversation history to store',
    );
  }

  // Loop target depends on pattern:
  //   Regular (default): loop to CallLLM — slots resolve once
  //   Dynamic: loop to InstructionsToLLM (if mounted) or SystemPrompt
  //     — instructions + all slots re-evaluate each iteration
  const dynamicTarget = hasAgentInstructions ? 'sf-instructions-to-llm' : 'sf-system-prompt';
  const loopTarget = config.pattern === AgentPattern.Dynamic ? dynamicTarget : 'call-llm';
  builder = builder.loopTo(loopTarget);

  /** Get strict follow-up that fired during the last execution (if any). */
  const getStrictFollowUp = () =>
    lastStrictFollowUp
      ? { followUp: lastStrictFollowUp, sourceToolId: lastStrictSourceToolId! }
      : undefined;

  if (options?.captureSpec) {
    const spec = builder.toSpec();
    return { chart: builder.build(), spec, getStrictFollowUp };
  }
  return { chart: builder.build(), getStrictFollowUp };
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
        } catch {
          // Predicate errors fall through to base routing (fail-open).
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
 * Create the Finalize stage function (decider 'final' branch).
 *
 * Extracts the final answer text from the last assistant message and stops
 * the loop. When useCommitFlag is set, writes memory_shouldCommit instead
 * of calling $break() directly — the downstream CommitMemory stage will break.
 */
function createFinalizeStage(options: { useCommitFlag: boolean }) {
  const { useCommitFlag } = options;
  return (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const lastAsst = lastAssistantMessage(messages);
    const lastAsstText = lastAsst ? getTextContent(lastAsst.content) : '';

    // safeDecider sets `maxIterationsReached` when it force-routes at the cap.
    // Read it here — don't re-derive from loopCount — so this stage agrees
    // with whatever safeDecider decided (single source of truth).
    const exhausted = scope.maxIterationsReached === true;

    if (exhausted) {
      const maxIter = scope.maxIterations ?? 10;
      // Prefer the LLM's last reasoning text if present — otherwise synthesize
      // a clear "agent gave up" message so callers never see an unexplained
      // empty response after a long tool-error loop.
      scope.result =
        lastAsstText ||
        `Agent stopped after ${maxIter} iterations without a final answer. The LLM may be stuck in a tool-error retry loop — check the execution trace.`;
    } else {
      scope.result = lastAsstText;
    }

    if (useCommitFlag) {
      scope.memory_shouldCommit = true;
    } else {
      scope.$break();
    }
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
