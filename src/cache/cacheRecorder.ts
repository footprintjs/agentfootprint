/**
 * cacheRecorder() — observability for the v2.6 cache layer.
 *
 * Subscribes to:
 *   - `FlowRecorder.onDecision` — captures CacheGate routing decisions
 *     (apply-markers / no-markers + the rule that fired + evidence
 *     from `decide()`). Read directly from `event.evidence.rules[matched]`
 *     since footprintjs already auto-captures predicate `inputs[]`.
 *   - `agentfootprint.stream.llm_end` events — read provider's `usage`
 *     and call the agent's CacheStrategy.extractMetrics() to normalize
 *     into CacheMetrics (cacheReadTokens / cacheWriteTokens / fresh).
 *
 * Produces:
 *   - per-iteration `agentfootprint.cache.applied` events (markers
 *     applied this iter or empty if skipped) — for Lens trace
 *   - per-iteration `agentfootprint.cache.metrics` events (hit/write
 *     token counts + estimated dollars via PricingTable) — for
 *     dashboards
 *   - a turn-end summary printable via `recorder.report()` —
 *     numeric tally plus dollars saved
 *
 * v2.6 LIMITATION: doesn't yet write `scope.recentHitRate` back into
 * agent state. CacheGate's hit-rate-floor rule won't fire automatically;
 * consumers can manually wire feedback via `Agent.create(...).attach(rec)`.
 * Full feedback loop deferred to v2.7 (needs an agent-side accessor
 * convention since recorders don't normally write to scope).
 */

import type { CombinedRecorder } from 'footprintjs';
import type { FlowDecisionEvent } from 'footprintjs';
import type { AgentfootprintEvent } from '../events/registry.js';
import type { CacheMetrics, CacheStrategy } from './types.js';
import type { PricingTable } from '../adapters/types.js';

interface PerIterEntry {
  readonly iteration: number;
  readonly branch: 'apply-markers' | 'no-markers';
  readonly rule?: string;
  readonly metrics?: CacheMetrics;
  readonly dollarsSpent: number;
  readonly dollarsSavedVsNoCache: number;
}

interface CacheReportSummary {
  readonly totalIterations: number;
  readonly applyMarkersIterations: number;
  readonly noMarkersIterations: number;
  readonly cacheReadTokensTotal: number;
  readonly cacheWriteTokensTotal: number;
  readonly freshInputTokensTotal: number;
  readonly hitRate: number;
  readonly estimatedDollarsSpent: number;
  readonly estimatedDollarsSavedVsNoCache: number;
  readonly perIter: readonly PerIterEntry[];
}

export interface CacheRecorderOptions {
  /**
   * The agent's CacheStrategy. Required for `extractMetrics` —
   * normalizes provider-specific `usage` shapes into CacheMetrics.
   * If not provided, recorder logs the raw usage and skips dollar math.
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
      // Only care about CacheGate decisions; identified by the
      // decider's stage id (the third arg to addDeciderFunction).
      if (event.decider !== 'cache-gate') return;
      const matched = event.evidence?.rules.find((r) => r.matched);
      lastDecision = {
        branch: event.chosen as 'apply-markers' | 'no-markers',
        ...(matched?.label !== undefined && { rule: matched.label }),
      };
    },

    onEmit(event: AgentfootprintEvent): void {
      if (event.type !== 'agentfootprint.stream.llm_end') return;
      iterationCounter++;
      const usage = (event.payload as { usage?: unknown }).usage;
      const metrics = options.strategy?.extractMetrics(usage);
      const branch = lastDecision?.branch ?? 'apply-markers';
      // Compute dollar math:
      //   spent = freshInput * inputPrice
      //         + cacheRead * cacheReadPrice
      //         + cacheWrite * cacheWritePrice
      //   no-cache cost = (freshInput + cacheRead + cacheWrite) * inputPrice
      //   saved        = no-cache cost - spent
      let dollarsSpent = 0;
      let savedVsNoCache = 0;
      if (metrics) {
        dollarsSpent =
          dollars(metrics.freshInputTokens, 'input') +
          dollars(metrics.cacheReadTokens, 'cacheRead') +
          dollars(metrics.cacheWriteTokens, 'cacheWrite');
        const noCacheCost = dollars(
          metrics.freshInputTokens + metrics.cacheReadTokens + metrics.cacheWriteTokens,
          'input',
        );
        savedVsNoCache = noCacheCost - dollarsSpent;
      }
      const entry: PerIterEntry = {
        iteration: iterationCounter,
        branch,
        ...(lastDecision?.rule !== undefined && { rule: lastDecision.rule }),
        ...(metrics !== undefined && { metrics }),
        dollarsSpent,
        dollarsSavedVsNoCache: savedVsNoCache,
      };
      perIter.push(entry);
      lastDecision = undefined;
    },

    report(): CacheReportSummary {
      const apply = perIter.filter((p) => p.branch === 'apply-markers').length;
      const skip = perIter.filter((p) => p.branch === 'no-markers').length;
      const cacheRead = perIter.reduce((s, p) => s + (p.metrics?.cacheReadTokens ?? 0), 0);
      const cacheWrite = perIter.reduce((s, p) => s + (p.metrics?.cacheWriteTokens ?? 0), 0);
      const fresh = perIter.reduce((s, p) => s + (p.metrics?.freshInputTokens ?? 0), 0);
      const totalRequest = cacheRead + cacheWrite + fresh;
      const hitRate = totalRequest > 0 ? cacheRead / totalRequest : 0;
      const dollarsSpent = perIter.reduce((s, p) => s + p.dollarsSpent, 0);
      const dollarsSaved = perIter.reduce((s, p) => s + p.dollarsSavedVsNoCache, 0);
      return Object.freeze({
        totalIterations: perIter.length,
        applyMarkersIterations: apply,
        noMarkersIterations: skip,
        cacheReadTokensTotal: cacheRead,
        cacheWriteTokensTotal: cacheWrite,
        freshInputTokensTotal: fresh,
        hitRate,
        estimatedDollarsSpent: dollarsSpent,
        estimatedDollarsSavedVsNoCache: dollarsSaved,
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
