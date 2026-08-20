/**
 * cacheRecorder() — the cache layer's meter.
 *
 * Subscribes to:
 *   - `FlowRecorder.onDecision` — CacheGate routing decisions
 *     (apply-markers / no-markers + the rule that fired + evidence from
 *     `decide()`).
 *   - `agentfootprint.stream.llm_end` — reads that event's `usage` (the PORT
 *     shape: `{ input, output, cacheRead?, cacheWrite? }`) and asks the
 *     agent's `CacheStrategy.extractMetrics` what is known about it.
 *
 * Produces: a per-turn report via `recorder.report()` — token tallies, hit
 * rate and dollar estimates, each carried as a `Claim` so an UNMEASURED turn
 * can never render as a zero one.
 *
 * ── Why every number here is a Claim (9.59.0) ─────────────────────────
 * The shipped 9.58.0 meter reported `hitRate: 0` for a 20-call turn that hit
 * cache on every call. Two faults, and the second is why the first went
 * unnoticed for so long: (1) the strategies parsed RAW WIRE field names off a
 * value that carries the PORT shape, so every field read `undefined`; (2) the
 * report typed its aggregates as bare `number`, so "nobody measured" and
 * "measured, and it was zero" rendered identically. Fixing (1) alone would
 * have left a meter that still cannot say "unmeasured" — hence `Claim<T>`,
 * plus `measuredIterations` / `unmeasuredIterations` so a rate computed from
 * 3 of 20 calls states its own denominator.
 *
 * Read the number through `isKnown(report.hitRate)` (or `describeClaim` for a
 * one-line render). There is deliberately no door that hands you a bare
 * number without your having branched.
 *
 * ── And an unknown carries ITS OWN reason (9.59.1) ────────────────────
 * 9.59.0 enforced that law per call and then broke it in `report()`, which
 * hardcoded "the provider reported no cache fields" for the whole turn no
 * matter what the rows said. With no strategy passed and a provider that DID
 * report cache fields, the row said "nothing read the usage" and the summary
 * blamed the provider — pointing the reader away from their actual mistake.
 * The summary now carries the rows' own reasons, and says so plainly when the
 * rows disagree rather than picking one.
 *
 * ── What this recorder does NOT do ────────────────────────────────────
 * It emits no events. (Earlier prose here promised per-iteration
 * `agentfootprint.cache.applied` / `agentfootprint.cache.metrics` events;
 * neither name has ever existed in the event registry and no `typedEmit` has
 * ever been in this file. The prose was the bug.)
 *
 * It does not write `scope.recentHitRate` back into agent state either, so
 * CacheGate's hit-rate-floor rule never fires on its own — the loop is
 * severed at both ends (the key is seeded `undefined` and written by
 * nothing). Recorders do not write to chart scope, so closing that loop needs
 * an agent-side accessor convention; it is separable work from measuring the
 * number, which is what this file now does.
 */

import type { CombinedRecorder } from 'footprintjs';
import type { FlowDecisionEvent } from 'footprintjs';
import { splitStageId } from 'footprintjs/trace';
import { STAGE_IDS } from '../conventions.js';
import type { AgentfootprintEvent } from '../events/registry.js';
import type { CacheMetrics, CacheStrategy, CacheUsage } from './types.js';
import type { PricingTable } from '../adapters/types.js';
import { known, unknown, isKnown, type Claim } from '../lib/claim/claim.js';

/** One LLM call's row on the record. */
export interface PerIterEntry {
  readonly iteration: number;
  readonly branch: 'apply-markers' | 'no-markers';
  readonly rule?: string;
  /**
   * What the strategy could say about this call's cache traffic. `known` =
   * the provider reported counts; `unknown` = nothing was measured;
   * `not-applicable` = this adapter cannot report cache usage at all.
   */
  readonly metrics: Claim<CacheMetrics>;
  /** Dollar estimates, `unknown` on any call whose metrics were not known. */
  readonly dollarsSpent: Claim<number>;
  readonly dollarsSavedVsNoCache: Claim<number>;
}

