/**
 * ToolUsageRecorder — tracks which tools are called, how often, and latency.
 *
 * Extends KeyedRecorder<ToolCallEvent> — Map keyed by runtimeStageId.
 */

import { KeyedRecorder } from 'footprintjs/trace';
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

export class ToolUsageRecorder extends KeyedRecorder<ToolCallEvent> implements AgentRecorder {
  readonly id: string;

  constructor(id = 'tool-usage-recorder') {
    super();
    this.id = id;
  }

  onToolCall(event: ToolCallEvent): void {
    this.store(event.runtimeStageId, event);
  }

  getStats(): ToolUsageStats {
    const calls = this.values();
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
    return [...new Set(this.values().map((c) => c.toolName))];
  }

  toSnapshot() {
    return {
      name: 'Tools',
      description: 'Translator (KeyedRecorder) — per-call tool usage and latency',
      preferredOperation: 'translate' as const,
      data: {
        numericField: 'latencyMs',
        grandTotal: this.aggregate((sum, e) => sum + e.latencyMs, 0),
        steps: Object.fromEntries(this.getMap()),
      },
    };
  }
}
