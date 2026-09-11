/**
 * buildAgentMessageApiChart — the Agent (ReAct) form of the messageAPI
 * merge-tree, as ONE FLAT main chart (no inner LLM-call sub-box).
 *
 * The whole ReAct cycle lives directly in the single Agent chart:
 *
 *   Context (ROOT selector — inits + picks which context slots to engineer)
 *     ├─ system-prompt ┐
 *     ├─ messages ─────┼─→ messageAPI → Call-LLM
 *     └─ tools ────────┘
 *        → Route (decider) → [ ToolCalls (execute) → loop ] / Final (response)
 *   loopTo(Context)
 *
 * WHY flat (the user's call): the entire agent — context engineering, the LLM
 * call, routing, tool execution, the loop, and the final response — is ONE
 * visible flowchart in ONE Agent box. No nested LLM-call box: Lens wraps the
 * whole chart in the Agent main-box and renders the slots as pills. This is
 * simpler than the composed (sf-llm-call subflow) shape and avoids box-in-box
 * nesting entirely.
 *
 * The three context slots are DIRECT children of Context; all converge at
 * messageAPI (which assembles system-prompt + messages); Call-LLM then sends
 * the assembled payload plus the tool schemas. Route decides tool-calls (loop)
 * vs final (terminate). The same chart serves Static and Dynamic agents — only
 * which slots the Context selector lights per iteration differs.
 */

import { flowChartSelector, select } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';
import type { LLMMessage, LLMProvider, LLMRequest, LLMToolSchema } from '../../adapters/types.js';
import { RECEIPT_KEY, type Receipt } from '../../lib/time-travel/receipt.js';
import { messageApiReceipt } from './messageApiReceipt.js';
import { SUBFLOW_IDS, STAGE_IDS, milestoneTagsFor } from '../../conventions.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { resilienceHooks } from '../../recorders/core/resilienceHooks.js';
import { buildSystemPromptSlot } from '../slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from '../slots/buildMessagesSlot.js';
import { buildToolsSlot } from '../slots/buildToolsSlot.js';
import { joinSystemPrompt, stripFrameworkFields } from './composeRequest.js';

/** Route branch ids. */
const ROUTE_TOOL_CALLS = 'tool-calls';
const ROUTE_FINAL = SUBFLOW_IDS.FINAL;

interface AgentMsgApiState {
  userMessage: string;
  history: readonly LLMMessage[];
  iteration: number;
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  /** Written by the tools slot — schemas the LLM may call. */
  toolSchemas: readonly LLMToolSchema[];
  /** Written by messageAPI. */
  assembledSystem: string;
  assembledMessages: readonly LLMMessage[];
  /** Written by Call-LLM. */
  answer: string;
  toolCalls: readonly { id: string; name: string; args: unknown }[];
  /** Written by Final; the agent's result. */
  finalContent: string;
  /** Written by Call-LLM when the chart was given a run id — see
   *  {@link AgentMessageApiChartDeps.getRunId}. */
  receipt?: Receipt;
}

export interface AgentMessageApiChartDeps {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly systemPrompt: string;
  readonly tools: readonly LLMToolSchema[];
  readonly maxIterations?: number;
  readonly structureRecorders?: readonly import('footprintjs').StructureRecorder[];
  /**
   * The id of the run this chart is about to make (9.91.0) — supply it and
   * Call-LLM mints a receipt on every turn of the loop, the fingerprint of
   * what the model was handed, committed at each call for `receiptAt` and
   * `servedAt` to read. The twin of `MessageApiChartDeps.getRunId`, and for
   * the same reason: this is a chart BUILDER handed to an executor the caller
   * owns, so the salt has to come from whoever starts the run.
   *
   * OMIT IT AND NO RECEIPT IS MINTED — never an unsalted one. The rule and its
   * reason live in `messageApiReceipt.ts`; `servedAt` declares the absence and
   * rebuilds the view as it always did.
   *
   * @example (internal — `buildAgentMessageApiChart` is not on the package's
   * public surface; the type is, so a caller composing this chart inside the
   * library reads the contract here)
   * ```ts
   * const runId = `run-${Date.now()}`;
   * const chart = buildAgentMessageApiChart({ ...deps, getRunId: () => runId });
   * await new FlowChartExecutor(chart).run({ input: { message: 'hi' } });
   * ```
   */
  readonly getRunId?: () => string | undefined;
}

