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
import { foldLedger, type LedgerFold } from '../findings/ledger.js';
import type { FindingsLedger, Standing } from '../findings/types.js';
import { currentRequestIndexOf } from '../window/currentRequest.js';
import { toolResultPinsOf } from '../window/lastToolResult.js';
import { ledgerFactPinsOf, turnStandingOf } from '../window/ledgerFactPins.js';
import { DEFAULT_KEEP_LAST_TOOL_RESULTS } from '../window/options.js';
import { removalFacts } from '../window/removal.js';
import type { WindowStrategy } from '../window/strategy.js';
import {
  answeredCallIds,
  planRemoval,
  segmentTurns,
  type RemovalGuards,
  type Turn,
} from '../window/turns.js';
import { droppedToolNames } from '../window/toolNames.js';
import type { EvictedTurnsHandle } from '../window/evictedTurns.js';
import type {
  FoldedSpan,
  WindowObservations,
  WindowRecord,
  WindowRefusalReason,
} from '../window/types.js';
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
  /**
   * How many tools' most recent results stay in the window beyond
   * `keepRecentTurns` (9.57.0). `false` (or 0) switches the pin off entirely
   * and reproduces 9.56.0 byte for byte.
   *
   * Threaded value-conditionally by `Agent` — the `repeatedCallNudge`
   * grammar — so an agent on the default hands this stage exactly the deps
   * object it always did.
   */
  readonly keepLastToolResults?: number | false;
  /**
   * The findings ledger is armed on this agent (9.102.0) — `.findings()` was
   * called. The ONE gate under which this stage may read
   * `scope.findingsLedger`: on an unarmed agent that key never exists, and a
   * tracked read of an always-absent key is the phantom-context-source
   * defect `window/evictedTurns.ts` documents. Threaded value-conditionally
   * by `Agent` (the `keepLastToolResults` grammar) together with
   * `keepLedgerFacts` — both or neither — so an unarmed agent hands this
   * stage exactly the deps object it always did.
   */
  readonly hasFindingsLedger?: true;
  /**
   * The ceiling of fact turns the window holds beyond `keepRecentTurns`
   * (9.102.0) — `keepLastToolResults`'s content-aware sibling, by the
   * MODEL's `fact` standing only, never the library's reading of a result.
   * Present exactly when `hasFindingsLedger` is, and already RESOLVED by
   * `Agent` (`findings({ keepLedgerFacts })` over
   * `AgentOptions.keepLedgerFacts`; `false` → `0`; default 4), so this stage
   * applies no default of its own: absent means no hold, `0` means the hold
   * is switched off. See `AgentOptions.keepLedgerFacts` for why.
   */
  readonly keepLedgerFacts?: number;
  /** Injectable clock (tests pin survivalMs). */
  readonly now?: () => number;
  /**
   * Where this visit's evictions are filed for the receipt (9.93.0) — read by
   * the call-llm mint in the same iteration, never through scope
   * (`window/evictedTurns.ts` says why). Attached by `Agent.createExecutor`
   * beside the meter; absent under a test that builds the stage alone.
   */
  readonly evictedTurns?: EvictedTurnsHandle;
}

/** The last-tool-result pin's own name — what ITS stand-down reads (9.57.0). */
const LAST_TOOL_RESULT_PIN: ReadonlySet<WindowRefusalReason> = new Set<WindowRefusalReason>([
  'last-tool-result',
]);
/**
 * The whole pin FAMILY — what the ledger-fact pin's stand-down reads
 * (9.102.0). Both names, because `refusalFor` reports the recency pin first:
 * a turn held by both pins is named `'last-tool-result'`, and a fact
 * stand-down that read only its own name would never see that turn blocking.
 * The two pins would then alternate — the recency pin standing down on a
 * visit the fact pin does not, the fact pin on a visit the recency pin does
 * not, each visit's refusal wearing the other's name — and the window would
 * never shrink. Reading the family closes that: on the visit the recency pin
 * stands down, the fact pin stands down with it, and the turn leaves.
 */
const ANY_PIN: ReadonlySet<WindowRefusalReason> = new Set<WindowRefusalReason>([
  'last-tool-result',
  'ledger-fact',
]);

