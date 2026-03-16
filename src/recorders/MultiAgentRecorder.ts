/**
 * MultiAgentRecorder — captures per-agent execution stats during traversal.
 * Implements footprintjs Recorder interface (scope-level observer).
 */

import { MULTI_AGENT_PATHS } from '../scope/AgentScope';
import type { AgentResultEntry } from '../types';

export interface MultiAgentEntry {
  readonly id: string;
  readonly name: string;
  readonly latencyMs: number;
  readonly contentLength: number;
  readonly hasNarrative: boolean;
}

export interface MultiAgentStats {
  readonly totalAgents: number;
  readonly totalLatencyMs: number;
  readonly averageLatencyMs: number;
  readonly entries: MultiAgentEntry[];
}

export class MultiAgentRecorder {
  readonly id: string;
  private entries: MultiAgentEntry[] = [];
  private lastSeenCount = 0;

  constructor(id = 'multi-agent-recorder') {
    this.id = id;
  }

  onStageStart(): void {
    // no-op — timing is handled by runnerAsStage
  }

  onStageEnd(): void {
    // no-op
  }

  onWrite(event: { key: string; value: unknown }): void {
    if (event.key === MULTI_AGENT_PATHS.AGENT_RESULTS) {
      const results = event.value as AgentResultEntry[];
      if (!results || results.length <= this.lastSeenCount) return;

      // Only record new entries (avoid duplicates from append pattern)
      for (let i = this.lastSeenCount; i < results.length; i++) {
        const r = results[i];
        this.entries.push({
          id: r.id,
          name: r.name,
          latencyMs: r.latencyMs,
          contentLength: r.content.length,
          hasNarrative: !!r.narrative && r.narrative.length > 0,
        });
      }
      this.lastSeenCount = results.length;
    }
  }

  getStats(): MultiAgentStats {
    const totalLatencyMs = this.entries.reduce((s, e) => s + e.latencyMs, 0);
    return {
      totalAgents: this.entries.length,
      totalLatencyMs,
      averageLatencyMs:
        this.entries.length > 0 ? Math.round(totalLatencyMs / this.entries.length) : 0,
      entries: [...this.entries],
    };
  }

  getTotalAgents(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.lastSeenCount = 0;
  }
}
