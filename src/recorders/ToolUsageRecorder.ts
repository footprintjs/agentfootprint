/**
 * ToolUsageRecorder — tracks which tools are called, how often, and latency.
 *
 * Stores data as Map<runtimeStageId, ToolCallEvent> for O(1) lookup.
 * Aggregated stats (byTool) computed from Map values.
 */

import type { AgentRecorder, ToolCallEvent } from '../core';

export interface ToolUsageStats {
  readonly totalCalls: number;
  readonly totalErrors: number;
  readonly byTool: Record<string, ToolStats>;
}

export interface ToolStats {
  readonly calls: number;
  readonly errors: number;
  readonly totalLatencyMs: number;
  readonly averageLatencyMs: number;
}

export class ToolUsageRecorder implements AgentRecorder {
  readonly id: string;
  private data = new Map<string, ToolCallEvent>();
  private _autoKey = 0;

  constructor(id = 'tool-usage-recorder') {
    this.id = id;
  }

  onToolCall(event: ToolCallEvent): void {
    const key = event.runtimeStageId ?? `__auto_${this._autoKey++}`;
    this.data.set(key, event);
  }

  /** O(1) lookup by runtimeStageId. */
  getByKey(runtimeStageId: string): ToolCallEvent | undefined {
    return this.data.get(runtimeStageId);
  }

  /** All entries as a Map (insertion-ordered). */
  getMap(): ReadonlyMap<string, ToolCallEvent> {
    return this.data;
  }

  /** Aggregated stats (backward compatible). */
  getStats(): ToolUsageStats {
    const calls = [...this.data.values()];
    const byTool: Record<string, { calls: number; errors: number; totalLatencyMs: number }> = {};

    for (const call of calls) {
      if (!byTool[call.toolName]) {
        byTool[call.toolName] = { calls: 0, errors: 0, totalLatencyMs: 0 };
      }
      byTool[call.toolName].calls++;
      byTool[call.toolName].totalLatencyMs += call.latencyMs;
      if (call.result.error) {
        byTool[call.toolName].errors++;
      }
    }

    const result: Record<string, ToolStats> = {};
    for (const [name, stats] of Object.entries(byTool)) {
      result[name] = {
        ...stats,
        averageLatencyMs: stats.calls > 0 ? Math.round(stats.totalLatencyMs / stats.calls) : 0,
      };
    }

    return {
      totalCalls: calls.length,
      totalErrors: calls.filter((c) => c.result.error).length,
      byTool: result,
    };
  }

  getToolNames(): string[] {
    return [...new Set([...this.data.values()].map((c) => c.toolName))];
  }

  clear(): void {
    this.data.clear();
    this._autoKey = 0;
  }
}
