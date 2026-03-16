/**
 * Agent configuration and result types.
 */

import type { FlowChart } from 'footprintjs';
import type { Message } from './messages';

export interface AgentConfig {
  readonly name: string;
  readonly systemPrompt?: string;
  readonly maxIterations: number;
  readonly toolIds: string[];
}

export interface AgentBuildResult {
  readonly flowChart: FlowChart<unknown, unknown>;
  readonly name: string;
  readonly config: AgentConfig;
}

export interface AgentResult {
  readonly content: string;
  readonly messages: Message[];
  readonly iterations: number;
}

export interface AgentRunOptions {
  /** User message to send. */
  readonly message: string;
  /** Abort signal for cancellation. */
  readonly signal?: AbortSignal;
  /** Timeout in milliseconds. */
  readonly timeoutMs?: number;
}
