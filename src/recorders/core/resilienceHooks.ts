/**
 * resilienceHooks — turns a resilience decorator's `ResilienceReport`
 * into an already-declared typed event, emitted from inside the run.
 *
 * Pattern: Adapter (GoF) — one translation function, fact → event.
 * Role:    The seam between `src/resilience/` (which knows nothing about
 *          runs, scopes or events) and the in-run LLM call sites (which
 *          hold a live scope). The decorator REPORTS; this maps the
 *          report to `typedEmit`, so correlation ids come from
 *          footprintjs's traversal rather than being synthesized.
 * Emits:   agentfootprint.fallback.triggered
 *          agentfootprint.error.retried
 *          agentfootprint.error.recovered
 *
 * Why here and not in the decorators: a decorator is constructed by the
 * consumer BEFORE any run exists, so it can never reach a scope. Passing
 * the hooks object per call is what lets the report cross that boundary.
 *
 * Every declared payload field is filled from a report field of the same
 * name — nothing is synthesized. `FallbackTriggeredPayload.kind` is the
 * literal `'provider'`; its `'tool'`/`'skill'` arms stay unused.
 */

import type { LLMCallHooks } from '../../adapters/types.js';
import { typedEmit, type EmitableScope } from './typedEmit.js';

/**
 * Build the per-call hooks object for one stage. Hoist it once per stage
 * rather than per attempt — it is stateless and safe to reuse across
 * reliability-loop iterations.
 *
 * @example
 *   const providerHooks = resilienceHooks(scope);
 *   const response = await provider.complete(request, providerHooks);
 */
export function resilienceHooks(scope: EmitableScope): LLMCallHooks {
  return {
    onResilience(report): void {
      // The library owns THIS sink, and it is the only one that runs
      // in-run — so guard it once here. Telemetry must never break an
      // LLM call (footprintjs's "recorder errors never abort traversal"
      // invariant). A CONSUMER-supplied onResilience is deliberately
      // unguarded, matching onRetry/onFallback/onStateChange.
      try {
        switch (report.kind) {
          case 'fell-back':
            typedEmit(scope, 'agentfootprint.fallback.triggered', {
              kind: 'provider',
              primary: report.primary,
              fallback: report.fallback,
              reason: report.reason,
            });
            return;
          case 'retried':
            typedEmit(scope, 'agentfootprint.error.retried', {
              attempt: report.attempt,
              maxAttempts: report.maxAttempts,
              lastError: report.lastError,
              backoffMs: report.backoffMs,
              reason: report.reason,
            });
            return;
          case 'recovered':
            typedEmit(scope, 'agentfootprint.error.recovered', {
              attempt: report.attempt,
              totalDurationMs: report.totalDurationMs,
            });
            return;
        }
      } catch {
        // Swallowed by design — see the comment above.
      }
    },
  };
}
