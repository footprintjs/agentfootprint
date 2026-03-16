/**
 * RAGRecorder — captures retrieval stats during traversal.
 * Implements footprintjs Recorder interface (scope-level observer).
 */

import { RAG_PATHS } from '../scope';
import type { RetrievalResult } from '../types';

export interface RetrievalEntry {
  readonly query: string;
  readonly chunkCount: number;
  readonly averageScore: number;
  readonly latencyMs: number;
}

export interface RAGStats {
  readonly totalRetrievals: number;
  readonly totalChunks: number;
  readonly averageChunksPerRetrieval: number;
  readonly averageScore: number;
  readonly averageLatencyMs: number;
  readonly entries: RetrievalEntry[];
}

export class RAGRecorder {
  readonly id: string;
  private entries: RetrievalEntry[] = [];
  private stageStartTime: number | null = null;

  constructor(id = 'rag-recorder') {
    this.id = id;
  }

  onStageStart(): void {
    this.stageStartTime = Date.now();
  }

  onStageEnd(): void {
    this.stageStartTime = null;
  }

  onWrite(event: { key: string; value: unknown }): void {
    if (event.key === RAG_PATHS.RETRIEVAL_RESULT) {
      const result = event.value as RetrievalResult | undefined;
      if (!result) return;

      const scores = result.chunks.map((c) => c.score).filter((s): s is number => s != null);

      this.entries.push({
        query: result.query,
        chunkCount: result.chunks.length,
        averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
        latencyMs: this.stageStartTime ? Date.now() - this.stageStartTime : 0,
      });
    }
  }

  getStats(): RAGStats {
    const totalRetrievals = this.entries.length;
    const totalChunks = this.entries.reduce((s, e) => s + e.chunkCount, 0);
    const allScores = this.entries.filter((e) => e.averageScore > 0);
    const totalLatency = this.entries.reduce((s, e) => s + e.latencyMs, 0);

    return {
      totalRetrievals,
      totalChunks,
      averageChunksPerRetrieval: totalRetrievals > 0 ? totalChunks / totalRetrievals : 0,
      averageScore:
        allScores.length > 0
          ? allScores.reduce((s, e) => s + e.averageScore, 0) / allScores.length
          : 0,
      averageLatencyMs: totalRetrievals > 0 ? Math.round(totalLatency / totalRetrievals) : 0,
      entries: [...this.entries],
    };
  }

  getTotalRetrievals(): number {
    return this.entries.length;
  }

  getTotalChunks(): number {
    return this.entries.reduce((s, e) => s + e.chunkCount, 0);
  }

  clear(): void {
    this.entries = [];
  }
}