/**
 * True when a pin is PROVABLY what is stopping the window from shrinking:
 * the two most recent visits both removed nothing AND both named one of
 * `reasons`.
 *
 * Two, not one: a single blocked boundary is ordinary (the next tool result
 * arrives and the pin moves). Two in a row with the pin named in both is
 * non-progress, and the pin releases for one visit rather than let a window
 * grow without bound — which is reachable under `summarizeOldest`, where a
 * lone existing summary sitting in front of a pinned turn short-circuits the
 * whole plan to "remove nothing" for ever.
 *
 * Deliberately a release-under-PROVEN-NON-PROGRESS rule and not a
 * release-under-budget-pressure one: budget pressure peaks exactly when the
 * model is most likely to fabricate, which is the worst moment to throw its
 * evidence away.
 *
 * It reads the REFUSALS, not the observations blocks: a block is absent when
 * a pin held nothing, while a refusal is present exactly when a pin blocked
 * a turn — and when nothing left, every candidate's refusal is on the
 * record, so a blocking pin is always named.
 *
 * @param reasons which pin names count — the recency pin reads its own
 *   (`LAST_TOOL_RESULT_PIN`), the fact pin reads the family (`ANY_PIN`), and
 *   the constant above says why. On an agent without `.findings()` the
 *   family never contains a `'ledger-fact'` row, so the two readings agree
 *   and the recency pin's stand-down is the exact rule it was.
 */
function pinIsBlocking(
  records: readonly WindowRecord[],
  reasons: ReadonlySet<WindowRefusalReason>,
): boolean {
  const recent = records.slice(-2);
  return (
    recent.length === 2 &&
    recent.every(
      (r) => r.removedMessageCount === 0 && r.refusals.some((f) => reasons.has(f.reason)),
    )
  );
}

/**
 * The standing of every tool result that left, as the model had declared it
 * (9.102.0) — `WindowRecord.droppedStandings`. Absent `standing` is
 * UNDECLARED, never defaulted. A result with no id cannot be on the ledger
 * and is not listed; an empty list is `undefined`, so a visit that dropped
 * no tool result writes no key.
 */
