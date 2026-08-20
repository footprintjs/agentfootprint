/**
 * window — the loop-head stage that applies the agent's window strategy.
 *
 * Runs once per ReAct iteration boundary, as the loop target, so everything
 * downstream in the turn — the injection engine's triggers, all three context
 * slots, and the wire itself — sees ONE window. No component gets a different
 * past than the model does.
 *
 * The law: **it edits the window, never the ledger.** The turns a strategy
 * removes were committed by `seed#0` / `tool-calls#N` before this stage ran
 * and stay in those bundles byte-identical; footprintjs's commit log is
 * append-only, so a removal cannot erase history even in principle. What it
 * can do is stop re-sending it — and say so, in its own commit, naming every
 * runtimeStageId whose messages left. A compacted (or trimmed) run is still a
 * provable run.
 *
 * A commit log is memory, though, and a conversation outlives the process that
 * held it. So a strategy may also hand back `folded` spans — the durable form
 * of the same fact — and this stage commits them to `scope.foldedSpans`, which
 * `agent.checkpoint()` carries onto the conversation. A compacted CONVERSATION
 * is still a provable conversation, in the next process and the one after.
 *
 * This file is deliberately all WIRING. The decision — what the window should
 * become — lives behind `WindowStrategy` (window/strategy.ts, public since
 * 7.17), so the duty to record, emit and cost what happened stays in exactly
 * one place instead of being re-implemented per strategy. The TRIGGER lives
 * in the strategy too: `plan()` is called at every boundary and answers
 * `undefined` when it did not engage, which is what lets `slidingWindow`
 * trigger on turn count while the token-triggered strategies refuse by name
 * on a provider that reports no usage.
 *
 * Emits (existing vocabulary only — no new event types):
 *   agentfootprint.context.evicted          — one per message leaving the window
 *   agentfootprint.context.budget_pressure  — one per visit that HAS a budget
 *                                             (omitted by strategies that do
 *                                             not, rather than reporting a cap
 *                                             nobody configured)
 *   agentfootprint.cost.tick                — when a pricingTable is set: a
 *                                             summarizer call is a real billed
 *                                             call and counts
 *
 * A summarizer call is deliberately NOT bracketed with `stream.llm_start` /
 * `llm_end`: those carry an `iteration` and every consumer pairs them by it,
 * so a second bracket inside one iteration would corrupt the pairing. Its
 * cost rides the cost channel and its tokens are recorded in the commit.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage, PricingTable } from '../../../adapters/types.js';
import type { CompactionMeterHandle } from '../../../recorders/core/CompactionMeter.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { fnv1a } from '../../slots/helpers.js';
import { emitCostTick, type ResolvedCostBudget } from '../../cost.js';
import { currentRequestIndexOf } from '../window/currentRequest.js';
import { removalFacts } from '../window/removal.js';
import type { WindowStrategy } from '../window/strategy.js';
import { answeredCallIds, planRemoval, segmentTurns, type RemovalGuards } from '../window/turns.js';
import type { FoldedSpan, WindowRecord } from '../window/types.js';
import type { AgentState } from '../types.js';

export interface WindowStageDeps {
  /** The agent's one window strategy. */
  readonly strategy: WindowStrategy;
  /** The meter this stage reads. Attached inline by `Agent.createExecutor`. */
  readonly meter: CompactionMeterHandle;
  /** The agent's own model — a billing strategy's default. */
  readonly agentModel: string;
  /** The MAIN provider's name, for a refusal that names it. */
  readonly providerName: string;
  /**
   * The current run's id, read per run (the stage is built once, at chart
   * build time, and outlives every run it serves). A strategy that retains
   * what it removed stamps this on the span, so a stored conversation can say
   * which run's commit log used to hold those messages.
   */
  readonly getRunId?: () => string | undefined;
  /** Optional pricing adapter, so a summarizer call is costed like any other. */
  readonly pricingTable?: PricingTable;
  /** Optional cumulative USD cap per run. */
  readonly costBudget?: ResolvedCostBudget;
  /** Injectable clock (tests pin survivalMs). */
  readonly now?: () => number;
}

