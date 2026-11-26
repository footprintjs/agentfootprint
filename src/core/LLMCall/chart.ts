import { flowChart, type FlowChart, type TypedScope } from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';
import { SUBFLOW_IDS, STAGE_IDS, milestoneTagsFor, RECEIPT_KEY } from '../../lib/conventions.js';
import { callUnder } from '../../lib/abort.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { recordModelContext } from '../../recorders/core/recordModelContext.js';
import { resilienceHooks } from '../../recorders/core/resilienceHooks.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import type { LLMRequest, PricingTable } from '../../provider-contract/types.js';
import { captureProviderResponse } from '../../provider-contract/responseAdmission.js';
import { buildReceipt, receiptPieces } from '../agent/receipt/receipt.js';
import { emitCostTick, type ResolvedCostBudget } from '../cost.js';
import { buildSystemPromptSlot } from '../slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from '../slots/buildMessagesSlot.js';
import { buildThinkingSubflow } from '../slots/buildThinkingSubflow.js';
import type { ThinkingHandler } from '../../thinking/types.js';
import {
  joinSystemPrompt,
  messagesFromInjections,
  stripFrameworkFields,
} from '../agent/composeRequest.js';
import {
  admitProviderIntervention,
  admitInterventionError,
  interventionRecordOf,
} from '../providerIntervention.js';
import type { LLMCallState, LLMCallInput, LLMCallOptions } from './types.js';

export interface CallChartOptions {
  readonly provider: LLMCallOptions['provider'];
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly systemPromptValue: string;
  readonly pricingTable?: PricingTable;
  readonly costBudget?: ResolvedCostBudget;
  readonly thinkingHandler?: ThinkingHandler;
  readonly recordReceiptValue: boolean;
  readonly contextBudget?: LLMCallOptions['contextBudget'];
  readonly recordSystemPromptValue: boolean;
  readonly structureRecorders?: LLMCallOptions['structureRecorders'];
  readonly runIdOf: (scope: unknown) => string;
}

