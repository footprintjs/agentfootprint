/**
 * QualityRecorder — evaluates output quality during execution.
 *
 * Calls a judge function on each turn completion and collects scores.
 * The judge can be LLM-powered, rule-based, or any scoring function.
 * Scores are collected during traversal (never post-processed).
 *
 * Usage:
 *   const quality = new QualityRecorder(async (event) => {
 *     const score = await llm.judge(event.content);
 *     return { score, label: score > 0.8 ? 'good' : 'poor' };
 *   });
 *   agent.recorder(quality);
 *   await agent.run(...);
 *   console.log(quality.getScores());
 */

import type { AgentRecorder, TurnCompleteEvent } from '../core';

// ── Types ────────────────────────────────────────────────────

export interface QualityScore {
  /** Numeric score (0-1 recommended, but not enforced). */
  readonly score: number;
  /** Optional human-readable label. */
  readonly label?: string;
  /** Which turn this score belongs to. */
  readonly turnNumber: number;
}

export type QualityJudge = (event: TurnCompleteEvent) => QualityScore | Promise<QualityScore>;

// ── Recorder ─────────────────────────────────────────────────

export class QualityRecorder implements AgentRecorder {
  readonly id: string;
  private readonly judge: QualityJudge;
  private scores: QualityScore[] = [];

  constructor(judge: QualityJudge, id = 'quality-recorder') {
    this.judge = judge;
    this.id = id;
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    // Fire-and-forget — eval must not block execution
    const result = this.judge(event);
    if (result instanceof Promise) {
      result.then((s) => this.scores.push(s)).catch(() => {});
    } else {
      this.scores.push(result);
    }
  }

  getScores(): QualityScore[] {
    return [...this.scores];
  }

  getAverageScore(): number {
    if (this.scores.length === 0) return 0;
    return this.scores.reduce((sum, s) => sum + s.score, 0) / this.scores.length;
  }

  clear(): void {
    this.scores = [];
  }
}