/**
 * The turn's tally. Every quantity derived from provider usage is a
 * {@link Claim}: unmeasured is a first-class answer, never a zero.
 */
export interface CacheReportSummary {
  /** LLM calls seen. Always known — the recorder counted them itself. */
  readonly totalIterations: number;
  readonly applyMarkersIterations: number;
  readonly noMarkersIterations: number;
  /**
   * Calls whose cache traffic the provider actually reported. The DENOMINATOR
   * every claim below is computed over — a rate from 3 of 20 calls is not the
   * turn's rate, and this is how a reader can tell.
   */
  readonly measuredIterations: number;
  /** Calls that reported nothing (no usage, no cache fields, or an adapter that cannot). */
  readonly unmeasuredIterations: number;
  readonly cacheReadTokensTotal: Claim<number>;
  readonly cacheWriteTokensTotal: Claim<number>;
  readonly freshInputTokensTotal: Claim<number>;
  /** cacheRead / (cacheRead + cacheWrite + fresh), over MEASURED calls only. */
  readonly hitRate: Claim<number>;
  readonly estimatedDollarsSpent: Claim<number>;
  readonly estimatedDollarsSavedVsNoCache: Claim<number>;
  readonly perIter: readonly PerIterEntry[];
}

export interface CacheRecorderOptions {
  /**
   * The agent's CacheStrategy — the thing that reads the port usage. Without
   * one every row's metrics are `unknown` (with that as the stated reason),
   * which is the honest answer: nothing read the usage.
   */
  readonly strategy?: CacheStrategy;
  /**
   * PricingTable for dollar estimates. Falls back to token-count-only
   * reporting when omitted. Looks up `'input'` / `'cacheRead'` /
   * `'cacheWrite'` token kinds (PricingTable already supports these
   * as of v2.5).
   */
  readonly pricing?: PricingTable;
  /**
   * Model id for pricing lookup. Defaults to a placeholder; set to
   * the actual model the agent is using for accurate dollar math.
   */
  readonly model?: string;
}

export interface CacheRecorderHandle extends CombinedRecorder {
  /**
   * Build a per-turn report. Call after `agent.run()` completes.
   * Returns a frozen snapshot — recorder keeps accumulating but the
   * report you held is stable.
   */
  report(): CacheReportSummary;
  /**
   * Reset accumulated state. Call between turns if you want
   * per-turn rather than per-session reporting.
   */
  reset(): void;
}

/**
 * How many distinct reasons a disagreeing summary spells out before it
 * switches to counting the rest. A summary sentence must stay readable.
 */
const MAX_LISTED_REASONS = 3;

/** The metrics of a row already filtered by `isKnown`. Narrowing helper only. */
function valueOfMetrics(entry: PerIterEntry): CacheMetrics {
  return isKnown(entry.metrics)
    ? entry.metrics.value
    : { cacheReadTokens: 0, cacheWriteTokens: 0, freshInputTokens: 0 };
}

