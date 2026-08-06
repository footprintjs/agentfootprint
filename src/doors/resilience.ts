/**
 * agentfootprint/resilience — what happens when the call fails.
 *
 * Both halves of staying up, behind one name:
 *
 *   • Provider decorators — `withRetry`, `withFallback`, `fallbackProvider`,
 *     `withCircuitBreaker`. Each preserves the `LLMProvider` interface, so
 *     they stack freely around any provider.
 *   • The rules engine — `.reliability({ postDecide: [...] })`'s typed rule
 *     shapes, the fail-fast error, the pure breaker state machine, and the
 *     schema-retry helpers.
 *
 * ## One name that exists twice, said out loud
 *
 * `CircuitOpenError` is TWO different classes: the decorator throws one
 * (`src/resilience/withCircuitBreaker.ts`), the reliability gate throws
 * another (`src/reliability/CircuitBreaker.ts`), and they differ in
 * constructor and in `instanceof`. This door carries the DECORATOR's — the
 * one a consumer catches, since it is the one that escapes a provider call.
 *
 * The gate's stays reachable at `agentfootprint/reliability` for all of 8.x.
 * If you `instanceof`-check the error thrown by the reliability gate, keep
 * importing it from there. Merging them would have changed the message text
 * on one path, and this release changes packaging only.
 *
 * `CircuitState` also exists twice, but the two are byte-identical
 * (`'closed' | 'open' | 'half-open'`), so the one re-exported here satisfies
 * both and no consumer can tell the difference.
 *
 * @example
 * ```ts
 * import { withRetry, withFallback, type ReliabilityRule } from 'agentfootprint/resilience';
 * ```
 */

// The decorators, whole. This is also where the door's `CircuitOpenError`
// and `CircuitState` come from — see the note above.
export * from '../resilience/index.js';

// The rules engine, named explicitly rather than starred, because two of its
// names are already spoken for above and an ambiguous `export *` would not
// compile (TS2308). Everything else it exports is listed here.
export type {
  BreakerState,
  CircuitBreakerConfig,
  OutputSchemaValidator,
  ReliabilityConfig,
  ReliabilityDecision,
  ReliabilityFallbackFn,
  ReliabilityProvider,
  ReliabilityRule,
  ReliabilityScope,
} from '../reliability/index.js';
export {
  defaultStuckLoopRule,
  initialBreakerState,
  lastNValidationErrorsMatch,
  ReliabilityFailFastError,
  ValidationFailure,
} from '../reliability/index.js';
