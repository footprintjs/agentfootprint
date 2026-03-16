/**
 * LLMRecorder — captures token counts, latency, and call count per LLM invocation.
 * Implements footprintjs Recorder interface (scope-level observer).
 */

import { ADAPTER_PATHS } from '../types';

export interface LLMCallEntry {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly hasToolCalls: boolean;
}

export interface LLMStats {
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly averageLatencyMs: number;
  readonly entries: LLMCallEntry[];
}

export class LLMRecorder {
  readonly id: string;
  private entries: LLMCallEntry[] = [];
  private stageStartTime: number | null = null;

  constructor(id = 'llm-recorder') {
    this.id = id;
  }

  onStageStart(): void {
    this.stageStartTime = Date.now();
  }

  onStageEnd(): void {
    this.stageStartTime = null;
  }

  onWrite(event: { key: string; value: unknown }): void {
    // Observe adapter response writes (ADAPTER_PATHS.RESPONSE / ADAPTER_PATHS.RESULT)
    if (event.key === ADAPTER_PATHS.RESPONSE || event.key === ADAPTER_PATHS.RESULT) {
      const val = event.value as Record<string, unknown> | undefined;
      if (!val) return;

      const usage = val.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const toolCalls = val.toolCalls as unknown[] | undefined;

      this.entries.push({
        model: (val.model as string) ?? 'unknown',
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        latencyMs: this.stageStartTime ? Date.now() - this.stageStartTime : 0,
        hasToolCalls: Array.isArray(toolCalls) && toolCalls.length > 0,
      });
    }
  }

  getStats(): LLMStats {
    const totalCalls = this.entries.length;
    const totalInputTokens = this.entries.reduce((s, e) => s + e.inputTokens, 0);
    const totalOutputTokens = this.entries.reduce((s, e) => s + e.outputTokens, 0);
    const totalLatency = this.entries.reduce((s, e) => s + e.latencyMs, 0);

    return {
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      averageLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
      entries: [...this.entries],
    };
  }

  getTotalCalls(): number {
    return this.entries.length;
  }

  getTotalInputTokens(): number {
    return this.entries.reduce((s, e) => s + e.inputTokens, 0);
  }

  getTotalOutputTokens(): number {
    return this.entries.reduce((s, e) => s + e.outputTokens, 0);
  }

  clear(): void {
    this.entries = [];
  }
}