/**
 * Build the Agent merge-tree chart as one flat ReAct flowchart.
 */
export function buildAgentMessageApiChart(deps: AgentMessageApiChartDeps): FlowChart {
  const { provider, model, systemPrompt, tools } = deps;
  const maxIterations = deps.maxIterations ?? 5;

  // ── Context: ROOT selector. Inits per-call state on the first turn (the
  // folded-in seed — Context is the chart's first node); on ReAct loop re-entry
  // it leaves state intact (the iteration was bumped by ToolCalls). Returns the
  // three context slots to engineer. ──
  const contextSelector = (scope: TypedScope<AgentMsgApiState>) => {
    if (scope.iteration === undefined) {
      const args = scope.$getArgs<{ message: string }>();
      scope.userMessage = args.message;
      scope.history = [{ role: 'user', content: args.message }];
      scope.iteration = 1;
      scope.systemPromptInjections = [];
      scope.messagesInjections = [];
      scope.toolSchemas = [];
      scope.assembledSystem = '';
      scope.assembledMessages = [];
      scope.answer = '';
      scope.toolCalls = [];
      scope.finalContent = '';
    }
    return select(scope, [
      { when: () => true, then: SUBFLOW_IDS.SYSTEM_PROMPT, label: 'engineer system-prompt' },
      { when: () => true, then: SUBFLOW_IDS.MESSAGES, label: 'engineer messages' },
      { when: () => true, then: SUBFLOW_IDS.TOOLS, label: 'engineer tools' },
    ]);
  };

  // ── messageAPI: assemble system-prompt + messages (the join after the slots
  // converge). tools is a separate field Call-LLM reads directly. ──
  const messageApiStage = (scope: TypedScope<AgentMsgApiState>): void => {
    const sysInjections = (scope.systemPromptInjections ?? []) as readonly InjectionRecord[];
    scope.assembledSystem = joinSystemPrompt(sysInjections);
    scope.assembledMessages = [...((scope.history ?? []) as readonly LLMMessage[])];
  };

  // ── Call-LLM: send the assembled payload + the tool schemas. ──
  const callLLM = async (scope: TypedScope<AgentMsgApiState>): Promise<void> => {
    const system = scope.assembledSystem;
    const messages = stripFrameworkFields((scope.assembledMessages ?? []) as readonly LLMMessage[]);
    const toolSchemas = (scope.toolSchemas ?? []) as readonly LLMToolSchema[];
    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration: scope.iteration,
      provider: provider.name,
      model,
      systemPromptChars: system.length,
      messagesCount: messages.length,
      toolsCount: toolSchemas.length,
      ...(toolSchemas.length > 0 && {
        tools: toolSchemas.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
        })),
      }),
    });
    const startMs = Date.now();
    // ONE request object, sent and fingerprinted — never assembled twice.
    const request: LLMRequest = {
      ...(system.length > 0 && { systemPrompt: system }),
      messages,
      ...(toolSchemas.length > 0 && { tools: toolSchemas }),
      model,
    };

    // ── THE RECEIPT (9.91.0) ───────────────────────────────────────────
    // Minted immediately before the port is called, so it is committed in the
    // call-llm bundle that already exists — and before rather than after on
    // purpose: the stage commits on the error path too, so a call that throws
    // still leaves the record of what it was about to send. No run id ⇒ no
    // receipt; the rule and its reason live in `messageApiReceipt.ts`.
    const receipt = messageApiReceipt({
      runId: deps.getRunId?.(),
      epoch: scope.iteration,
      model,
      provider: provider.name,
      systemText: system,
      systemPieces: (scope.systemPromptInjections ?? []) as readonly InjectionRecord[],
      messages,
      tools: toolSchemas,
      request,
    });
    if (receipt !== undefined) scope[RECEIPT_KEY] = receipt;

    const response = await provider.complete(
      request,
      // Resilience-report channel: a decorated provider's fallback /
      // retry / recovery becomes an in-run typed event here.
      //
      // Where that event GOES is entirely up to the recorders attached to
      // the executor, and on a bare one the answer is NOWHERE.
      // footprintjs's `ScopeFacade.emitEvent` dispatches only to
      // recorders' `onEmit` — it never touches the transaction buffer, and
      // it fast-returns outright when zero recorders are attached — so an
      // emit can never become a `CommitBundle`. This chart has no runner
      // of its own, so the caller must attach a recorder that implements
      // `onEmit` for the report to be observable at all, and
      // `resilienceRecorder` (exported from `agentfootprint/observe`)
      // specifically for `agent.on(...)`. Pinned by the two bare-executor
      // cases in
      // test/resilience/integration/resilience-decorator-visibility.test.ts.
      resilienceHooks(scope),
    );
    scope.answer = response.content;
    scope.toolCalls = response.toolCalls;
    typedEmit(scope, 'agentfootprint.stream.llm_end', {
      iteration: scope.iteration,
      content: response.content,
      toolCallCount: response.toolCalls.length,
      usage: response.usage,
      stopReason: response.stopReason,
      durationMs: Date.now() - startMs,
    });
  };

  // ── Route: ReAct decider — tool-calls (loop) vs final (terminate). ──
  const routeDecider = (scope: TypedScope<AgentMsgApiState>): string => {
    const calls = (scope.toolCalls ?? []) as readonly { id: string }[];
    if (calls.length > 0 && scope.iteration < maxIterations) return ROUTE_TOOL_CALLS;
    return ROUTE_FINAL;
  };

  // ── ToolCalls: execute the LLM's requested tools, append results, bump the
  // iteration, loop. ──
  const toolExec = async (scope: TypedScope<AgentMsgApiState>): Promise<void> => {
    const calls = (scope.toolCalls ?? []) as readonly { id: string; name: string; args: unknown }[];
    const newHistory = [...((scope.history ?? []) as readonly LLMMessage[])];
    for (const call of calls) {
      typedEmit(scope, 'agentfootprint.stream.tool_start', {
        toolCallId: call.id,
        toolName: call.name,
        args: call.args as Record<string, unknown>,
      });
      const result = `[${call.name} result]`; // demo executor — real agents wire a registry
      newHistory.push({ role: 'tool', content: result, toolCallId: call.id } as LLMMessage);
      typedEmit(scope, 'agentfootprint.stream.tool_end', {
        toolCallId: call.id,
        result,
        durationMs: 0,
      });
    }
    scope.history = newHistory;
    scope.toolCalls = [];
    scope.iteration = scope.iteration + 1;
  };

  // ── Final: the agent's response — terminate the loop, capture the answer. ──
  const finalStage = (scope: TypedScope<AgentMsgApiState>): void => {
    scope.finalContent = scope.answer;
    scope.$break('agent reached final answer');
  };

  // ── Build ONE flat chart: Context(root) → 3 slots → messageAPI → Call-LLM
  //    → Route → [ToolCalls → loop] / Final. ──
  return (
    flowChartSelector<AgentMsgApiState, AgentMsgApiState>(
      'Context',
      contextSelector as never,
      'context',
      {
        ...(deps.structureRecorders !== undefined && {
          structureRecorders: [...deps.structureRecorders],
        }),
        // 'Agent:' taxonomy marker → Lens renders this as an Agent group.
        description: 'Agent: ReAct loop',
      },
    )
      // Three DIRECT context slots — all converge at messageAPI.
      .addSubFlowChartBranch(
        SUBFLOW_IDS.SYSTEM_PROMPT,
        buildSystemPromptSlot({ prompt: systemPrompt, reason: 'agent messageAPI' }),
        'System Prompt',
        {
          tags: milestoneTagsFor(SUBFLOW_IDS.SYSTEM_PROMPT),
          inputMapper: (parent) => ({
            userMessage: (parent as AgentMsgApiState).userMessage,
            iteration: (parent as AgentMsgApiState).iteration,
          }),
          outputMapper: (sf) => ({
            systemPromptInjections: (sf as AgentMsgApiState).systemPromptInjections,
          }),
        },
      )
      .addSubFlowChartBranch(SUBFLOW_IDS.MESSAGES, buildMessagesSlot(), 'Messages', {
        tags: milestoneTagsFor(SUBFLOW_IDS.MESSAGES),
        inputMapper: (parent) => ({
          messages: (parent as AgentMsgApiState).history,
          iteration: (parent as AgentMsgApiState).iteration,
        }),
        outputMapper: (sf) => ({ messagesInjections: (sf as AgentMsgApiState).messagesInjections }),
      })
      .addSubFlowChartBranch(SUBFLOW_IDS.TOOLS, buildToolsSlot({ tools }), 'Tools', {
        tags: milestoneTagsFor(SUBFLOW_IDS.TOOLS),
        inputMapper: (parent) => ({ iteration: (parent as AgentMsgApiState).iteration }),
        outputMapper: (sf) => ({ toolSchemas: (sf as AgentMsgApiState).toolSchemas }),
        // REPLACE, never concatenate (9.92.0). footprintjs's default output
        // mapping CONCATENATES a subflow's array output onto the parent's
        // existing array, so turn 2 of this loop handed the model
        // `['weather','weather']` — the same tool twice, and Anthropic rejects
        // a request whose tool names repeat. The receipt and `servedAt` recorded
        // the doubled list truthfully, which is how the defect became visible
        // (9.91.0 follow-up). The agent charts already say this on their own
        // tools mount; this chart had the same mapper without the same law.
        arrayMerge: ArrayMergeMode.Replace,
        // tools is a SEPARATE Anthropic wire field — it BYPASSES messageAPI
        // (which assembles only system+messages) and pairs with its output at
        // Call-LLM. `convergeAt` makes the structure edge `sf-tools → call-llm`
        // instead of the default `sf-tools → message-api`, so Call-LLM reads as a
        // true 2-parent merge {messageAPI, tools}. (toolSchemas already rides
        // shared scope; this only makes the diagram faithful.)
        convergeAt: 'call-llm',
      })
      .end()
      // messageAPI assembles ONLY system+messages; Call-LLM then sends that
      // payload + the tool schemas (the 2-parent merge above).
      .addFunction(
        'messageAPI',
        messageApiStage as never,
        'message-api',
        'Assemble system + messages into the LLM request',
      )
      .addFunction(
        'CallLLM',
        callLLM as never,
        'call-llm',
        'Send the assembled request + tools to the LLM',
      )
      // Declared milestones (9.90.0), from the same table `milestoneFor` reads
      // (the slot branches above declare theirs in their mount options).
      .tag(...milestoneTagsFor(STAGE_IDS.CALL_LLM))
      // Route → [ToolCalls → loop back to Context] / [Final → terminate].
      .addDeciderFunction('Route', routeDecider as never, SUBFLOW_IDS.ROUTE, 'ReAct routing', {
        tags: milestoneTagsFor(SUBFLOW_IDS.ROUTE),
      })
      .addFunctionBranch(ROUTE_TOOL_CALLS, 'ToolCalls', toolExec as never, 'Execute tool calls', {
        tags: milestoneTagsFor(ROUTE_TOOL_CALLS),
      })
      // ReAct: the loop is sourced from the TOOL-CALLS branch (after executing
      // tools, re-engineer context next turn) — NOT from the Route decider. Final
      // terminates as a leaf (its $break is the terminal boundary signal).
      .loopTo('context')
      .addFunctionBranch(
        ROUTE_FINAL,
        'Final',
        finalStage as never,
        'Terminate the ReAct loop (response)',
      )
      .setDefault(ROUTE_FINAL)
      .end()
      .build()
  );
}
