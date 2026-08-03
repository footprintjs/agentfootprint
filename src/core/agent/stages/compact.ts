/**
 * compact — the loop-head stage that keeps the window inside budget.
 *
 * Reads the last call's ADAPTER-REPORTED input tokens from the compaction
 * meter and, when they exceed `thresholdTokens`, hands the window to a window
 * strategy. Runs once per ReAct iteration boundary, as the loop target, so
 * everything downstream in the turn — the injection engine's triggers, all
 * three context slots, and the wire itself — sees ONE window. No component
 * gets a different past than the model does.
 *
 * The law: **it edits the window, never the ledger.** The turns a fold removes
 * were committed by `seed#0` / `tool-calls#N` before this stage ran and stay
 * in those bundles byte-identical; footprintjs's commit log is append-only, so
 * a fold cannot erase history even in principle. What it can do is stop
 * re-sending it — and say so, in its own commit, naming every runtimeStageId
 * it folded. A compacted run is still a provable run.
 *
 * This file is deliberately all WIRING. The decision — what the window should
 * become — lives behind `WindowStrategy` (compaction/strategy.ts, internal),
 * so the duty to record, emit and cost what happened stays in exactly one
 * place instead of being re-implemented per strategy. `.compaction()` is the
 * only strategy that ships.
 *
 * Emits (existing vocabulary only — no new event types):
 *   agentfootprint.context.evicted          — one per message leaving the window
 *   agentfootprint.context.budget_pressure  — one per over-budget visit
 *   agentfootprint.cost.tick                — when a pricingTable is set: the
 *                                             summarizer's call is a real
 *                                             billed call and counts
 *
 * The summarizer call is deliberately NOT bracketed with
 * `stream.llm_start` / `llm_end`: those carry an `iteration` and every
 * consumer pairs them by it, so a second bracket inside one iteration would
 * corrupt the pairing. Its cost rides the cost channel and its tokens are
 * recorded in the commit instead.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage, PricingTable } from '../../../adapters/types.js';
import type { CompactionMeterHandle } from '../../../recorders/core/CompactionMeter.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { fnv1a } from '../../slots/helpers.js';
import { emitCostTick } from '../../cost.js';
import { CompactionUnmeasurableError } from '../compaction/errors.js';
import { summarizeOldestStrategy, type WindowStrategy } from '../compaction/strategy.js';
import { answeredCallIds, segmentTurns, type FoldabilityContext } from '../compaction/turns.js';
import type { CompactionRecord, ResolvedCompaction } from '../compaction/types.js';
import type { AgentState } from '../types.js';

export interface CompactStageDeps {
  /** Resolved `.compaction()` config (defaults already applied). */
  readonly config: ResolvedCompaction;
  /** The meter this stage reads. Attached inline by `Agent.createExecutor`. */
  readonly meter: CompactionMeterHandle;
  /** The agent's own model — the summarizer's default. */
  readonly defaultModel: string;
  /** The MAIN provider's name, for the unmeasurable refusal. */
  readonly providerName: string;
  /** Optional pricing adapter, so a summarizer call is costed like any other. */
  readonly pricingTable?: PricingTable;
  /** Optional cumulative USD cap per run. */
  readonly costBudget?: number;
  /** Injectable clock (tests pin survivalMs). */
  readonly now?: () => number;
}

/** Build the compaction stage function. */
export function buildCompactStage(
  deps: CompactStageDeps,
): (scope: TypedScope<AgentState>) => Promise<void> {
  const { config, meter } = deps;
  const now = deps.now ?? ((): number => Date.now());
  const strategy: WindowStrategy = summarizeOldestStrategy(config, deps.defaultModel);
  // Dedup latch for the strategy's warning: a summarizer that is down is down
  // for the whole run, and one warning is a warning while ten is noise.
  let warned = false;

  return async (scope) => {
    const metered = meter.lastCall();
    // Iteration 1: nothing has been sent, so nothing has been counted. A
    // compactor that acted here would be guessing, which is the one thing
    // this feature refuses to do.
    if (metered === undefined) return;

    if (metered.input === 0 && metered.output === 0) {
      throw new CompactionUnmeasurableError(deps.providerName);
    }
    if (metered.input <= config.thresholdTokens) return;

    // ── Over budget. Ask the strategy what the window should become. ──
    const history = ((scope.history as readonly LLMMessage[] | undefined) ?? []).slice();
    const pausedToolCallId = scope.pausedToolCallId as string | undefined;
    const foldability: FoldabilityContext = {
      answeredCallIds: answeredCallIds(history),
      ...(pausedToolCallId !== undefined && { pausedToolCallId }),
      ...(scope.pausedCheckIn === true && { pausedCheckIn: true }),
    };

    const result = await strategy.plan({
      history,
      turns: segmentTurns(history),
      origins: meter.origins(),
      measuredTokens: metered.input,
      foldability,
      iteration: (scope.iteration as number | undefined) ?? 1,
      signal: scope.$getEnv?.()?.signal,
      now,
    });

    // ── Apply. The stage owns every side effect. ─────────────────────
    if (result.window !== undefined && result.rebase !== undefined) {
      // Tell the meter before writing: the fold is the one window shape it
      // cannot infer (the set trap JSON-round-trips every write).
      meter.rebaseForFold(result.rebase.headCount, result.rebase.keptTailCount, now());
      scope.history = result.window;
    }

    const prior = (scope.compactions as readonly CompactionRecord[] | undefined) ?? [];
    scope.compactions = [...prior, result.record];

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

    // `capTokens` / `projectedTokens` are the historical names on
    // `BudgetPressureRecord`; the slots measure them in chars, and this
    // measures them in the tokens the decision was actually made on.
    typedEmit(scope, 'agentfootprint.context.budget_pressure', {
      slot: 'messages',
      capTokens: config.thresholdTokens,
      projectedTokens: metered.input,
      overflowBy: Math.max(0, metered.input - config.thresholdTokens),
      planAction: result.planAction,
    });

    // A summarizer call is real money. It counts against the same budget.
    if (result.spend !== undefined) {
      emitCostTick(
        scope as never,
        deps.pricingTable,
        deps.costBudget,
        result.spend.model,
        result.spend.usage,
      );
    }

    if (result.warning !== undefined && !warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn(`[agentfootprint compaction] ${result.warning}`);
    }
  };
}