function droppedStandingsOf(
  evicted: readonly LLMMessage[],
  fold: LedgerFold,
): readonly { readonly toolCallId: string; readonly standing?: Standing }[] | undefined {
  const rows: { readonly toolCallId: string; readonly standing?: Standing }[] = [];
  for (const msg of evicted) {
    if (msg.role !== 'tool' || msg.toolCallId === undefined || msg.toolCallId.length === 0) {
      continue;
    }
    const standing = fold.standingOf.get(msg.toolCallId)?.standing;
    rows.push({ toolCallId: msg.toolCallId, ...(standing !== undefined && { standing }) });
  }
  return rows.length > 0 ? rows : undefined;
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
    // Read once, used three times: the append below, the recency pin's
    // stand-down check (9.57.0) and the fact pin's (9.102.0). One tracked
    // read of the same key either way.
    const priorRecords = (scope.compactions as readonly WindowRecord[] | undefined) ?? [];
    const pausedToolCallId = scope.pausedToolCallId as string | undefined;
    // The one message this run is executing (9.55.0). `scope.userMessage` is
    // what the seed stage committed, so the match is against the run's own
    // copy rather than a guess from position — see window/currentRequest.ts
    // for what happens when the window was seeded from somewhere else.
    const currentRequestIndex = currentRequestIndexOf(
      history,
      scope.userMessage as string | undefined,
    );
    // The last-tool-result pin (9.57.0). Candidates are resolved here, in the
    // stage, for the same reason the anchor is: this is the one place holding
    // the window, the anchor and the run's own state together. The CEILING is
    // spent inside `planRemoval`, where the keep window is known — a pin that
    // is already safe must not spend a slot.
    const limit =
      deps.keepLastToolResults === false
        ? 0
        : deps.keepLastToolResults ?? DEFAULT_KEEP_LAST_TOOL_RESULTS;
    const standDown = limit > 0 && pinIsBlocking(priorRecords, LAST_TOOL_RESULT_PIN);
    const pins =
      limit > 0 && !standDown ? toolResultPinsOf(turns, history, currentRequestIndex) : [];

    // The findings ledger (9.102.0), under the ONE gate. Read once, here,
    // beside `compactions` — a TypedScope array read is a live proxy view,
    // so it is spread into a plain array before the fold. Never on an
    // unarmed agent: that key never exists there, and a tracked read of an
    // always-absent key is the phantom-context-source defect
    // `window/evictedTurns.ts` documents. The fold serves three readers
    // below — the pin's standing, the strategy's `standingOf`, and the
    // record's `droppedStandings` — all from this one read.
    const fold: LedgerFold | undefined =
      deps.hasFindingsLedger === true
        ? foldLedger([...((scope.findingsLedger as FindingsLedger | undefined) ?? [])])
        : undefined;
    // A turn's standing is its most valuable result's — the
    // `ledgerFactPins.ts · turnStandingOf` rule — and the ONE function is
    // handed to both the pin and the strategy, so they cannot disagree.
    const standingOf =
      fold === undefined
        ? undefined
        : (turn: Turn): Standing | undefined =>
            turnStandingOf(turn, (id) => fold.standingOf.get(id)?.standing);
    // The ledger-fact pin's ceiling, already resolved by `Agent` (absent =
    // unarmed = no hold; 0 = the hold is off). Its stand-down reads the whole
    // pin family — `ANY_PIN` says why — and, like the recency pin's, is a
    // decision filed on the record even though it kept nothing.
    const factLimit = fold === undefined ? 0 : deps.keepLedgerFacts ?? 0;
    const factStandDown = factLimit > 0 && pinIsBlocking(priorRecords, ANY_PIN);
    const factPins =
      factLimit > 0 && !factStandDown && standingOf !== undefined
        ? ledgerFactPinsOf(turns, history, standingOf, currentRequestIndex)
        : [];

    const guards: RemovalGuards = {
      answeredCallIds: answeredCallIds(history),
      ...(currentRequestIndex >= 0 && { currentRequestIndex }),
      ...(pausedToolCallId !== undefined && { pausedToolCallId }),
      ...(scope.pausedCheckIn === true && { pausedCheckIn: true }),
      // Value-conditional: with no pinnable result the guards are the exact
      // object this stage has always built.
      ...(pins.length > 0 && { toolResultPins: pins, keepLastToolResults: limit }),
      ...(factPins.length > 0 && { ledgerFactPins: factPins, keepLedgerFacts: factLimit }),
    };

    // What each pin actually did, captured off the plan the strategy asked
    // for. A strategy may ask more than once; the last answer is the one that
    // decided the window.
    let observed: WindowObservations | undefined;
    let observedFacts: WindowObservations | undefined;

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
      planRemoval: (keepRecentTurns, isExistingSummary) => {
        const plan = planRemoval(turns, keepRecentTurns, guards, isExistingSummary);
        if (plan.observations !== undefined) observed = plan.observations;
        if (plan.ledgerFacts !== undefined) observedFacts = plan.ledgerFacts;
        return plan;
      },
      removalFacts: (indices, atMs) => removalFacts(origins, indices, atMs),
      // Value-conditional (9.102.0): an unarmed agent's strategy is handed the
      // exact input object it always was — `keys(on)` = `keys(off)`.
      ...(standingOf !== undefined && { standingOf }),
    });

    // `undefined` = this strategy did not engage this iteration. Nothing to
    // apply, nothing to record — the ledger tracks what a strategy DID. The
    // receipt's seam is still told "nothing left", so this visit stands on
    // its own rather than on whatever the previous one filed.
    if (result === undefined) {
      deps.evictedTurns?.file(iteration, []);
      return;
    }

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

    // The record's honesty pass (9.57.0). The strategy files WHAT it did; the
    // stage — which is the one place that holds the pre-change window and the
    // eviction indices together — files WHOSE EVIDENCE left. It is stamped
    // here rather than inside a strategy so a strategy a consumer wrote gets
    // it too, and so it is filed on the removals that authored no notice at
    // all: a drop further into the window tells the model nothing, and then
    // the record is the only place the fact exists.
    const evicted = result.evictions
      .map((e) => history[e.index])
      .filter((m): m is LLMMessage => m !== undefined);
    // The same turns, handed to this iteration's receipt (9.93.0): the mint
    // hashes each one as `messages.entries` hashed it when it was served, so
    // a drop on epoch k's receipt pairs with the turn on an earlier epoch's.
    // Filed even when empty, so a stale entry from a visit that removed
    // something cannot outlive the visit that removed nothing.
    deps.evictedTurns?.file(iteration, evicted);
    const droppedObservations = droppedToolNames(evicted, history);
    // A stand-down is a decision, so it is filed even though it kept nothing.
    const observations: WindowObservations | undefined = standDown
      ? { pinned: [], yielded: 0, limit, standDown: true }
      : observed;
    // The ledger-fact pin's block (9.102.0), the same law: filed when it held
    // a turn, turned one away, or stood down — and never on an unarmed agent,
    // where `factLimit` is 0 and no plan ever carried `ledgerFacts`.
    const ledgerFacts: WindowObservations | undefined = factStandDown
      ? { pinned: [], yielded: 0, limit: factLimit, standDown: true }
      : observedFacts;
    // WHOSE STANDING left (9.102.0), beside whose evidence: the model's own
    // claim about each dropped result, joined by id on the one fold read
    // above. Armed only — `fold` is undefined on every unarmed agent — so an
    // unarmed record is byte-identical to what this stage always filed.
    const droppedStandings = fold === undefined ? undefined : droppedStandingsOf(evicted, fold);
    const record: WindowRecord =
      droppedObservations.length > 0 ||
      observations !== undefined ||
      ledgerFacts !== undefined ||
      droppedStandings !== undefined
        ? {
            ...result.record,
            ...(droppedObservations.length > 0 && { droppedObservations }),
            ...(observations !== undefined && { observations }),
            ...(ledgerFacts !== undefined && { ledgerFacts }),
            ...(droppedStandings !== undefined && { droppedStandings }),
          }
        : result.record;

    const prior = priorRecords;
    scope.compactions = [...prior, record];

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
