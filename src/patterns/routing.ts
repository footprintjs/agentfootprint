import type { Runner } from '../core/runner.js';

/** One invocation's routing result. Reason is evidence, never a prompt. */
export interface RoutingDecision {
  readonly agentId?: string;
  readonly message: string;
  readonly reason?: string;
}

/** A routing strategy supplies a once-built native runner, not a lookup cache. */
export interface RoutingStrategy {
  readonly step: Runner<{ message: string }, RoutingDecision>;
}

/** Runtime boundary for a strategy implemented by JavaScript consumers. */
export function requireRoutingDecision(value: unknown): RoutingDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Swarm: router must return a RoutingDecision object');
  }
  const { message, agentId, reason } = value as Record<string, unknown>;
  if (
    typeof message !== 'string' ||
    (agentId !== undefined && typeof agentId !== 'string') ||
    (reason !== undefined && typeof reason !== 'string')
  ) {
    throw new TypeError('Swarm: invalid RoutingDecision fields');
  }
  return Object.freeze({
    message,
    ...(agentId !== undefined && { agentId }),
    ...(reason !== undefined && { reason }),
  });
}