export function cacheRecorder(options: CacheRecorderOptions = {}): CacheRecorderHandle {
  const perIter: PerIterEntry[] = [];
  let lastDecision: { branch: 'apply-markers' | 'no-markers'; rule?: string } | undefined;
  let iterationCounter = 0;

  function dollars(tokens: number, kind: 'input' | 'cacheRead' | 'cacheWrite'): number {
    if (!options.pricing) return 0;
    const model = options.model ?? 'unknown';
    return tokens * options.pricing.pricePerToken(model, kind);
  }

  const handle = {
    id: 'cache-recorder',

    onDecision(event: FlowDecisionEvent): void {
      // Only care about CacheGate decisions, matched by the decider's LOCAL
      // stage id. Both `event.decider` (the node NAME) and the prefixed
      // `traversalContext.stageId` become `sf-cache/…` now that CacheGate is
      // nested in sf-cache, so we strip the subflow path with splitStageId and
      // compare the local id. This is id-stable (survives a display-name
      // rename) and nesting-safe (works top-level or inside sf-cache).
      // (The old `event.decider !== 'cache-gate'` was a no-op: event.decider is
      // the NAME 'CacheGate', never the id 'cache-gate'.)
      const stageId = event.traversalContext?.stageId;
      if (!stageId || splitStageId(stageId).localStageId !== STAGE_IDS.CACHE_GATE) return;
      const matched = event.evidence?.rules.find((r) => r.matched);
      lastDecision = {
        branch: event.chosen as 'apply-markers' | 'no-markers',
        ...(matched?.label !== undefined && { rule: matched.label }),
      };
    },

    onEmit(event: AgentfootprintEvent): void {
      if (event.type !== 'agentfootprint.stream.llm_end') return;
      iterationCounter++;
      // The PORT shape, which is the only shape this event has ever carried.
      const usage = (event.payload as { usage?: CacheUsage }).usage;
      const metrics: Claim<CacheMetrics> =
        options.strategy === undefined
          ? unknown('no CacheStrategy was given to cacheRecorder(), so nothing read the usage')
          : options.strategy.extractMetrics(usage);
      const branch = lastDecision?.branch ?? 'apply-markers';
      // Compute dollar math:
      //   spent = freshInput * inputPrice
      //         + cacheRead * cacheReadPrice
      //         + cacheWrite * cacheWritePrice
      //   no-cache cost = (freshInput + cacheRead + cacheWrite) * inputPrice
      //   saved        = no-cache cost - spent
      let dollarsSpent: Claim<number>;
      let savedVsNoCache: Claim<number>;
      if (isKnown(metrics)) {
        const m = metrics.value;
        const spent =
          dollars(m.freshInputTokens, 'input') +
          dollars(m.cacheReadTokens, 'cacheRead') +
          dollars(m.cacheWriteTokens, 'cacheWrite');
        const noCacheCost = dollars(
          m.freshInputTokens + m.cacheReadTokens + m.cacheWriteTokens,
          'input',
        );
        const ev =
          options.pricing === undefined
            ? 'measured tokens, but no PricingTable was given — every price is 0'
            : 'measured tokens priced with the given PricingTable';
        dollarsSpent = known(spent, ev);
        savedVsNoCache = known(noCacheCost - spent, ev);
      } else {
        // No tokens measured ⇒ no dollars. Carrying the metrics claim's own
        // reason forward is what keeps a $0 estimate from reading as "free".
        const why =
          metrics.kind === 'unknown'
            ? metrics.reason
            : `no cache tokens are measurable here — ${metrics.evidence}`;
        dollarsSpent = unknown<number>(why);
        savedVsNoCache = unknown<number>(why);
      }
      const entry: PerIterEntry = {
        iteration: iterationCounter,
        branch,
        ...(lastDecision?.rule !== undefined && { rule: lastDecision.rule }),
        metrics,
        dollarsSpent,
        dollarsSavedVsNoCache: savedVsNoCache,
      };
      perIter.push(entry);
      lastDecision = undefined;
    },

    report(): CacheReportSummary {
      const apply = perIter.filter((p) => p.branch === 'apply-markers').length;
      const skip = perIter.filter((p) => p.branch === 'no-markers').length;
      const measured = perIter.filter((p) => isKnown(p.metrics));
      const n = measured.length;
      const total = perIter.length;

      // ONE reason, stated once, reused by every claim below — so a reader
      // who prints any single field learns why the whole report is empty.
      //
      // ── The summary CARRIES the rows' reasons; it never invents one (9.59.1)
      // 9.59.0 hardcoded 'the provider reported no cache fields' here. That
      // sentence is a fabrication whenever the rows said something else — most
      // painfully when no CacheStrategy was passed and the provider DID report
      // cacheRead/cacheWrite: the rows said "nothing read the usage", and the
      // summary blamed the provider for the caller's own omission. An unknown
      // must carry ITS OWN reason. That is the law this file exists to
      // enforce, and this is it applied to the summary too.
      const unmeasured = perIter.filter((p) => !isKnown(p.metrics));
      const reasons: string[] = [];
      for (const row of unmeasured) {
        const m = row.metrics;
        // `unmeasured` already excluded 'known'; this narrows the type.
        if (isKnown(m)) continue;
        const stated =
          m.kind === 'not-applicable' ? `this provider cannot report it (${m.evidence})` : m.reason;
        if (!reasons.includes(stated)) reasons.push(stated);
      }
      // Rows can disagree — a turn may mix an adapter that cannot report with
      // calls that carried no usage at all. Picking one silently would state a
      // cause for calls that stated a different one, so the summary says there
      // was more than one and lists them. Bounded by construction: at most
      // MAX_LISTED_REASONS are spelled out and the remainder is COUNTED, so a
      // strategy whose reason varies per call cannot grow this into a wall.
      const listed = reasons.slice(0, MAX_LISTED_REASONS);
      const remaining = reasons.length - listed.length;
      const [onlyReason] = reasons;
      const carried =
        reasons.length === 1 && onlyReason !== undefined
          ? onlyReason
          : `the calls did not agree on why — ${reasons.length} different reasons were ` +
            `given: ${listed.map((r, i) => `(${i + 1}) ${r}`).join('; ')}` +
            (remaining > 0 ? `; and ${remaining} more not listed here` : '');
      const why =
        total === 0
          ? 'no LLM call was observed, so there is nothing to measure'
          : reasons.length === 0
          ? // Unreachable where `why` is USED (it is read only when nothing
            // was measured, and an unmeasured row always states a reason).
            `all ${total} observed call(s) reported cache usage`
          : `none of the ${total} observed call(s) reported cache usage — ${carried}`;
      const evidence = `summed over the ${n} of ${total} call(s) whose usage was measured`;
      const claimOf = (value: number): Claim<number> =>
        n === 0 ? unknown<number>(why) : known(value, evidence);

      const cacheRead = measured.reduce((s2, p) => s2 + valueOfMetrics(p).cacheReadTokens, 0);
      const cacheWrite = measured.reduce((s2, p) => s2 + valueOfMetrics(p).cacheWriteTokens, 0);
      const fresh = measured.reduce((s2, p) => s2 + valueOfMetrics(p).freshInputTokens, 0);
      const requestTotal = cacheRead + cacheWrite + fresh;
      const dollarsSpent = measured.reduce(
        (s2, p) => s2 + (isKnown(p.dollarsSpent) ? p.dollarsSpent.value : 0),
        0,
      );
      const dollarsSaved = measured.reduce(
        (s2, p) => s2 + (isKnown(p.dollarsSavedVsNoCache) ? p.dollarsSavedVsNoCache.value : 0),
        0,
      );

      return Object.freeze({
        totalIterations: total,
        applyMarkersIterations: apply,
        noMarkersIterations: skip,
        measuredIterations: n,
        unmeasuredIterations: total - n,
        cacheReadTokensTotal: claimOf(cacheRead),
        cacheWriteTokensTotal: claimOf(cacheWrite),
        freshInputTokensTotal: claimOf(fresh),
        // A measured turn with zero prompt tokens is not a thing; guard it
        // anyway rather than divide by zero and hand back NaN as a rate.
        hitRate:
          n === 0
            ? unknown<number>(why)
            : requestTotal === 0
            ? unknown<number>(
                `the ${n} measured call(s) reported 0 prompt tokens in total, so a hit rate has no denominator`,
              )
            : known(cacheRead / requestTotal, evidence),
        estimatedDollarsSpent: claimOf(dollarsSpent),
        estimatedDollarsSavedVsNoCache: claimOf(dollarsSaved),
        perIter: Object.freeze([...perIter]),
      });
    },

    reset(): void {
      perIter.length = 0;
      lastDecision = undefined;
      iterationCounter = 0;
    },
  };

  return handle as unknown as CacheRecorderHandle;
}
