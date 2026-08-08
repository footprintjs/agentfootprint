/**
 * Reliability — public surface for the v2.11.1 rules-based reliability
 * subsystem. Internal-only helpers (CircuitBreaker class, classifyError,
 * buildReliabilityGate) live in their own files; this barrel exports
 * the consumer-facing types and the typed error.
 *
 * Consumer use:
 * ```ts
 * import { Agent } from 'agentfootprint';
 * import type { ReliabilityRule, ReliabilityScope } from 'agentfootprint/reliability';
 * import { ReliabilityFailFastError } from 'agentfootprint/reliability';
 *
 * const agent = Agent.create({...}).reliability({
 *   postDecide: [
 *     { when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
 *       then: 'retry', kind: 'transient-retry' },
 *     { when: (s) => s.error !== undefined,
 *       then: 'fail-fast', kind: 'unrecoverable' },
 *   ],
 * }).build();
 *
 * try {
 *   await agent.run({ message: '...' });
 * } catch (e) {
 *   if (e instanceof ReliabilityFailFastError) {
 *     console.log(e.kind, e.reason);
 *   }
 * }
 * ```
 *
 * `CircuitOpenError` is the one name that does NOT move: the gate throws a
 * different class than the provider decorator does, so this path stays the
 * only home for it. Everything else here is also on the new door.
 *
 * ## Why this path survived 9.0.0
 *
 * 9.0.0 removed the other sixteen 8.0.0 door aliases. This one stayed, and the
 * reason is that ONE name: the gate's `CircuitOpenError` and the decorator's
 * are two different classes with different constructors and different
 * `instanceof` answers, `agentfootprint/resilience` carries the decorator's,
 * and a name cannot be exported twice from one door. Removing this path would
 * not have renamed the gate's error — it would have made it unreachable, so a
 * consumer could no longer `instanceof`-check the error their own reliability
 * gate throws. That is a capability, not a spelling, so the path stayed.
 *
 * @deprecated Since 8.0.0 for every name EXCEPT `CircuitOpenError` — those all
 * live on `agentfootprint/resilience`, which is the door to prefer. This path
 * is NOT scheduled for removal: it is the only home of the reliability gate's
 * `CircuitOpenError`, and the removal date announced in 8.0.0 is withdrawn.
 */

export type {
  CircuitBreakerConfig,
  ReliabilityConfig,
  ReliabilityDecision,
  ReliabilityFallbackFn,
  ReliabilityProvider,
  ReliabilityRule,
  ReliabilityScope,
} from './types.js';

export { ReliabilityFailFastError } from './types.js';

// CircuitBreaker pure-state-machine surface — exposed so consumers can
// hydrate breaker state from a persistence store (Redis/DynamoDB) or
// inspect projected state in their own observability adapters.
export {
  CircuitOpenError,
  initialBreakerState,
  type BreakerState,
  type CircuitState,
} from './CircuitBreaker.js';

// v2.13 — Instructor-style schema-retry helpers. `ValidationFailure` is
// the sentinel error type a custom output validator can throw; the
// reliability loop unwraps it to drive the schema-fail branch.
// `lastNValidationErrorsMatch` + `defaultStuckLoopRule` short-circuit
// stuck retry loops where the model keeps making the same mistake.
export {
  ValidationFailure,
  lastNValidationErrorsMatch,
  defaultStuckLoopRule,
} from '../core/agent/stages/reliabilityExecution.js';
export type { OutputSchemaValidator } from '../core/agent/stages/reliabilityExecution.js';
