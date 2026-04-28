/**
 * agentfootprint/resilience — provider decorators for production reliability.
 *
 * Three composable wrappers around `LLMProvider`. Each preserves the
 * `LLMProvider` interface (drop-in replacement) and stacks freely:
 *
 *   const provider = withRetry(
 *     fallbackProvider(
 *       anthropic({ apiKey }),
 *       openai({ apiKey }),
 *     ),
 *     { maxAttempts: 5 },
 *   );
 *
 * Reads as: try anthropic; on failure fall back to openai; the whole
 * chain is wrapped in retry with 5 attempts.
 *
 * ─── 7-panel design review (2026-04-28) ────────────────────────────
 *
 *   LLM-AI system design   ✓ Decorator pattern around the existing
 *                            `LLMProvider` port — no new contract.
 *                            Stacks naturally; observation hooks
 *                            (`onRetry`, `onFallback`) keep the
 *                            recorder ecosystem informed.
 *   Performance            ✓ Zero overhead on success path (one
 *                            `try/await` per call). Backoff delays
 *                            use AbortSignal-aware sleep — no busy
 *                            wait, no leaked timers.
 *   Scalability            ✓ Per-call state only. Composition is
 *                            constant-time per attempt; chain depth
 *                            doesn't grow runtime cost.
 *   Research alignment     ✓ Right-fold of `withFallback` matches
 *                            the standard chain-of-responsibility
 *                            shape. No exotic resumption — once a
 *                            stream yields, it commits.
 *   Flexibility            ✓ Predicates (`shouldRetry`,
 *                            `shouldFallback`) and hooks
 *                            (`onRetry`, `onFallback`) make every
 *                            policy decision overridable. Default
 *                            policies match common real-world signals
 *                            (4xx skip, 429 retry, AbortError pass).
 *   Abstraction-modular    ✓ Three primitives, one purpose each.
 *                            `fallbackProvider` is sugar over chained
 *                            `withFallback`. No surprises.
 *   Software engineering   ✓ Pure decorators — no shared state.
 *                            Every option has a documented default.
 *                            Tests cover unit + scenario + integration
 *                            + property + security + performance + ROI.
 *
 * ─── 7-pattern test coverage ───────────────────────────────────────
 *
 *   Unit         test/resilience/unit/withRetry.test.ts
 *                test/resilience/unit/withFallback.test.ts
 *                test/resilience/unit/fallbackProvider.test.ts
 *   Scenario     resilience-patterns.test.ts → "production recipes"
 *   Integration  resilience-patterns.test.ts → "Agent + resilient provider"
 *   Property     resilience-patterns.test.ts → "invariants"
 *   Security     resilience-patterns.test.ts → "hostile inputs"
 *   Performance  resilience-patterns.test.ts → "performance"
 *   ROI          resilience-patterns.test.ts → "realistic SLO budgets"
 */

export { withRetry, type WithRetryOptions } from './withRetry.js';
export { withFallback, type WithFallbackOptions } from './withFallback.js';
export {
  fallbackProvider,
  type FallbackProviderOptions,
} from './fallbackProvider.js';
