/**
 * ToolUsageRecorder — tracks which tools are called, how often, and latency.
 *
 * Useful for understanding agent behavior: which tools are hot,
 * which are slow, and which are erroring.
 *
 * Usage:
 *   const toolUsage = new ToolUsageRecorder();
 *   agent.recorder(toolUsage);
 *   await agent.run(...);
 *   console.log(toolUsage.getStats());
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
  private toolCalls: ToolCallEvent[] = [];

  constructor(id = 'tool-usage-recorder') {
    this.id = id;
  }

  onToolCall(event: ToolCallEvent): void {
    this.toolCalls.push(event);
  }

  getStats(): ToolUsageStats {
    const byTool: Record<string, { calls: number; errors: number; totalLatencyMs: number }> = {};

    for (const call of this.toolCalls) {
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
      totalCalls: this.toolCalls.length,
      totalErrors: this.toolCalls.filter((c) => c.result.error).length,
      byTool: result,
    };
  }

  getToolNames(): string[] {
    return [...new Set(this.toolCalls.map((c) => c.toolName))];
  }

  clear(): void {
    this.toolCalls = [];
  }
}
