'use client';

import { revealer } from '@/lib/features/useAdditiveSteps';

/**
 * 08 SURVIVE — the primary provider goes red, the fallback route draws in green and traffic
 * reroutes, then the checkpoint chip slides in and the bar refills. Nothing already drawn
 * disappears: the failed node STAYS on the canvas, marked, which is the honest picture of a
 * failover (you can still see what broke).
 *
 * What's real behind it: `withRetry` (src/resilience/withRetry.ts:61) / `withFallback`
 * (withFallback.ts:48) / `fallbackProvider` (fallbackProvider.ts:35) / `withCircuitBreaker`
 * (withCircuitBreaker.ts:159) all wrap any LLMProvider, and a run resumes from its last
 * checkpoint — see content/docs/monitor/resilience.mdx (this beat's Read-more).
 */
export function SurviveStage({ step }: { step: number }) {
  const on = revealer(step);

  return (
    <div className="aff-survive">
      <div className="aff-failover">
        <svg viewBox="0 0 722 200" preserveAspectRatio="none" aria-hidden="true">
          {/* the primary route — struck dead once the provider fails */}
          <path className={`aff-route-dead ${on(2)}`} d="M118 62 H 208 M 244 62 H 328" strokeDasharray="5 7" />
          {/* the fallback route */}
          <path className={`aff-route-ok ${on(3)}`} d="M118 74 C 210 110, 260 148, 332 148" strokeDasharray="6 5" />
        </svg>

        <span className={`aff-node is-run ${on(1)}`} style={{ left: '3.3%', top: '31%' }}>
          run #418
        </span>
        <span className={`aff-node is-dead ${on(2)}`} style={{ left: '46.3%', top: '31%' }}>
          anthropic <span className="x">✕</span>
        </span>
        <span className={`aff-node is-ok ${on(3)}`} style={{ left: '46.8%', top: '74%' }}>
          openai <span className="aff-okdot" aria-hidden="true" />
        </span>
        <span className={`aff-reroute ${on(4)}`} style={{ left: '65.1%', top: '74%' }}>
          ← rerouted
        </span>
      </div>

      <div className={`aff-ckpt ${on(5)}`}>
        <span className="aff-ckpt-chip">ckpt 12</span>
        <span className="aff-ckpt-track">
          <span className="aff-ckpt-fill" />
        </span>
        <span className="aff-ckpt-note">resumed · step 12</span>
      </div>
    </div>
  );
}
