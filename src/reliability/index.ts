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
