/**
 * The reliability gate's CircuitOpenError has this one public home. The
 * provider decorator's distinct error and all shared reliability helpers
 * live on agentfootprint/resilience.
 */
export { CircuitOpenError } from './CircuitBreaker.js';