export function buildCallChart(options: CallChartOptions): FlowChart {
  const {
    provider,
    model,
    temperature,
    maxTokens,
    systemPromptValue,
    pricingTable,
    costBudget,
    thinkingHandler,
    recordReceiptValue: recordReceipt,
  } = options;
  // ─── Outer Client stage ─────────────────────────────────────────
  // First visit: receives args, sets userMessage on outer scope.
  // Second visit (post-loop): scope.answer has been populated by the
  // inner subflow's outputMapper. `$break` terminates the loop AND
  // returns scope.answer as the chart's TraversalResult.
  //
  // Returning the answer here is load-bearing for composition: when
  // LLMCall is mounted inside Sequence/Parallel/Conditional, the
  // parent's outputMapper reads `sfOutput` which IS the subflow's
  // TraversalResult (footprintjs convention). Without the return,
  // parent.current ends up as '' and downstream steps see no input.
  //
  // Cost counters live exclusively in the inner subflow's scope —
  // they don't need to cross the boundary because LLMCall is
  // one-shot. Threading them via inputMapper would seal them as
  // readonly input on the inner side (footprintjs convention) and
  // break `emitCostTick`'s scope writes.
  const client = (scope: TypedScope<LLMCallState>): string | undefined => {
    if (scope.answer !== undefined) {
      scope.$break('LLMCall: one-shot complete');
      return scope.answer;
    }
    const args = scope.$getArgs<LLMCallInput>();
    scope.userMessage = args.message;
    scope.iteration = 1;
    return undefined;
  };

  // ─── Inner subflow stages ───────────────────────────────────────
  // Inner seed initializes the per-call injection arrays AND the
  // local cost counters that emitCostTick mutates inside callLLM.
  // userMessage + iteration arrive via inputMapper from outer Client.
  const innerSeed = (scope: TypedScope<LLMCallState>) => {
    scope.systemPromptInjections = [];
    scope.messagesInjections = [];
    scope.cumTokensInput = 0;
    scope.cumTokensOutput = 0;
    scope.cumEstimatedUsd = 0;
    scope.costBudgetHit = false;
  };

  // slot subflow builders. Each emits InjectionRecord[] + SlotComposition
  // through the convention scope keys; ContextRecorder observes and
  // dispatches context.* events. NO tools slot — LLMCall has no tools.
  // Per-slot budgets (8.11.0) — forwarded only where the consumer set one,
  // so an unset slot keeps its own default.
  const budget = options.contextBudget;
  const recordSystemPrompt = options.recordSystemPromptValue;
  const systemPromptSubflow = buildSystemPromptSlot({
    prompt: systemPromptValue,
    reason: 'LLMCall.system()',
    ...(budget?.systemPrompt !== undefined && { budgetCap: budget.systemPrompt }),
  });
  const messagesSubflow = buildMessagesSlot({
    ...(budget?.messages !== undefined && { budgetCap: budget.messages }),
  });

  const callLLM = async (scope: TypedScope<LLMCallState>) => {
    const systemPromptInjections = (scope.systemPromptInjections ??
      []) as readonly InjectionRecord[];
    const messagesInjections = (scope.messagesInjections ?? []) as readonly InjectionRecord[];
    const iteration = (scope.iteration as number | undefined) ?? 1;

    const systemPrompt = joinSystemPrompt(systemPromptInjections);

    // The messages-slot join (9.88.0). One exported rule, for the same
    // reason the system-prompt join is one: `LLMCall` has no `history`, so
    // these records ARE the committed conversation, and `servedAt` rebuilds
    // it by calling this identical function over the identical records.
    //
    // The framework-field strip rides with it (9.91.0) — the third rule of
    // the one assembly. It is identity on what this slot composes today, and
    // it is here so the two sides cannot drift the day that changes: the
    // rebuild applies it, so the mint applies it.
    const messages = stripFrameworkFields(messagesFromInjections(messagesInjections));

    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration,
      provider: provider.name,
      model,
      systemPromptChars: systemPrompt.length,
      // Opt-in (9.50.0): the assembled prompt VERBATIM, exactly the string
      // handed to the provider below.
      ...(recordSystemPrompt && { systemPromptText: systemPrompt }),
      messagesCount: messages.length,
      toolsCount: 0,
      ...(temperature !== undefined && { temperature }),
    });

    const startMs = Date.now();
    // ONE request object, built once and both sent and fingerprinted —
    // never assembled twice (9.91.0). A second literal at the mint would be
    // a second assembly, and the whole point of a receipt is that it
    // describes THIS one.
    const request: LLMRequest = {
      systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
      messages,
      model,
      ...(temperature !== undefined && { temperature }),
      ...(maxTokens !== undefined && { maxTokens }),
    };

    recordModelContext(scope, () => ({
      iteration,
      systemPieces: systemPromptInjections,
      tools: [],
    }));

    // ── THE RECEIPT (9.91.0) ─────────────────────────────────────────
    // Written immediately before the provider is called, so it is committed
    // in the call-llm bundle that already exists — and before rather than
    // after on purpose: the stage commits on the error path too, so a call
    // that throws still leaves the record of what it was about to send.
    //
    // The mint is `receipt.ts` · `buildReceipt`, the same one the agent's
    // `call-llm` calls, salted with this run's own id. There is no cache
    // strategy on this chart, so the request handed out is the request
    // assembled: `baseRequest` and `preparedRequest` are the same object and
    // `cache.transform` records `'unchanged'` — exactly what an agent
    // running a pass-through strategy records, and true for the same reason.
    // `cache.strategy: null` is the half `transform` cannot say (9.93.0):
    // nothing stood between assembly and the port, so the served view
    // raises no `cache-transform` gap on this chart.
    //
    // NOT HERE: `omittedForAttention`. This chart has no window, so nothing
    // is ever dropped before a call, and the absent key says exactly that.
    if (recordReceipt) {
      scope[RECEIPT_KEY] = buildReceipt({
        runId: options.runIdOf(scope),
        epoch: iteration,
        model,
        provider: provider.name,
        systemText: systemPrompt,
        systemPieces: receiptPieces(systemPromptInjections),
        messages,
        requestOnly: [],
        tools: [],
        forced: null,
        withheld: null,
        baseRequest: request,
        preparedRequest: request,
        strategy: null,
      });
    }

    // Raw provider errors propagate untouched (reliability + merge
    // layers classify on the raw message). The friendly translation
    // for non-developers happens once at the terminal boundary —
    // ErrorBridge humanizes the `error.fatal` event the monitor reads.
    //
    // The run's signal (its deadline included) rides the request and bounds
    // the wait, and an answer that lands after it is refused before
    // `llm_end` or the cost tick could count it (lib/abort.ts · callUnder).
    const response = captureProviderResponse(
      await callUnder(request, scope.$getEnv?.()?.signal, (wired) =>
        provider.complete(
          wired,
          // Resilience-report channel: a decorated provider's fallback /
          // retry / recovery becomes an in-run typed event here.
          resilienceHooks(scope, recordReceipt),
        ),
      ).catch((error: unknown) => admitInterventionError(scope, error)),
    );
    if (
      admitProviderIntervention(scope, response, () => {
        typedEmit(scope, 'agentfootprint.stream.llm_end', {
          iteration,
          content: '',
          contentWithheld: true,
          toolCallCount: 0,
          usage: response.usage,
          stopReason: response.stopReason,
          durationMs: Date.now() - startMs,
        });
        emitCostTick(
          scope,
          pricingTable,
          costBudget,
          { provider: provider.name, model },
          response.usage,
        );
      })
    )
      return;
    const durationMs = Date.now() - startMs;

    typedEmit(scope, 'agentfootprint.stream.llm_end', {
      iteration,
      content: response.content,
      toolCallCount: response.toolCalls.length,
      usage: response.usage,
      stopReason: response.stopReason,
      durationMs,
    });

    emitCostTick(
      scope,
      pricingTable,
      costBudget,
      { provider: provider.name, model },
      response.usage,
    );

    // Write outputs to scope so downstream stages (sf-thinking,
    // extract-final) can read them. The chart's TraversalResult
    // bubbles up via scope.answer + outputMapper, NOT via this
    // stage's return value (which is intentionally undefined now).
    scope.answer = response.content;
    if (response.rawThinking !== undefined) {
      scope.rawThinking = response.rawThinking;
    }
    return undefined;
  };

  // extract-final stage — symmetric with Agent's sf-final branch.
  // For LLMCall (no tools) it's a thin "final answer is ready" marker
  // that gives lens a discrete commit boundary and matching chart
  // node. scope.answer is already set by callLLM; this stage just
  // surfaces a real "final" moment.
  const extractFinal = (scope: TypedScope<LLMCallState>) => {
    // No-op data-wise — scope.answer was set in callLLM. This stage
    // exists purely for chart shape (lens "Final" node + commit).
    void scope;
  };

  // ─── Build the inner sf-llm-call subflow ────────────────────────
  let innerBuilder = flowChart<LLMCallState>('Initialize', innerSeed, STAGE_IDS.SEED, {
    description: 'LLMCall: invocation internals',
  })
    .addSubFlowChartNext(SUBFLOW_IDS.SYSTEM_PROMPT, systemPromptSubflow, 'System Prompt', {
      inputMapper: (parent) => ({
        userMessage: parent.userMessage as string | undefined,
        iteration: parent.iteration as number | undefined,
      }),
      outputMapper: (sfOutput) => ({ systemPromptInjections: sfOutput.systemPromptInjections }),
    })
    // Declared milestones (9.90.0): these slots are `addSubFlowChartNext`
    // mounts, so — unlike the Agent charts' selector branches — they CAN
    // carry the `slot` tag on their first commit bundle.
    .tag(...milestoneTagsFor(SUBFLOW_IDS.SYSTEM_PROMPT))
    .addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, messagesSubflow, 'Messages', {
      inputMapper: (parent) => {
        // Wrap the single user message as a one-entry history for the
        // messages slot. Full conversation history arrives with Agent.
        const userMessage = parent.userMessage as string | undefined;
        return {
          messages: userMessage ? [{ role: 'user' as const, content: userMessage }] : [],
          iteration: parent.iteration as number | undefined,
        };
      },
      outputMapper: (sfOutput) => ({ messagesInjections: sfOutput.messagesInjections }),
    })
    .tag(...milestoneTagsFor(SUBFLOW_IDS.MESSAGES))
    .addFunction('CallLLM', callLLM, STAGE_IDS.CALL_LLM, 'LLM invocation')
    // Declared milestone (9.90.0): the LLM turn.
    .tag(...milestoneTagsFor(STAGE_IDS.CALL_LLM));

  // Conditional sf-thinking — mounted only when a ThinkingHandler
  // resolved (declared by the provider, read in the constructor). Same
  // build-time conditional pattern Agent uses (buildAgentChart.ts).
  if (thinkingHandler) {
    innerBuilder = innerBuilder.addSubFlowChartNext(
      SUBFLOW_IDS.THINKING,
      buildThinkingSubflow(thinkingHandler, provider.name),
      'NormalizeThinking',
      {
        inputMapper: (parent) => ({
          rawThinking: parent.rawThinking as unknown,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sfOutput) => ({ thinkingBlocks: sfOutput.thinkingBlocks }),
        // Replace not concatenate — fresh thinking per iteration.
        arrayMerge: ArrayMergeMode.Replace,
      },
    );
  }

  const innerSubflow = innerBuilder
    .addFunction('ExtractFinal', extractFinal, STAGE_IDS.EXTRACT_FINAL, 'Final response ready')
    .build();

  // ─── Outer chart: Client → sf-llm-call → loopTo(client) ─────────
  // Description prefix `LLMCall:` is a taxonomy marker — consumers
  // distinguish LLMCall subflows from Agent subflows (`Agent:`) via
  // this prefix. Only Agent subflows surface as "agent boundaries"
  // in Lens; LLMCall is a primitive invocation, not an agent.
  //
  // Untyped <string, TypedScope<LLMCallState>> overload is used so
  // Client's `string | undefined` return is accepted — the chart's
  // TraversalResult is the answer string, which downstream
  // compositions (Sequence/Parallel/Conditional) read via
  // outputMapper's `sfOutput` parameter.
  return (
    flowChart<string, TypedScope<LLMCallState>>('Client', client, STAGE_IDS.CLIENT, {
      ...(options.structureRecorders !== undefined && {
        structureRecorders: [...options.structureRecorders],
      }),
      description: 'LLMCall: one-shot',
    })
      .addSubFlowChartNext(SUBFLOW_IDS.LLM_CALL, innerSubflow, 'LLM', {
        inputMapper: (parent) => ({
          userMessage: parent.userMessage as string | undefined,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sfOutput) => ({
          answer: sfOutput.answer,
          ...interventionRecordOf(sfOutput),
        }),
        propagateBreak: true,
      })
      // Declared milestone (9.90.0): the mount is the iteration boundary on the
      // outer log — one turn per LLMCall run.
      .tag(...milestoneTagsFor(SUBFLOW_IDS.LLM_CALL))
      .loopTo(STAGE_IDS.CLIENT)
      .build()
  );
}
