/**
 * a2aRunner — wraps an A2A (Agent-to-Agent) endpoint as a RunnerLike.
 *
 * A2A protocol enables agents to communicate across services.
 * This adapter bridges the A2A interface to agentfootprint's RunnerLike,
 * enabling composition in FlowChart, Swarm, or agentAsTool.
 *
 * The adapter accepts an A2AClient interface (transport-agnostic).
 * Users provide their own A2A client implementation.
 *
 * Usage:
 *   const remoteAgent = a2aRunner({
 *     client: myA2AClient,
 *     agentId: 'research-agent',
 *   });
 *   const pipeline = FlowChart.create()
 *     .agent('remote-research', 'Research', remoteAgent)
 *     .build();
 */

import type { RunnerLike } from '../../types/multiAgent';

// ── A2A Client Interface ─────────────────────────────────────

/** Minimal A2A client interface. Users bring their own implementation. */
export interface A2AClient {
  /** Send a message to an agent and get a response. */
  sendMessage(
    agentId: string,
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<A2AResponse>;
}

export interface A2AResponse {
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

// ── Runner ───────────────────────────────────────────────────

export interface A2ARunnerOptions {
  /** A2A client instance. */
  readonly client: A2AClient;
  /** ID of the remote agent. */
  readonly agentId: string;
}

export function a2aRunner(options: A2ARunnerOptions): RunnerLike {
  const { client, agentId } = options;

  return {
    run: async (message, runOptions) => {
      const response = await client.sendMessage(agentId, message, {
        signal: runOptions?.signal,
        timeoutMs: runOptions?.timeoutMs,
      });
      return { content: response.content };
    },
  };
}