/** Build the window stage. */
export function buildWindowStage(
  deps: WindowStageDeps,
): (scope: TypedScope<AgentState>) => Promise<void> {
  const { strategy, meter } = deps;
  const now = deps.now ?? ((): number => Date.now());
  // Dedup latch for a strategy's warning: a summarizer that is down is down
  // for the whole run, and one warning is a warning while ten is noise.
  let warned = false;
  // The same latch for the meter going dark. A provider that stops reporting
  // usage stops for the run, and the strategy then declines at every boundary
  // — which would otherwise be indistinguishable from a window that is simply
  // under budget.
  let warnedUnmetered = false;

  return async (scope) => {
    // Read the window every iteration. The strategy owns its own trigger, so
    // the stage cannot know whether this iteration matters until it asks —
    // which means the reads channel now records a read of `history` on
    // iterations that change nothing. That read genuinely happens; the
    // request bytes are untouched.
    const history = ((scope.history as readonly LLMMessage[] | undefined) ?? []).slice();
    const turns = segmentTurns(history);
    const iteration = (scope.iteration as number | undefined) ?? 1;
    // The reading is asked for BY iteration, so an expired one comes back
    // `undefined` instead of standing in for a count nobody took (8.14.0).
    const metered = meter.lastCall(iteration);
    if (metered === undefined && meter.unmeteredSinceLastGood() > 0 && !warnedUnmetered) {
      warnedUnmetered = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[agentfootprint window:${strategy.name}] the provider stopped reporting token usage ` +
          `(${meter.unmeteredSinceLastGood()} call(s) with none, most recently before iteration ` +
          `${iteration}). This strategy is measured, not estimated, so it is standing down ` +
          `rather than deciding on the last number it happened to see — the window is no longer ` +
          `being managed. Use a provider that reports usage, or remove the window strategy.`,
      );
    }
    const origins = meter.origins();
    const pausedToolCallId = scope.pausedToolCallId as string | undefined;
    // The one message this run is executing (9.55.0). `scope.userMessage` is
    // what the seed stage committed, so the match is against the run's own
    // copy rather than a guess from position — see window/currentRequest.ts
    // for what happens when the window was seeded from somewhere else.
    const currentRequestIndex = currentRequestIndexOf(
      history,
      scope.userMessage as string | undefined,
    );
    const guards: RemovalGuards = {
      answeredCallIds: answeredCallIds(history),
      ...(currentRequestIndex >= 0 && { currentRequestIndex }),
      ...(pausedToolCallId !== undefined && { pausedToolCallId }),
      ...(scope.pausedCheckIn === true && { pausedCheckIn: true }),
    };

    const result = await strategy.plan({
      history,
      turns,
      measured:
        metered === undefined ? undefined : { input: metered.input, output: metered.output },
      iteration,
      // 'unknown' rather than a fabricated id: a span that cannot name its run
      // should say so, not invent a plausible-looking answer.
      runId: deps.getRunId?.() ?? 'unknown',
      agentModel: deps.agentModel,
      providerName: deps.providerName,
      signal: scope.$getEnv?.()?.signal,
      now,
      // The refusal engine, bound. A strategy cannot skip it: it never
      // receives the guards, only the answer.
      planRemoval: (keepRecentTurns, isExistingSummary) =>
        planRemoval(turns, keepRecentTurns, guards, isExistingSummary),
      removalFacts: (indices, atMs) => removalFacts(origins, indices, atMs),
    });

    // `undefined` = this strategy did not engage this iteration. Nothing to
    // apply, nothing to record — the ledger tracks what a strategy DID.
    if (result === undefined) return;

    // ── Apply. The stage owns every side effect. ─────────────────────
    if (result.window !== undefined && result.rebase !== undefined) {
      // Tell the meter before writing: the shape change is the one thing it
      // cannot infer (the set trap JSON-round-trips every write).
      meter.rebaseForWindowChange(
        result.rebase.headCount,
        result.rebase.keptTailCount,
        result.rebase.insertedAtMs,
      );
      scope.history = result.window;
    }

    const prior = (scope.compactions as readonly WindowRecord[] | undefined) ?? [];
    scope.compactions = [...prior, result.record];

    // The durable half, written in the SAME commit as the window change and
    // the record above. That co-location is the guarantee: there is no state,
    // and no failure, in which messages left the window and the record of what
    // they were did not follow them — no second transaction to fail, no I/O to
    // time out, nothing to roll back. A strategy that removed nothing (or
    // replaced nothing) omits `folded`, and then this key is never written,
    // so an agent whose strategy does not retain commits exactly the keys it
    // always did.
    if (result.folded !== undefined && result.folded.length > 0) {
      const priorFolds = (scope.foldedSpans as readonly FoldedSpan[] | undefined) ?? [];
      scope.foldedSpans = [...priorFolds, ...result.folded];
    }

    // One eviction per message that left, in the slot vocabulary consumers
    // already subscribe to. The hash uses the SAME formula the messages slot
    // used to report the piece as injected, so evicted and injected refer to
    // the same piece by the same name.
    for (const eviction of result.evictions) {
      const msg = history[eviction.index];
      if (msg === undefined) continue;
      typedEmit(scope, 'agentfootprint.context.evicted', {
        slot: 'messages',
        contentHash: fnv1a(`${msg.role}:${eviction.index}:${msg.content}`),
        reason: 'budget',
        survivalMs: eviction.survivalMs,
      });
    }

    // A strategy with no token budget omits `budgetPressure` entirely rather
    // than report a cap nobody set.
    //
    // `unit` is why the payload's numbers are named `cap` / `projected` and
    // not `capTokens` / `projectedTokens` (renamed 8.14.0, old names removed
    // 9.0.0): the messages SLOT emits this same event, with this same
    // `slot: 'messages'`, counting CHARACTERS — and `contextBudget` is on by
    // default, so one subscriber gets both. Every shipped strategy compares
    // against a `thresholdTokens`, so a strategy that does not say defaults
    // to tokens. The strategy-facing seam (`WindowStrategyResult`) keeps its
    // own `capTokens` spelling: there it is honest, because a strategy that
    // measures chars declares `unit: 'chars'` for itself.
    if (result.budgetPressure !== undefined) {
      const { capTokens, projectedTokens, planAction } = result.budgetPressure;
      typedEmit(scope, 'agentfootprint.context.budget_pressure', {
        slot: 'messages',
        overflowBy: Math.max(0, projectedTokens - capTokens),
        planAction,
        unit: result.budgetPressure.unit ?? 'tokens',
        cap: capTokens,
        projected: projectedTokens,
      });
    }

    // A summarizer call is real money. It counts against the same budget.
    //
    // The provider is the STRATEGY's, from its own `billing` declaration —
    // never `deps.providerName`, which is the agent's. A compactor commonly
    // runs on a cheaper model at a different vendor, and naming the agent's
    // provider here would file that spend under the wrong bill. `billing` is
    // optional on the seam, so a third-party strategy that reports `spend`
    // without declaring it leaves `provider` absent rather than guessed.
    if (result.spend !== undefined) {
      emitCostTick(
        scope as never,
        deps.pricingTable,
        deps.costBudget,
        {
          ...(strategy.billing !== undefined && { provider: strategy.billing.provider.name }),
          model: result.spend.model,
        },
        result.spend.usage,
      );
    }

    if (result.warning !== undefined && !warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn(`[agentfootprint window:${strategy.name}] ${result.warning}`);
    }
  };
}
